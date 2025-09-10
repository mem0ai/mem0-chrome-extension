/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable no-console */

import { createMemButton } from '../components/mem_button';
import { API_MEMORIES, API_SEARCH, APP_LOGIN } from '../consts/api';
import { DEFAULT_USER_ID, type LoginData, MessageRole, SOURCE } from '../types/api';
import type { SearchStorage } from '../types/background_search';
import type { MemButtonController, MemButtonState } from '../types/memButton';
import type { MemoryItem, MemorySearchItem, OptionalApiParams } from '../types/memory';
import { Provider } from '../types/providers';
import { StorageKey } from '../types/storage';
import { createOrchestrator, normalizeQuery } from '../utils/background_search';
import { OPENMEMORY_PROMPTS } from '../utils/llm_prompts';
import { createSearchSession } from '../utils/searchSession';
import { Theme, detectTheme } from '../utils/theme';
import { THEME_COLORS } from '../utils/ui/button_theme';
import { sendExtensionEvent, getBrowser } from '../utils/util_functions';

export {};

// Controller for the main button
let memBtnCtrl: MemButtonController | null = null;

// State
let isProcessingMem0 = false;
let allMemories: string[] = [];
const allMemoriesById: Set<string> = new Set<string>();
let inputValueCopy = '';

// Replit  contenteditable resolver
function getInputElement(): HTMLTextAreaElement | HTMLDivElement | null {
  return (
    (document.querySelector('div#ask-input[contenteditable="true"]') as HTMLDivElement | null) ||
    (document.querySelector('textarea#ask-input') as HTMLTextAreaElement | null) ||
    (document.querySelector(
      'div[contenteditable="true"][aria-placeholder^="Ask"]'
    ) as HTMLDivElement | null) ||
    (document.querySelector('textarea[placeholder^="Ask"]') as HTMLTextAreaElement | null) ||
    (document.querySelector(
      'textarea[placeholder^="Ask a follow-up"]'
    ) as HTMLTextAreaElement | null) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement | null) ||
    document.querySelector('textarea')
  );
}

function getInputText(inputElement: HTMLElement | null): string {
  if (!inputElement) {
    return '';
  }
  if (inputElement.tagName === 'TEXTAREA') {
    return (inputElement as HTMLTextAreaElement).value || '';
  }
  if ((inputElement as HTMLElement).contentEditable === 'true') {
    // CodeMirror/lexical-like safe text read
    const p = inputElement.querySelector('p[dir="ltr"]') as HTMLElement | null;
    if (p) {
      let txt = '';
      p.childNodes.forEach(n => {
        if (n.nodeType === Node.TEXT_NODE) {
          txt += n.textContent || '';
        } else if (
          (n as HTMLElement).tagName === 'SPAN' &&
          (n as HTMLElement).getAttribute('data-lexical-text') === 'true'
        ) {
          txt += (n as HTMLElement).textContent || '';
        } else if ((n as HTMLElement).tagName === 'BR') {
          txt += '\n';
        }
      });
      return txt;
    }
    return (inputElement as HTMLElement).textContent || '';
  }
  return '';
}

function setInputText(inputElement: HTMLElement | null, text: string): void {
  if (!inputElement) {
    return;
  }

  if (inputElement.tagName === 'TEXTAREA') {
    (inputElement as HTMLTextAreaElement).value = text;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if ((inputElement as HTMLElement).contentEditable === 'true') {
    const root = inputElement as HTMLElement;
    root.focus();

    // ensure Lexical structure
    let p = root.querySelector('p[dir="ltr"]') as HTMLElement | null;
    if (!p) {
      root.innerHTML = '';
      p = document.createElement('p');
      p.setAttribute('dir', 'ltr');
      root.appendChild(p);
    } else {
      p.innerHTML = '';
    }

    const span = document.createElement('span');
    span.setAttribute('data-lexical-text', 'true');
    span.textContent = text;
    p.appendChild(span);

    // notify editor
    try {
      root.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: 'insertText',
        })
      );
    } catch {
      // nothing
    }
    // Removed because of duplication
    // root.dispatchEvent(
    //   new InputEvent('input', {
    //     bubbles: true,
    //     cancelable: true,
    //     data: text,
    //     inputType: 'insertText',
    //   })
    // );
    root.dispatchEvent(new Event('change', { bubbles: true }));

    // move cursor to end
    const sel = window.getSelection();
    if (sel) {
      const r = document.createRange();
      r.selectNodeContents(root);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }
}

function setInputValue(inputElement: HTMLElement | null, value: string): void {
  if (inputElement) {
    setInputText(inputElement, value);
  }
}

function getInputValue(): string {
  const el = getInputElement();
  return el ? getInputText(el as HTMLElement) : '';
}

function computeActive(): boolean {
  return getInputValue().trim().length > 3;
}

function wireIdleVisualState(): void {
  const input = getInputElement();
  if (!memBtnCtrl || !input) {
    return;
  }

  const apply = () => {
    if (!memBtnCtrl) {
      return;
    }
    const hasText = computeActive();
    const c = THEME_COLORS[detectTheme()];
    const hovered = memBtnCtrl.button.matches(':hover');

    if (!hovered) {
      memBtnCtrl.button.style.backgroundColor = hasText ? c.BUTTON_BG_ACTIVE : c.BUTTON_BG;
    }
    memBtnCtrl.elements.checkmark.style.display = hasText ? 'inline-block' : 'none';
    memBtnCtrl.elements.shortcut.style.display = hasText ? 'inline-block' : 'none';

    if (detectTheme() === Theme.LIGHT) {
      const color = hasText ? 'white' : '#1a1a1a';
      memBtnCtrl.elements.text.style.color = color;
      memBtnCtrl.elements.checkmark.style.color = color;
    }
  };

  apply();
  input.addEventListener('input', apply);
  input.addEventListener('keyup', apply);
  input.addEventListener('focus', apply);
  const mo = new MutationObserver(apply);
  mo.observe(input, { childList: true, characterData: true, subtree: true });
}

function setButtonState(s: MemButtonState) {
  memBtnCtrl?.setState(s);
}

/* ---------------------- Search session & orchestrator ---------------------- */

const searchSession = createSearchSession<MemoryItem>({ normalizeQuery });

const replitSearch = createOrchestrator({
  fetch: async (query: string, opts: { signal?: AbortSignal }) => {
    const data = await new Promise<SearchStorage>(resolve => {
      chrome.storage.sync.get(
        [
          StorageKey.API_KEY,
          StorageKey.USER_ID_CAMEL,
          StorageKey.ACCESS_TOKEN,
          StorageKey.SELECTED_ORG,
          StorageKey.SELECTED_PROJECT,
          StorageKey.USER_ID,
          StorageKey.SIMILARITY_THRESHOLD,
          StorageKey.TOP_K,
        ],
        items => resolve(items as SearchStorage)
      );
    });

    const apiKey = data[StorageKey.API_KEY];
    const accessToken = data[StorageKey.ACCESS_TOKEN];
    if (!apiKey && !accessToken) {
      return [];
    }

    const authHeader = accessToken ? `Bearer ${accessToken}` : `Token ${apiKey}`;
    const userId = data[StorageKey.USER_ID_CAMEL] || data[StorageKey.USER_ID] || DEFAULT_USER_ID;
    const threshold =
      data[StorageKey.SIMILARITY_THRESHOLD] !== undefined
        ? data[StorageKey.SIMILARITY_THRESHOLD]
        : 0.1;
    const topK = data[StorageKey.TOP_K] !== undefined ? data[StorageKey.TOP_K] : 10;

    const optionalParams: OptionalApiParams = {};
    if (data[StorageKey.SELECTED_ORG]) {
      optionalParams.org_id = data[StorageKey.SELECTED_ORG];
    }
    if (data[StorageKey.SELECTED_PROJECT]) {
      optionalParams.project_id = data[StorageKey.SELECTED_PROJECT];
    }

    const payload = {
      query,
      filters: { user_id: userId },
      rerank: true,
      threshold,
      top_k: topK,
      filter_memories: false,
      source: 'OPENMEMORY_CHROME_EXTENSION',
      ...optionalParams,
    };

    const res = await fetch(API_SEARCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(payload),
      signal: opts?.signal,
    });

    if (!res.ok) {
      throw new Error(`API request failed with status ${res.status}`);
    }
    return await res.json();
  },

  onSuccess: (_normQuery: string, responseData: MemorySearchItem[]) => {
    const items: MemoryItem[] = (responseData || []).map((item, i) => ({
      id: String(item.id ?? `memory-${Date.now()}-${i}`),
      text: item.memory,
      categories: item.categories ?? [],
    }));
    searchSession.onSuccess(_normQuery, items);
  },

  onError: (normQuery: string, err: Error) => {
    searchSession.onError(normQuery, err);
    console.log('Error searching memories (Replit)', err);
  },

  minLength: 3,
  debounceMs: 150,
  cacheTTL: 60000,
});

/* -------------------------- Button placement logic ------------------------ */

function removeExistingButton(): void {
  const existing = document.querySelector('#mem0-icon-button') as HTMLElement | null;
  if (existing?.parentNode) {
    (existing.parentNode as HTMLElement).remove();
  }

  const floatingContainer = document.querySelector('#mem0-floating-container');
  if (floatingContainer) {
    floatingContainer.remove();
  }
}

function findOrCreateButtonContainer(): HTMLElement | null {
  const inputEl = getInputElement();
  if (!inputEl) {
    return null;
  }

  // Find a flex parent near editor/toolbar
  let current: HTMLElement | null = inputEl;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (style.display === 'flex' && current.contains(inputEl)) {
      return current;
    }
    current = current.parentElement;
  }

  // Fallback floating container near editor
  const rect = (inputEl as HTMLElement).getBoundingClientRect();
  const container = document.createElement('div');
  container.id = 'mem0-floating-container';
  container.style.cssText = `
    position: fixed;
    top: ${Math.max(10, rect.top - 40)}px;
    left: ${Math.max(10, rect.left + 8)}px;
    z-index: 1000;
    display: flex;
    gap: 4px;
  `;
  document.body.appendChild(container);
  return container;
}

function insertButtonIntoContainer(buttonContainer: HTMLElement, mem0ButtonContainer: HTMLElement) {
  buttonContainer.insertBefore(mem0ButtonContainer, buttonContainer.firstChild);
  buttonContainer.style.cssText += `
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    gap: 8px !important;
  `;
}

/* -------------------------- Memory injection utils ------------------------ */

function getContentWithoutMemories(message?: string): string {
  const inputElement = getInputElement();
  if (!inputElement && typeof message !== 'string') {
    return '';
  }

  let content =
    typeof message === 'string'
      ? message
      : getInputText(inputElement as HTMLElement) ||
        (inputElement as HTMLDivElement)?.innerHTML ||
        '';

  // Remove any previously inserted memory block
  const memoryMarker = '\n\n' + OPENMEMORY_PROMPTS.memory_header_text;
  if (content.includes(memoryMarker)) {
    content = content.substring(0, content.indexOf(memoryMarker)).trim();
  }

  return content.trim();
}

function updateInputWithMemories(): void {
  const inputElement = getInputElement();
  if (!inputElement || allMemories.length === 0) {
    return;
  }

  // Get current content and remove any existing memory content
  let currentContent = getInputText(inputElement as HTMLElement);

  // Remove existing memory content if present
  const memoryMarker = '\n\n' + OPENMEMORY_PROMPTS.memory_header_text;
  if (currentContent.includes(memoryMarker)) {
    currentContent = currentContent.substring(0, currentContent.indexOf(memoryMarker)).trim();
  }

  // Create the memory content string
  let memoriesContent = '\n\n' + OPENMEMORY_PROMPTS.memory_header_text + '\n';
  allMemories.forEach((mem, index) => {
    memoriesContent += `- ${mem}`;
    if (index < allMemories.length - 1) {
      memoriesContent += '\n';
    }
  });

  // Set the input value with the cleaned content + memories
  console.log('🔍 Current content before cleanup:', currentContent);
  console.log('🔍 Memories content:', memoriesContent);
  console.log('🔍 Final content to insert:', currentContent + memoriesContent);
  setInputValue(inputElement as HTMLElement, currentContent + memoriesContent);
}

/* ---------------------------- Send/save listeners ------------------------- */

function addSendButtonListener(): void {
  const selectors = [
    'button[data-cy="ai-prompt-submit"]',
    'button[data-cy="ai-chat-send-button"]',
    'button[aria-label="Send"]',
    'button[type="button"][aria-label="Send"]',
    '.useView_view__C2mnv[aria-label="Send"]',
    'button[type="submit"]',
    'button:has(svg[data-testid="send"])',
    'button:has([data-testid="send"])',
  ];

  const captureAndStoreMemory = (): void => {
    const el = getInputElement();
    if (!el) {
      return;
    }

    let message = (el as HTMLTextAreaElement)?.value || (el as HTMLDivElement).textContent || '';

    if (!message || message.trim() === '') {
      message = inputValueCopy;
    }
    if (!message || message.trim() === '') {
      return;
    }

    message = getContentWithoutMemories(message);
    if (!message || message.trim() === '') {
      return;
    }

    chrome.storage.sync.get(
      [
        StorageKey.API_KEY,
        StorageKey.USER_ID_CAMEL,
        StorageKey.ACCESS_TOKEN,
        StorageKey.MEMORY_ENABLED,
        StorageKey.SELECTED_ORG,
        StorageKey.SELECTED_PROJECT,
        StorageKey.USER_ID,
      ],
      function (items) {
        if (
          items[StorageKey.MEMORY_ENABLED] === false ||
          (!items[StorageKey.API_KEY] && !items[StorageKey.ACCESS_TOKEN])
        ) {
          return;
        }

        const authHeader = items[StorageKey.ACCESS_TOKEN]
          ? `Bearer ${items[StorageKey.ACCESS_TOKEN]}`
          : `Token ${items[StorageKey.API_KEY]}`;

        const userId =
          items[StorageKey.USER_ID_CAMEL] || items[StorageKey.USER_ID] || DEFAULT_USER_ID;

        const optionalParams: OptionalApiParams = {};
        if (items[StorageKey.SELECTED_ORG]) {
          optionalParams.org_id = items[StorageKey.SELECTED_ORG];
        }
        if (items[StorageKey.SELECTED_PROJECT]) {
          optionalParams.project_id = items[StorageKey.SELECTED_PROJECT];
        }

        const payload = {
          messages: [{ role: MessageRole.User, content: message }],
          user_id: userId,
          infer: true,
          metadata: { provider: Provider.Replit },
          source: SOURCE,
          ...optionalParams,
        };

        fetch(API_MEMORIES, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify(payload),
        }).catch(e => console.error('Error saving memory (Replit):', e));
      }
    );

    setTimeout(() => {
      allMemories = [];
      allMemoriesById.clear();
    }, 120);
  };

  // Wire click on send
  for (const sel of selectors) {
    const btn = document.querySelector(sel) as HTMLButtonElement | null;
    if (btn && !btn.dataset.mem0Listener) {
      btn.dataset.mem0Listener = 'true';
      btn.addEventListener('click', captureAndStoreMemory);
      break;
    }
  }

  // Wire Enter key
  const inputElement = getInputElement();
  if (inputElement && !(inputElement as HTMLElement).dataset?.mem0KeyListener) {
    (inputElement as HTMLElement).dataset.mem0KeyListener = 'true';
    (inputElement as HTMLElement).addEventListener('keydown', (event: KeyboardEvent) => {
      inputValueCopy =
        (inputElement as HTMLTextAreaElement)?.value ||
        (inputElement as HTMLDivElement).textContent ||
        inputValueCopy;

      if (event.key === 'Enter' && !event.shiftKey) {
        captureAndStoreMemory();
        setTimeout(() => {
          allMemories = [];
          allMemoriesById.clear();
        }, 120);
      }
    });
  }
}

// Perplexity: anchor is the WHOLE segmented-control (radiogroup), not a single button
function findPerplexitySegmentedGroup(): HTMLElement | null {
  const studio = document.querySelector(
    'div[data-testid="search-mode-studio"]'
  ) as HTMLElement | null;
  if (studio) {
    const group = studio.closest('[role="radiogroup"]') as HTMLElement | null;
    if (group) {
      return group;
    } // we'll insert AFTER this -> visually to the right of the whole group
  }

  // Fallback: the row that holds the controls
  return document.querySelector('div.gap-xs.flex.items-center') as HTMLElement | null;
}

async function addMem0IconButton(): Promise<void> {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    removeExistingButton();
    return;
  }

  // don't duplicate
  if (document.querySelector('#mem0-icon-button')) {
    return;
  }

  // Create controller (unified mem button)
  const ctrl = createMemButton({
    theme: detectTheme(),
    label: 'Memories',
    shortcut: 'Ctrl + M',
    autoTheme: true,
    onClick: async () => {
      try {
        const enabled = await getMemoryEnabledState();
        if (enabled) {
          await handleMem0Click();
        }
      } catch (e) {
        console.error('Error handling Mem0 button click (Perplexity):', e);
      }
    },
  });
  memBtnCtrl = ctrl;

  // Make button more compact but with enough width for text
  ctrl.root.style.height = '28px';
  ctrl.root.style.minHeight = '28px';
  ctrl.root.style.maxHeight = '28px';
  ctrl.root.style.minWidth = '80px'; // Ensure enough width
  ctrl.button.style.height = '28px';
  ctrl.button.style.minHeight = '28px';
  ctrl.button.style.maxHeight = '28px';
  ctrl.button.style.minWidth = '80px'; // Ensure enough width
  ctrl.button.style.padding = '0 10px'; // Restore padding for better spacing
  ctrl.button.style.whiteSpace = 'nowrap'; // Prevent text wrapping
  ctrl.elements.text.style.fontSize = '11px';
  ctrl.elements.shortcut.style.fontSize = '9px';
  ctrl.elements.checkmark.style.transform = 'scale(0.8)';

  const group = findPerplexitySegmentedGroup();
  if (group) {
    group.insertAdjacentElement('afterend', ctrl.root);

    // Keep the row layout tidy
    const row = group.parentElement as HTMLElement | null;
    if (row) {
      const cs = getComputedStyle(row);
      if (cs.display !== 'flex') {
        row.style.display = 'flex';
      }
      if (cs.alignItems !== 'center') {
        row.style.alignItems = 'center';
      }
      if (!cs.gap || cs.gap === '0px') {
        row.style.gap = '8px';
      }
    }
  } else {
    // Fallback near the editor
    const container = findOrCreateButtonContainer();
    if (!container) {
      return;
    }
    insertButtonIntoContainer(container, ctrl.root);
  }

  ctrl.wireHover(() => getInputValue().trim().length > 3);
  wireIdleVisualState();
  addSendButtonListener();
}

async function handleMem0Click(): Promise<void> {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    return;
  }

  const loginData = await new Promise<LoginData>(resolve => {
    chrome.storage.sync.get(
      [StorageKey.API_KEY, StorageKey.USER_ID_CAMEL, StorageKey.ACCESS_TOKEN],
      items => resolve(items)
    );
  });
  if (!loginData[StorageKey.API_KEY] && !loginData[StorageKey.ACCESS_TOKEN]) {
    showLoginPopup();
    return;
  }

  let message = getInputValue().trim();
  if (!message || message.length <= 3) {
    const btn = document.querySelector('#mem0-icon-button') as HTMLElement | null;
    if (btn) {
      showButtonPopup(btn, 'Please enter some text first');
    }
    return;
  }

  try {
    const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
    message = message.replace(MEM0_PLAIN, '').trim();
  } catch {
    /* noop */
  }

  if (isProcessingMem0) {
    return;
  }
  isProcessingMem0 = true;
  setButtonState('loading');

  try {
    sendExtensionEvent('modal_clicked', {
      provider: 'replit',
      source: 'OPENMEMORY_CHROME_EXTENSION',
      browser: getBrowser(),
    });

    const items = await searchSession.runSearchAndWait(replitSearch, message);

    // reset and collect
    allMemories = [];
    allMemoriesById.clear();
    for (const m of items) {
      allMemoriesById.add(String(m.id));
      allMemories.push(m.text || m.memory || '');
    }

    updateInputWithMemories();
    if (items.length > 0) {
      showMemoriesPopup(true);
    }

    // Save memory in parallel
    addSendButtonListener();
    captureAndStoreMemory();
  } catch (error) {
    if ((error as Error).message === 'no-result') {
      const btn = document.querySelector('#mem0-icon-button') as HTMLElement | null;
      if (btn) {
        showButtonPopup(btn, 'Too short or no matches');
      }
    } else {
      console.error('Error (Replit):', error);
      showMemoriesPopup(false);
    }
    setButtonState('error');
  } finally {
    setTimeout(() => setButtonState('added'), 500);
    setTimeout(() => setButtonState('success'), 1500);
    isProcessingMem0 = false;
  }

  // local helper to save current message when user clicked button (non-blocking)
  function captureAndStoreMemory(): void {
    const messageNow = getContentWithoutMemories(getInputValue());
    if (!messageNow || messageNow.trim().length <= 3) {
      const btn = document.querySelector('#mem0-icon-button') as HTMLElement | null;
      if (btn) {
        showButtonPopup(btn, 'Please enter some text first');
      }
      return;
    }

    chrome.storage.sync.get(
      [
        StorageKey.API_KEY,
        StorageKey.USER_ID_CAMEL,
        StorageKey.ACCESS_TOKEN,
        StorageKey.MEMORY_ENABLED,
        StorageKey.SELECTED_ORG,
        StorageKey.SELECTED_PROJECT,
        StorageKey.USER_ID,
      ],
      function (items) {
        if (
          items[StorageKey.MEMORY_ENABLED] === false ||
          (!items[StorageKey.API_KEY] && !items[StorageKey.ACCESS_TOKEN])
        ) {
          return;
        }

        const authHeader = items[StorageKey.ACCESS_TOKEN]
          ? `Bearer ${items[StorageKey.ACCESS_TOKEN]}`
          : `Token ${items[StorageKey.API_KEY]}`;

        const userId =
          items[StorageKey.USER_ID_CAMEL] || items[StorageKey.USER_ID] || DEFAULT_USER_ID;

        const optionalParams: OptionalApiParams = {};
        if (items[StorageKey.SELECTED_ORG]) {
          optionalParams.org_id = items[StorageKey.SELECTED_ORG];
        }
        if (items[StorageKey.SELECTED_PROJECT]) {
          optionalParams.project_id = items[StorageKey.SELECTED_PROJECT];
        }

        fetch(API_MEMORIES, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({
            messages: [{ role: MessageRole.User, content: messageNow }],
            user_id: userId,
            infer: true,
            metadata: { provider: Provider.Replit },
            source: SOURCE,
            ...optionalParams,
          }),
        }).catch(e => console.error('Error saving memory (Replit button):', e));
      }
    );
  }
}

function showMemoriesPopup(isSuccess: boolean): void {
  const existing = document.querySelector('.mem0-memories-popup') as HTMLElement | null;
  if (existing) {
    existing.remove();
  }

  const popup = document.createElement('div');
  popup.className = 'mem0-memories-popup';

  const colors = THEME_COLORS[detectTheme() as keyof typeof THEME_COLORS];
  popup.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background-color: ${colors.POPUP_BG};
    border: 1px solid ${colors.POPUP_BORDER};
    border-radius: 12px;
    color: ${colors.POPUP_TEXT};
    padding: 16px;
    width: 300px;
    z-index: 10001;
    box-shadow: 0 4px 20px ${colors.POPUP_SHADOW};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  const content = document.createElement('div');
  content.style.cssText = `font-size: 14px; line-height: 1.4; text-align: center;`;
  content.textContent = isSuccess ? 'Memories added' : 'Error while adding memories';

  popup.appendChild(content);
  document.body.appendChild(popup);

  setTimeout(() => {
    if (document.body.contains(popup)) {
      popup.remove();
    }
  }, 3000);
}

function showButtonPopup(button: HTMLElement, message: string): void {
  const existing = document.querySelector('.mem0-button-popup') as HTMLElement | null;
  if (existing) {
    existing.remove();
  }

  const hoverPopover = document.querySelector('.mem0-button-popover') as HTMLElement | null;
  if (hoverPopover) {
    hoverPopover.style.opacity = '0';
    hoverPopover.style.display = 'none';
  }

  const popup = document.createElement('div');
  popup.className = 'mem0-button-popup';
  popup.style.cssText = `
    position: absolute;
    top: -40px;
    left: 50%;
    transform: translateX(-50%);
    background-color: #1C1C1E;
    border: 1px solid #27272A;
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    white-space: nowrap;
    z-index: 10001;
    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
  `;
  popup.textContent = message;

  const arrow = document.createElement('div');
  arrow.style.cssText = `
    position: absolute;
    bottom: -5px;
    left: 50%;
    transform: translateX(-50%) rotate(45deg);
    width: 10px;
    height: 10px;
    background-color: #1C1C1E;
    border-right: 1px solid #27272A;
    border-bottom: 1px solid #27272A;
  `;
  popup.appendChild(arrow);

  button.style.position = 'relative';
  button.appendChild(popup);

  setTimeout(() => {
    if (document.body.contains(popup)) {
      popup.remove();
    }
  }, 3000);
}

/* --------------------------- Background typing ---------------------------- */

let replitBackgroundSearchHandler: ((this: Element, ev: Event) => void) | null = null;
function hookBackgroundSearchTyping() {
  const inputElement = getInputElement();
  if (!inputElement) {
    return;
  }

  if (!replitBackgroundSearchHandler) {
    replitBackgroundSearchHandler = function () {
      const text = getInputValue() || '';
      replitSearch.setText(text);
    };
  }
  inputElement.addEventListener('input', replitBackgroundSearchHandler);
  inputElement.addEventListener('keyup', replitBackgroundSearchHandler);
}

function getMemoryEnabledState(): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    chrome.storage.sync.get([StorageKey.MEMORY_ENABLED], function (result) {
      resolve(result.memory_enabled !== false); // Default to true
    });
  });
}

function showLoginPopup(): void {
  const existing = document.querySelector('#mem0-login-popup');
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = 'mem0-login-popup';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background-color: rgba(0,0,0,0.5);
    display:flex; justify-content:center; align-items:center; z-index:10001;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    background-color:#1C1C1E; border-radius:12px; width:320px; padding:24px; color:white;
    box-shadow:0 4px 20px rgba(0,0,0,0.5);
    font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; position:relative;
  `;

  const close = document.createElement('button');
  close.style.cssText = `
    position:absolute; top:16px; right:16px; background:none; border:none; color:#A1A1AA;
    font-size:16px; cursor:pointer;
  `;
  close.innerHTML = '&times;';
  close.addEventListener('click', () => document.body.removeChild(overlay));

  const msg = document.createElement('p');
  msg.textContent = 'Please sign in to access your memories and enhance your conversations!';
  msg.style.cssText = `margin-bottom: 24px; color:#D4D4D8; font-size:14px; line-height:1.5; text-align:center;`;

  const btn = document.createElement('button');
  btn.style.cssText = `
    display:flex; align-items:center; justify-content:center; width:100%;
    padding:10px; background-color:white; color:black; border:none; border-radius:8px;
    font-size:14px; font-weight:600; cursor:pointer; transition:background-color 0.2s;
  `;
  const logo = document.createElement('img');
  logo.src = chrome.runtime.getURL('icons/mem0-icon-black.png');
  logo.style.cssText = `width:24px; height:24px; border-radius:50%; margin-right:12px;`;
  const txt = document.createElement('span');
  txt.textContent = 'Sign in with Mem0';
  btn.appendChild(logo);
  btn.appendChild(txt);
  btn.addEventListener('mouseenter', () => (btn.style.backgroundColor = '#f5f5f5'));
  btn.addEventListener('mouseleave', () => (btn.style.backgroundColor = 'white'));
  btn.addEventListener('click', () => {
    window.open(APP_LOGIN, '_blank');
    document.body.removeChild(overlay);
  });

  card.appendChild(msg);
  card.appendChild(btn);
  overlay.appendChild(card);
  overlay.appendChild(close);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
    }
  });

  document.body.appendChild(overlay);
}

function initializeMem0Integration(): void {
  (async () => await addMem0IconButton())();
  addSendButtonListener();
  wireIdleVisualState();
  hookBackgroundSearchTyping();

  // Ctrl+M shortcut
  if (!document.body.dataset.mem0KeyboardListener) {
    document.body.dataset.mem0KeyboardListener = 'true';
    document.addEventListener('keydown', function (event) {
      if (event.ctrlKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        (async () => {
          await handleMem0Click();
        })();
      }
    });
  }

  const observer = new MutationObserver(() => {
    (async () => await addMem0IconButton())();
    addSendButtonListener();
    wireIdleVisualState();
    hookBackgroundSearchTyping();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(() => {
    (async () => await addMem0IconButton())();
    addSendButtonListener();
  }, 3000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeMem0Integration);
} else {
  initializeMem0Integration();
}
