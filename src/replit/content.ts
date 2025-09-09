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

// Replit contenteditable resolver
function getInputElement(): HTMLTextAreaElement | HTMLDivElement | null {
  const selectors = [
    'div[contenteditable="true"][class="cm-content cm-lineWrapping"][role="textbox"]',
    'div.cm-content.cm-lineWrapping[contenteditable="true"]',
    '.cm-content[contenteditable="true"]',
    'div[contenteditable="true"].cm-content',
    'div.cm-content[role="textbox"]',
    '.cm-content',
    'div[contenteditable="true"]',
    '[contenteditable="true"]',
    'textarea',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel) as HTMLDivElement | HTMLTextAreaElement | null;
    if (el) {
      return el;
    }
  }
  return null;
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

// Robust writer that works with CodeMirror/contenteditable
function setInputText(inputElement: HTMLElement | null, text: string): void {
  if (!inputElement) {
    return;
  }

  if (inputElement.tagName === 'TEXTAREA') {
    (inputElement as HTMLTextAreaElement).value = text;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  if ((inputElement as HTMLElement).contentEditable === 'true') {
    // Clear existing content
    inputElement.innerHTML = '';

    // Split the value by newlines and create div elements for Replit's CodeMirror
    const lines = text.split('\n');
    lines.forEach((line: string, index: number) => {
      const div = document.createElement('div');
      div.className = 'cm-line';
      if (index === 0) {
        div.className += ' cm-replit-active-line';
      }

      if (line.trim() === '') {
        div.innerHTML = '<br>';
      } else {
        div.textContent = line;
      }
      inputElement.appendChild(div);
    });

    // Trigger input event
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));

    // Focus and set cursor to end
    inputElement.focus();

    // Set cursor to end of content
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(inputElement);
    range.collapse(false);
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
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
  const input = getInputElement();
  if (!input) {
    return null;
  }

  // Strategy 1: Look for the "Auto theme" button and its container
  const autoThemeButton = document.querySelector('#app-theme-select');
  if (autoThemeButton?.parentElement) {
    // Find the flex container that contains this button
    let current: HTMLElement | null = autoThemeButton.parentElement;
    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      if (style.display === 'flex' && style.flexDirection === 'row') {
        return current;
      }
      current = current.parentElement;
    }
  }

  // Strategy 2: Look for the flex container with the theme button
  const themeContainer = document.querySelector('.react-aria-Select');
  if (themeContainer?.parentElement) {
    return themeContainer.parentElement as HTMLElement;
  }

  // Fallback: original logic
  const editor = input.closest('.cm-editor') as HTMLElement | null;
  const scroller = editor?.querySelector('.cm-scroller') as HTMLElement | null;
  if (!editor || !scroller) {
    return null;
  }

  // ensure context for absolute
  if (getComputedStyle(scroller).position === 'static') {
    scroller.style.position = 'relative';
  }

  let container = document.querySelector('#mem0-inline-container') as HTMLElement | null;
  if (!container) {
    container = document.createElement('div');
    container.id = 'mem0-inline-container';
    container.style.cssText = `
      position: absolute;
      left: 8px;
      top: 6px;
      z-index: 10;
      display: flex;
      align-items: center;
      pointer-events: auto;
    `;
    scroller.appendChild(container);
  }
  return container;
}

function insertButtonIntoContainer(buttonContainer: HTMLElement, mem0ButtonContainer: HTMLElement) {
  // Look for the "Auto theme" button
  const autoThemeButton = buttonContainer.querySelector('#app-theme-select');

  if (autoThemeButton) {
    // Insert after the auto theme button
    buttonContainer.insertBefore(mem0ButtonContainer, autoThemeButton.nextSibling);
  } else {
    // Fallback: append to container
    if (!buttonContainer.contains(mem0ButtonContainer)) {
      buttonContainer.appendChild(mem0ButtonContainer);
    }
  }
}

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

  // Remove any previously inserted memory block (plain & regex)
  try {
    const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
    const MEM0_HTML = OPENMEMORY_PROMPTS.memory_header_html_regex;
    content = content.replace(MEM0_HTML, '');
    content = content.replace(MEM0_PLAIN, '');
  } catch {
    /* noop */
  }

  // Also remove simple text header if present
  if (OPENMEMORY_PROMPTS.memory_header_text) {
    const i = content.indexOf(OPENMEMORY_PROMPTS.memory_header_text);
    if (i !== -1) {
      content = content.substring(0, i);
    }
  }

  return content.trim();
}

function updateInputWithMemories(): void {
  const inputElement = getInputElement();
  if (!inputElement || allMemories.length === 0) {
    return;
  }

  const baseContent = getContentWithoutMemories();

  // Replit editor prefers plain text block instead of HTML wrapper
  let block = '\n\n' + OPENMEMORY_PROMPTS.memory_header_text + '\n';
  block += allMemories.map(m => `- ${String(m || '')}`).join('\n');

  setInputValue(inputElement as HTMLElement, (baseContent + block).trim());
}

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

function alignWithFirstLine(container: HTMLElement): void {
  try {
    const editor = container.closest('.cm-editor') as HTMLElement;
    const scroller = editor.querySelector('.cm-scroller') as HTMLElement;
    const firstLine = editor.querySelector('.cm-content .cm-line') as HTMLElement | null;
    if (!firstLine) {
      return;
    }

    const rLine = firstLine.getBoundingClientRect();
    const rScroll = scroller.getBoundingClientRect();
    const y = Math.max(4, Math.round(rLine.top - rScroll.top)); // slightly above the first line
    container.style.top = `${y}px`;
  } catch {
    /* noop */
  }
}

async function addMem0IconButton(): Promise<void> {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    removeExistingButton();
    return;
  }

  const container = findOrCreateButtonContainer();
  if (!container || document.querySelector('#mem0-icon-button')) {
    return;
  }

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
        console.error('Error handling Mem0 button click (Replit):', e);
      }
    },
  });
  // AFTER: const ctrl = createMemButton({...});
  memBtnCtrl = ctrl;

  // Compact look (prevents stretching in Replit’s flex containers)
  ctrl.button.style.padding = '2px 8px';
  ctrl.button.style.minHeight = '24px';
  ctrl.button.style.height = '24px';
  ctrl.elements.text.style.fontSize = '12px';
  ctrl.elements.shortcut.style.fontSize = '11px';
  ctrl.elements.checkmark.style.transform = 'scale(0.9)';

  // Align with first line and react to changes
  const inlineContainer = findOrCreateButtonContainer();
  if (inlineContainer) {
    insertButtonIntoContainer(inlineContainer, ctrl.root);
    alignWithFirstLine(inlineContainer);

    const editor = inlineContainer.closest('.cm-editor') as HTMLElement | null;
    const scroller = editor?.querySelector('.cm-scroller') as HTMLElement | null;
    const content = editor?.querySelector('.cm-content') as HTMLElement | null;

    window.addEventListener('resize', () => alignWithFirstLine(inlineContainer));
    scroller?.addEventListener('scroll', () => alignWithFirstLine(inlineContainer));
    new MutationObserver(() => alignWithFirstLine(inlineContainer)).observe(
      content || document.body,
      { childList: true, subtree: true, characterData: true }
    );
  }

  insertButtonIntoContainer(container, ctrl.root);
  ctrl.wireHover(computeActive);
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

  const popupOverlay = document.createElement('div');
  popupOverlay.id = 'mem0-login-popup';
  popupOverlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex; justify-content: center; align-items: center;
    z-index: 10001;
  `;

  const popupContainer = document.createElement('div');
  popupContainer.style.cssText = `
    background-color: #1C1C1E;
    border-radius: 12px;
    width: 320px;
    padding: 24px;
    color: white;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  const closeButton = document.createElement('button');
  closeButton.style.cssText = `
    position: absolute; top: 16px; right: 16px;
    background: none; border: none; color: #A1A1AA;
    font-size: 16px; cursor: pointer;
  `;
  closeButton.innerHTML = '&times;';
  closeButton.addEventListener('click', () => {
    if (document.body.contains(popupOverlay)) {
      document.body.removeChild(popupOverlay);
    }
  });

  const logoContainer = document.createElement('div');
  logoContainer.style.cssText = `display: flex; align-items: center; justify-content: center; margin-bottom: 16px;`;

  const heading = document.createElement('h2');
  heading.textContent = 'Sign in to OpenMemory';
  heading.style.cssText = `margin: 0; font-size: 18px; font-weight: 600;`;
  logoContainer.appendChild(heading);

  const message = document.createElement('p');
  message.textContent =
    'Please sign in to access your memories and personalize your conversations!';
  message.style.cssText = `
    margin-bottom: 24px; color: #D4D4D8; font-size: 14px; line-height: 1.5; text-align: center;
  `;

  const signInButton = document.createElement('button');
  signInButton.style.cssText = `
    display: flex; align-items: center; justify-content: center; width: 100%;
    padding: 10px; background-color: white; color: black; border: none; border-radius: 8px;
    font-size: 14px; font-weight: 600; cursor: pointer; transition: background-color 0.2s;
  `;
  const logoDark = document.createElement('img');
  logoDark.src = chrome.runtime.getURL('icons/mem0-icon-black.png');
  logoDark.style.cssText = `width: 24px; height: 24px; border-radius: 50%; margin-right: 12px;`;
  const signInText = document.createElement('span');
  signInText.textContent = 'Sign in with Mem0';

  signInButton.appendChild(logoDark);
  signInButton.appendChild(signInText);

  signInButton.addEventListener('mouseenter', () => {
    signInButton.style.backgroundColor = '#f5f5f5';
  });
  signInButton.addEventListener('mouseleave', () => {
    signInButton.style.backgroundColor = 'white';
  });
  signInButton.addEventListener('click', () => {
    window.open(APP_LOGIN, '_blank');
    document.body.removeChild(popupOverlay);
  });

  popupContainer.appendChild(logoContainer);
  popupContainer.appendChild(message);
  popupContainer.appendChild(signInButton);
  popupOverlay.appendChild(popupContainer);
  popupOverlay.appendChild(closeButton);

  popupOverlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });

  document.body.appendChild(popupOverlay);
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
