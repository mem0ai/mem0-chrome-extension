/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { createMemButton } from '../components/mem_button';
import { API_MEMORIES, API_SEARCH, APP_LOGIN } from '../consts/api';
import { DEFAULT_USER_ID, type LoginData, MessageRole, SOURCE } from '../types/api';
import type { SearchStorage } from '../types/background_search';
import type { HistoryStateData } from '../types/browser';
import type { MemButtonController, MemButtonState } from '../types/memButton';
import type { MemoryItem, MemorySearchItem, OptionalApiParams } from '../types/memory';
import { StorageKey } from '../types/storage';
import { createOrchestrator, normalizeQuery } from '../utils/background_search';
import { OPENMEMORY_PROMPTS } from '../utils/llm_prompts';
import { createSearchSession } from '../utils/searchSession';
import { Theme, detectTheme } from '../utils/theme';
import { THEME_COLORS } from '../utils/ui/button_theme';
import { getBrowser, sendExtensionEvent } from '../utils/util_functions';

export {};

/** Keep DeepSeek input probing flexible like before */
const INPUT_SELECTOR = "#chat-input, textarea, [contenteditable='true']";

/** controller for mem0 button */
let memBtnCtrl: MemButtonController | null = null;

/** Global variables to store all memories */
let allMemories: string[] = [];

/** Initialize the MutationObserver variable */
let observer: MutationObserver;
let debounceTimer: number | undefined;

/** Track added memories by ID */
const allMemoriesById: Set<string> = new Set<string>();

let isProcessingMem0 = false;
let inputValueCopy = '';

/** Cache of the latest typed text to avoid race when the editor is cleared */
let lastTyped = '';

const searchSession = createSearchSession<MemoryItem>({ normalizeQuery });

/** DeepSeek search orchestrator (fetch + mapping into MemoryItem) */
const deepseekSearch = createOrchestrator({
  fetch: async function (query: string, opts: { signal?: AbortSignal }) {
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
    const userId =
      data[StorageKey.USER_ID_CAMEL] || data[StorageKey.USER_ID] || 'chrome-extension-user';
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
      signal: opts && opts.signal,
    });
    if (!res.ok) {
      throw new Error(`API request failed with status ${res.status}`);
    }
    return await res.json();
  },

  onSuccess: (normQuery: string, responseData: MemorySearchItem[]) => {
    const items: MemoryItem[] = (responseData || []).map((item, i) => ({
      id: String(item.id ?? `memory-${Date.now()}-${i}`),
      text: item.memory,
      categories: item.categories ?? [],
    }));
    searchSession.onSuccess(normQuery, items);
  },

  onError: (normQuery: string, err: Error) => {
    searchSession.onError(normQuery, err);
    console.log('Error searching memories', err);
  },

  minLength: 3,
  debounceMs: 150,
  cacheTTL: 60000,
});

/** Check if input has text (active state for button bg/check/shortcut) */
function computeActive(): boolean {
  const val = (getInputValue() || '').trim();
  return val.length > 3;
}

/** Wire idle visual state (background/check/shortcut) */
function wireIdleVisualState(): void {
  const apply = () => {
    if (!memBtnCtrl) {
      return;
    }
    const hasText = computeActive();
    const c = THEME_COLORS[detectTheme() as keyof typeof THEME_COLORS];
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

  const inputEl =
    (document.querySelector('div[contenteditable="true"].ProseMirror') as HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector('textarea') as HTMLTextAreaElement) ||
    (document.querySelector(INPUT_SELECTOR) as HTMLElement);

  if (!inputEl) {
    return;
  }

  inputEl.addEventListener('input', apply);
  inputEl.addEventListener('keyup', apply);
  inputEl.addEventListener('focus', apply);
  const mo = new MutationObserver(apply);
  mo.observe(inputEl, { childList: true, characterData: true, subtree: true });
}

/** Set the button state */
function setButtonState(s: MemButtonState) {
  memBtnCtrl?.setState(s);
}

/** Remove any previous DeepSeek legacy button/container */
function removeExistingButton(): void {
  const existingButton = document.querySelector('#mem0-icon-button') as HTMLElement;
  if (existingButton?.parentNode) {
    (existingButton.parentNode as HTMLElement).remove();
  }
  const floatingContainer = document.querySelector('#mem0-floating-container');
  if (floatingContainer) {
    floatingContainer.remove();
  }
}

/** Try to locate DeepSeek-specific container like before (keep placement behavior) */
function findDeepseekButtonContainer(): {
  container: HTMLElement;
  status: string;
  refBtn?: HTMLElement | null;
} | null {
  // Find the Search button (and in case of markup - and button, and div[role="button"])
  const allBtns = Array.from(
    document.querySelectorAll<HTMLElement>('button[role="button"], div[role="button"]')
  );
  const searchBtn =
    allBtns.find(b => (b.textContent || '').trim().toLowerCase() === 'search') || null;
  if (!searchBtn) {
    return null;
  }

  // Go up to the nearest FLEX-container-ROW,
  // in which the node with Search is a DIRECT child (through 0..N wrappers)
  let node: HTMLElement | null = searchBtn.parentElement as HTMLElement | null;

  const topChildOf = (container: HTMLElement, leaf: HTMLElement): HTMLElement | null => {
    let cur: HTMLElement | null = leaf;
    while (cur && cur.parentElement !== container) {
      cur = cur.parentElement as HTMLElement;
    }
    return cur && cur.parentElement === container ? cur : null;
  };

  while (node) {
    const cs = window.getComputedStyle(node);
    const isFlexRow = cs.display === 'flex' && cs.flexDirection !== 'column';
    const topChild = topChildOf(node, searchBtn);
    if (isFlexRow && topChild) {
      return { container: node, status: 'found_search_row', refBtn: searchBtn };
    }
    node = node.parentElement as HTMLElement | null;
  }

  // Nothing suitable - don't insert "floating" containers, just give up.
  return null;
}

/** Insert our new button into DeepSeek container respecting legacy placement details */
function insertIntoDeepseekContainer(
  buttonContainer: HTMLElement,
  mem0ButtonContainer: HTMLElement,
  _status: string,
  refBtn?: HTMLElement | null
): void {
  try {
    const topChildOf = (container: HTMLElement, leaf: HTMLElement): HTMLElement | null => {
      let cur: HTMLElement | null = leaf;
      while (cur && cur.parentElement !== container) {
        cur = cur.parentElement as HTMLElement;
      }
      return cur && cur.parentElement === container ? cur : null;
    };

    if (refBtn) {
      const anchor = topChildOf(buttonContainer, refBtn);
      if (anchor) {
        // INSERT RIGHT AFTER Search
        const after = anchor.nextSibling;
        buttonContainer.insertBefore(mem0ButtonContainer, after);
      } else {
        buttonContainer.appendChild(mem0ButtonContainer);
      }
    } else {
      // Fallback: try to find a child element containing the text "search"
      const childWithSearch =
        Array.from(buttonContainer.children).find(ch =>
          ((ch as HTMLElement).textContent || '').toLowerCase().includes('search')
        ) || null;
      if (childWithSearch) {
        buttonContainer.insertBefore(mem0ButtonContainer, childWithSearch.nextSibling);
      } else {
        buttonContainer.appendChild(mem0ButtonContainer);
      }
    }

    // to not shrink and become a row with buttons
    mem0ButtonContainer.style.cssText +=
      'flex:0 0 auto !important; display:inline-flex !important; margin-left:8px;';
  } catch {
    /* ignore */
  }
}

/** Shared function to update the input field with all collected memories */
function updateInputWithMemories(): void {
  let inputElement = document.querySelector('div[contenteditable="true"].ProseMirror');

  if (!inputElement) {
    inputElement =
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea') ||
      document.querySelector('p[data-placeholder="How can I help you today?"]') ||
      document.querySelector('p[data-placeholder="Reply to Claude..."]') ||
      document.querySelector(INPUT_SELECTOR);
  }

  if (inputElement && allMemories.length > 0) {
    const headerText = OPENMEMORY_PROMPTS.memory_header_text;

    if ((inputElement as HTMLElement).classList.contains('ProseMirror')) {
      const headerExists = Array.from(inputElement.querySelectorAll('p strong')).some(el =>
        (el.textContent || '').includes('Here is some of my memories')
      );

      if (headerExists) {
        const paragraphs = Array.from(inputElement.querySelectorAll('p')) as HTMLElement[];
        let headerIndex = -1;
        const existingMemories: string[] = [];

        for (let i = 0; i < paragraphs.length; i++) {
          const strongEl = paragraphs[i]?.querySelector('strong');
          if (strongEl && (strongEl.textContent || '').includes('Here is some of my memories')) {
            headerIndex = i;
            break;
          }
        }

        if (headerIndex >= 0) {
          for (let i = headerIndex + 1; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            if (!para) {
              continue;
            }
            const text = (para.textContent || '').trim();
            if (text.startsWith('-')) {
              existingMemories.push(text.substring(1).trim());
            }
          }

          const newHTML = Array.from(paragraphs)
            .slice(0, headerIndex + 1)
            .map(p => p.outerHTML)
            .join('');

          const combinedMemories = [...existingMemories];
          allMemories.forEach(mem => {
            if (!combinedMemories.includes(mem)) {
              combinedMemories.push(mem);
            }
          });

          const memoriesHTML = combinedMemories.map(mem => `<p>- ${mem}</p>`).join('');
          (inputElement as HTMLElement).innerHTML = newHTML + memoriesHTML;
        }
      } else {
        const baseContent = getContentWithoutMemories(undefined);
        let memoriesContent = `<p><strong>${headerText}</strong></p>`;
        memoriesContent += allMemories.map(mem => `<p>- ${mem}</p>`).join('');

        if (
          !baseContent ||
          baseContent.trim() === '' ||
          ((inputElement as HTMLElement).querySelectorAll('p').length === 1 &&
            (inputElement as HTMLElement).querySelector('p.is-empty') !== null)
        ) {
          (inputElement as HTMLElement).innerHTML = memoriesContent;
        } else {
          (inputElement as HTMLElement).innerHTML = `${baseContent}<p><br></p>${memoriesContent}`;
        }
      }

      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
      });
      (inputElement as HTMLElement).dispatchEvent(inputEvent);
      const changeEvent = new Event('change', { bubbles: true });
      (inputElement as HTMLElement).dispatchEvent(changeEvent);
    } else if ((inputElement as HTMLElement).tagName.toLowerCase() === 'div') {
      if ((inputElement as HTMLElement).innerHTML.includes(headerText)) {
        const htmlParts = (inputElement as HTMLElement).innerHTML.split(headerText);
        if (htmlParts.length > 1) {
          const beforeHeader = htmlParts[0];
          const afterHeader = htmlParts[1];

          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = afterHeader || '';
          const existingMemories: string[] = [];

          Array.from(tempDiv.querySelectorAll('p')).forEach(p => {
            const text = (p.textContent || '').trim();
            if (text.startsWith('-')) {
              existingMemories.push(text.substring(1).trim());
            }
          });

          const combinedMemories = [...existingMemories];
          allMemories.forEach(mem => {
            if (!combinedMemories.includes(mem)) {
              combinedMemories.push(mem);
            }
          });

          let newHTML = beforeHeader + `<p><strong>${headerText}</strong></p>`;
          combinedMemories.forEach(mem => {
            newHTML += `<p>- ${mem}</p>`;
          });

          (inputElement as HTMLElement).innerHTML = newHTML;
        }
      } else {
        const baseContent = getContentWithoutMemories(undefined);
        let memoriesContent = `<p><strong>${headerText}</strong></p>`;
        allMemories.forEach(mem => {
          memoriesContent += `<p>- ${mem}</p>`;
        });

        (inputElement as HTMLElement).innerHTML =
          `${baseContent}${baseContent ? '<p><br></p>' : ''}${memoriesContent}`;
      }

      (inputElement as HTMLElement).dispatchEvent(new Event('input', { bubbles: true }));
    } else if (
      (inputElement as HTMLElement).tagName.toLowerCase() === 'p' &&
      ((inputElement as HTMLElement).getAttribute('data-placeholder') ===
        'How can I help you today?' ||
        (inputElement as HTMLElement).getAttribute('data-placeholder') === 'Reply to Claude...')
    ) {
      const headerTextLocal = headerText;
      if (((inputElement as HTMLElement).textContent || '').includes(headerTextLocal)) {
        const textParts = ((inputElement as HTMLElement).textContent || '').split(headerTextLocal);
        if (textParts.length > 1) {
          const beforeHeader = textParts[0];
          const afterHeader = textParts[1];

          const existingMemories: string[] = [];
          const memoryLines = (afterHeader || '').split('\n');

          memoryLines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('-')) {
              existingMemories.push(trimmed.substring(1).trim());
            }
          });

          const combinedMemories = [...existingMemories];
          allMemories.forEach(mem => {
            if (!combinedMemories.includes(mem)) {
              combinedMemories.push(mem);
            }
          });

          const newText =
            beforeHeader +
            headerTextLocal +
            '\n\n' +
            combinedMemories.map(mem => `- ${mem}`).join('\n');
          (inputElement as HTMLElement).textContent = newText;
        }
      } else {
        const baseContent = getContentWithoutMemories(undefined);
        (inputElement as HTMLElement).textContent =
          `${baseContent}${baseContent ? '\n\n' : ''}${headerTextLocal}\n\n${allMemories.map(mem => `- ${mem}`).join('\n')}`;
      }

      (inputElement as HTMLElement).dispatchEvent(new Event('input', { bubbles: true }));
      (inputElement as HTMLElement).dispatchEvent(new Event('focus', { bubbles: true }));
      (inputElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      (inputElement as HTMLElement).dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      (inputElement as HTMLElement).dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const headerTextLocal = headerText;
      const ta = inputElement as HTMLTextAreaElement;
      if ((ta.value || '').includes(headerTextLocal)) {
        const valueParts = (ta.value || '').split(headerTextLocal);
        if (valueParts.length > 1) {
          const beforeHeader = valueParts[0];
          const afterHeader = valueParts[1];

          const existingMemories: string[] = [];
          const memoryLines = (afterHeader || '').split('\n');

          memoryLines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('-')) {
              existingMemories.push(trimmed.substring(1).trim());
            }
          });

          const combinedMemories = [...existingMemories];
          allMemories.forEach(mem => {
            if (!combinedMemories.includes(mem)) {
              combinedMemories.push(mem);
            }
          });

          ta.value =
            beforeHeader +
            headerTextLocal +
            '\n\n' +
            combinedMemories.map(mem => `- ${mem}`).join('\n');
        }
      } else {
        const baseContent = getContentWithoutMemories(undefined);
        (inputElement as HTMLTextAreaElement).value =
          `${baseContent}${baseContent ? '\n\n' : ''}${headerTextLocal}\n\n${allMemories.map(mem => `- ${mem}`).join('\n')}`;
      }

      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    (inputElement as HTMLElement).focus();
  }
}

/** Function to get the content without any memory wrappers */
function getContentWithoutMemories(providedMessage: string | undefined): string {
  let inputElement = document.querySelector('div[contenteditable="true"].ProseMirror');

  if (!inputElement) {
    inputElement =
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea') ||
      document.querySelector('p[data-placeholder="How can I help you today?"]') ||
      document.querySelector('p[data-placeholder="Reply to Claude..."]') ||
      document.querySelector(INPUT_SELECTOR);
  }

  let content = '';

  if (typeof providedMessage === 'string') {
    content = providedMessage;
  } else {
    if (!inputElement) {
      return '';
    }
    if ((inputElement as HTMLElement).classList.contains('ProseMirror')) {
      content = (inputElement as HTMLElement).innerHTML;
    } else if ((inputElement as HTMLElement).tagName.toLowerCase() === 'div') {
      content = (inputElement as HTMLElement).innerHTML;
    } else if (
      (inputElement as HTMLElement).tagName.toLowerCase() === 'p' &&
      ((inputElement as HTMLElement).getAttribute('data-placeholder') ===
        'How can I help you today?' ||
        (inputElement as HTMLElement).getAttribute('data-placeholder') === 'Reply to Claude...')
    ) {
      content =
        (inputElement as HTMLElement).innerHTML || (inputElement as HTMLElement).textContent || '';
    } else {
      content = (inputElement as HTMLTextAreaElement).value || '';
    }
  }

  try {
    const MEM0_HTML = OPENMEMORY_PROMPTS.memory_header_html_regex;
    const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
    content = content.replace(MEM0_HTML, '');
    content = content.replace(MEM0_PLAIN, '');
  } catch {
    /* ignore */
  }

  content = content.replace(/<p><br><\/p>$/g, '');
  content = content.replace(
    /<p class="is-empty"><br class="ProseMirror-trailingBreak"><\/p>$/g,
    ''
  );

  return content.trim();
}

/** Hook background typing to drive orchestrator text */
let deepseekBackgroundSearchHandler: (() => void) | null = null;
function hookDeepseekBackgroundSearchTyping() {
  const inputElement =
    document.querySelector('div[contenteditable="true"].ProseMirror') ||
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector('textarea') ||
    document.querySelector('p[data-placeholder="How can I help you today?"]') ||
    document.querySelector('p[data-placeholder="Reply to Claude..."]') ||
    document.querySelector(INPUT_SELECTOR);

  if (!inputElement) {
    return;
  }

  if (!deepseekBackgroundSearchHandler) {
    deepseekBackgroundSearchHandler = function () {
      let text = getInputValue() || '';
      try {
        const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
        text = text.replace(MEM0_PLAIN, '').trim();
      } catch {
        /* ignore */
      }
      deepseekSearch.setText(text);
    };
  }

  inputElement.addEventListener('input', deepseekBackgroundSearchHandler);
  inputElement.addEventListener('keyup', deepseekBackgroundSearchHandler);
}

/** Function to get memory enabled state from storage */
async function getMemoryEnabledState(): Promise<boolean> {
  return new Promise(resolve => {
    try {
      chrome.storage.sync.get([StorageKey.MEMORY_ENABLED], data => {
        try {
          if (chrome.runtime?.lastError) {
            resolve(true);
            return;
          }
          resolve(data.memory_enabled !== false); // default to true
        } catch {
          resolve(true);
        }
      });
    } catch {
      resolve(true);
    }
  });
}

/** Function to show memories popup (success/error) */
function showMemoriesPopup(isSuccess: boolean): void {
  const existingPopup = document.querySelector('.mem0-memories-popup') as HTMLElement;
  if (existingPopup) {
    existingPopup.remove();
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
  content.style.cssText = `
    font-size: 14px;
    line-height: 1.4;
    color: ${colors.POPUP_TEXT};
    text-align: center;
  `;
  content.textContent = isSuccess ? 'Memories added' : 'Error while adding memories';

  popup.appendChild(content);
  document.body.appendChild(popup);

  setTimeout(() => {
    if (document.body.contains(popup)) {
      popup.remove();
    }
  }, 3000);
}

// Function to show a small popup message near the button
function showButtonPopup(button: HTMLElement, message: string): void {
  // Remove any existing popups
  const existingPopup = document.querySelector('.mem0-button-popup') as HTMLElement;
  if (existingPopup) {
    existingPopup.remove();
  }

  // Also hide any hover popover that might be showing
  const hoverPopover = document.querySelector('.mem0-button-popover') as HTMLElement;
  if (hoverPopover) {
    hoverPopover.style.opacity = '0';
    hoverPopover.style.display = 'none';
  }

  const popup = document.createElement('div');
  popup.className = 'mem0-button-popup';

  // Get button position
  const buttonRect = button.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

  popup.style.cssText = `
    position: fixed;
    top: ${buttonRect.top + scrollTop - 45}px;
    left: ${buttonRect.left + scrollLeft + buttonRect.width / 2}px;
    transform: translateX(-50%);
    background-color: #1C1C1E;
    border: 1px solid #27272A;
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    white-space: nowrap;
    z-index: 999999999;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  `;

  popup.textContent = message;

  // Create arrow
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

  // Add to body instead of button
  document.body.appendChild(popup);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (document.body.contains(popup)) {
      popup.remove();
    }
  }, 3000);
}

/** Function to show login popup */
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
  signInButton.addEventListener(
    'mouseenter',
    () => (signInButton.style.backgroundColor = '#f5f5f5')
  );
  signInButton.addEventListener('mouseleave', () => (signInButton.style.backgroundColor = 'white'));
  signInButton.addEventListener('click', () => {
    window.open(APP_LOGIN, '_blank');
    if (document.body.contains(popupOverlay)) {
      document.body.removeChild(popupOverlay);
    }
  });

  popupContainer.appendChild(logoContainer);
  popupContainer.appendChild(message);
  popupContainer.appendChild(signInButton);

  popupOverlay.appendChild(popupContainer);
  popupOverlay.appendChild(closeButton);

  popupOverlay.addEventListener('click', e => {
    if (e.target === popupOverlay && document.body.contains(popupOverlay)) {
      document.body.removeChild(popupOverlay);
    }
  });

  document.body.appendChild(popupOverlay);
}

function getLastMessages(count: number): Array<{ role: MessageRole; content: string }> {
  // DeepSeek/universal containers
  const container =
    document.querySelector('.ds-chat__messages') ||
    document.querySelector('.flex-1.flex.flex-col.gap-3.px-4.max-w-3xl.mx-auto.w-full');

  if (!container) {
    return [];
  }

  const nodes = Array.from(container.children).reverse(); // from the end
  const out: Array<{ role: MessageRole; content: string }> = [];

  for (const el of nodes) {
    if (out.length >= count) {
      break;
    }

    const userEl = (el as HTMLElement).querySelector(
      '.ds-message--user, .font-user-message, [data-message-author-role="user"]'
    );
    const assistantEl = (el as HTMLElement).querySelector(
      '.ds-message--assistant, .font-claude-message, [data-message-author-role="assistant"]'
    );

    if (userEl) {
      const content = (userEl.textContent || '').trim();
      if (content) {
        out.unshift({ role: MessageRole.User, content });
      }
    } else if (assistantEl) {
      const content = (assistantEl.textContent || '').trim();
      if (content) {
        out.unshift({ role: MessageRole.Assistant, content });
      }
    }
  }

  return out;
}

function getInputValue(): string | null {
  const el =
    (document.querySelector('div[contenteditable="true"].ProseMirror') as HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector('textarea') as HTMLTextAreaElement) ||
    (document.querySelector(
      'p[data-placeholder="How can I help you today?"]'
    ) as HTMLParagraphElement) ||
    (document.querySelector('p[data-placeholder="Reply to Claude..."]') as HTMLParagraphElement) ||
    (document.querySelector(INPUT_SELECTOR) as HTMLElement);

  if (!el) {
    return null;
  }
  if ((el as HTMLElement).tagName.toLowerCase() === 'p') {
    return (el as HTMLElement).textContent || '';
  }
  return (el as HTMLElement).textContent || (el as HTMLInputElement)?.value || null;
}

/** Function to add the Mem0 button (DeepSeek): uses new button + legacy placement */
async function addMem0IconButton(): Promise<void> {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    removeExistingButton();
    return;
  }

  if (document.querySelector('#mem0-icon-button')) {
    return;
  }

  const placement = findDeepseekButtonContainer();
  if (!placement) {
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
        console.error('Error handling Mem0 button click:', e);
      }
    },
    marginLeft: '-8px',
  });
  memBtnCtrl = ctrl;

  const wrapper = document.createElement('div');
  wrapper.id = 'mem0-icon-button-wrapper';
  wrapper.style.cssText = 'display:inline-flex;position:relative;align-items:center;margin:0 4px;';
  wrapper.appendChild(ctrl.root);

  insertIntoDeepseekContainer(
    placement.container,
    wrapper,
    placement.status,
    placement.refBtn || undefined
  );

  ctrl.wireHover(computeActive);
  wireIdleVisualState();
  addSendButtonListener();
}

/** Modified function to handle Mem0 button click - searches and adds immediately */
async function handleMem0Click(): Promise<void> {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    return;
  }

  const loginData = await new Promise<LoginData>(resolve => {
    chrome.storage.sync.get(
      [StorageKey.API_KEY, StorageKey.USER_ID_CAMEL, StorageKey.ACCESS_TOKEN],
      items => resolve(items as LoginData)
    );
  });
  if (!loginData[StorageKey.API_KEY] && !loginData[StorageKey.ACCESS_TOKEN]) {
    showLoginPopup();
    return;
  }

  const memBtn = document.querySelector('#mem0-icon-button') as HTMLElement;
  let message = getInputValue() || '';

  if (!message || message.trim() === '' || message.trim().length <= 3) {
    if (memBtn) {
      showButtonPopup(memBtn, 'Please enter some text first');
    }
    return;
  }

  try {
    const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
    message = message.replace(MEM0_PLAIN, '').trim();
  } catch {
    /* ignore */
  }

  if (isProcessingMem0) {
    return;
  }
  isProcessingMem0 = true;
  setButtonState('loading');

  try {
    sendExtensionEvent('modal_clicked', {
      provider: 'deepseek',
      source: 'OPENMEMORY_CHROME_EXTENSION',
      browser: getBrowser(),
    });

    const items = await searchSession.runSearchAndWait(deepseekSearch, message);

    // Fresh set
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

    // Parallel snapshot save
    captureAndStoreMemorySnapshot();
  } catch (error) {
    if ((error as Error).message === 'no-result') {
      if (memBtn) {
        showButtonPopup(memBtn, 'Too short or no matches');
      }
    } else {
      console.error('Error:', error);
      showMemoriesPopup(false);
    }
    setButtonState('error');
  } finally {
    setTimeout(() => setButtonState('added'), 500);
    setTimeout(() => setButtonState('success'), 1500);
    isProcessingMem0 = false;
  }
}

/** Add an event listener for the send button / Enter to clear memories after sending */
function addSendButtonListener(): void {
  const inputElement =
    (document.querySelector('div[contenteditable="true"].ProseMirror') as HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector('textarea') as HTMLTextAreaElement) ||
    (document.querySelector(INPUT_SELECTOR) as HTMLElement);

  if (inputElement && !(inputElement as HTMLElement).dataset.mem0KeyListener) {
    (inputElement as HTMLElement).dataset.mem0KeyListener = 'true';
    (inputElement as HTMLElement).addEventListener('keydown', function (event: KeyboardEvent) {
      inputValueCopy =
        (inputElement as HTMLInputElement).value ||
        (inputElement as HTMLElement).textContent ||
        inputValueCopy;

      // Standard send behavior: Enter without Shift/Ctrl/Meta
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const current = getInputValue();
        if (current && current.trim() !== '') {
          lastTyped = current;
        }

        // Save snapshot
        captureAndStoreMemorySnapshot();

        // Clear all memories after sending
        setTimeout(() => {
          allMemories = [];
          allMemoriesById.clear();
        }, 100);
      }
    });
  }

  // Also try to hook a DeepSeek send button
  const dsButtons = Array.from(document.querySelectorAll('div[role="button"]')) as HTMLDivElement[];
  const sendBtn =
    dsButtons.find(b => {
      const rect = b.getBoundingClientRect();
      return (
        rect.width > 0 && rect.height > 0 && (b.textContent || '').toLowerCase().includes('send')
      );
    }) || null;

  if (sendBtn && !(sendBtn as HTMLElement).dataset?.mem0Listener) {
    (sendBtn as HTMLElement).dataset.mem0Listener = 'true';
    sendBtn.addEventListener('click', function () {
      captureAndStoreMemorySnapshot();
      setTimeout(() => {
        allMemories = [];
        allMemoriesById.clear();
      }, 100);
    });
  }
}

/** Function to capture and store memory asynchronously */
function captureAndStoreMemorySnapshot(): void {
  const inputElement =
    (document.querySelector('div[contenteditable="true"].ProseMirror') as HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector('textarea') as HTMLTextAreaElement) ||
    (document.querySelector(INPUT_SELECTOR) as HTMLElement);

  if (!inputElement) {
    return;
  }

  let message =
    (inputElement as HTMLElement).textContent || (inputElement as HTMLInputElement).value;

  if (!message || message.trim() === '') {
    message = inputValueCopy || lastTyped;
  }
  if (!message || message.trim() === '' || message.trim().length <= 3) {
    const btn = document.querySelector('#mem0-icon-button') as HTMLElement | null;
    if (btn) {
      showButtonPopup(btn, 'Please enter some text first');
    }
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
    items => {
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

      const messages = getLastMessages(2);
      messages.push({ role: MessageRole.User, content: message });

      const optionalParams: OptionalApiParams = {};
      if (items[StorageKey.SELECTED_ORG]) {
        optionalParams.org_id = items[StorageKey.SELECTED_ORG];
      }
      if (items[StorageKey.SELECTED_PROJECT]) {
        optionalParams.project_id = items[StorageKey.SELECTED_PROJECT];
      }

      const storagePayload = {
        messages,
        user_id: userId,
        infer: true,
        metadata: { provider: 'DeepSeek' },
        source: SOURCE,
        ...optionalParams,
      };

      fetch(API_MEMORIES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify(storagePayload),
      }).catch(error => {
        console.error('Error saving memory:', error);
      });
    }
  );
}

/** Prime caches so the very first send is captured */
function computeAndPrimeCaches(): void {
  const _initVal = getInputValue();
  if (_initVal && _initVal.trim()) {
    lastTyped = _initVal;
  }
}

/** Initialize DeepSeek integration with new button + background typing hooks */
function initializeMem0Integration(): void {
  document.addEventListener('DOMContentLoaded', () => {
    (async () => await addMem0IconButton())();
    addSendButtonListener();
    wireIdleVisualState();
    hookDeepseekBackgroundSearchTyping();
  });

  // Ctrl+M shortcut
  document.addEventListener('keydown', function (event) {
    if (event.ctrlKey && event.key === 'm') {
      event.preventDefault();
      (async () => {
        const enabled = await getMemoryEnabledState();
        if (enabled) {
          await handleMem0Click();
        }
      })();
    }
  });

  computeAndPrimeCaches();

  observer = new MutationObserver(() => {
    if (debounceTimer) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      (async () => {
        const enabled = await getMemoryEnabledState();
        if (enabled) {
          await addMem0IconButton();
          hookDeepseekBackgroundSearchTyping();
        } else {
          removeExistingButton();
        }
      })();
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // SPA navigation handling
  let currentUrl = window.location.href;

  function detectNavigation(): void {
    const newUrl = window.location.href;
    if (newUrl !== currentUrl) {
      currentUrl = newUrl;

      setTimeout(() => {
        (async () => {
          await addMem0IconButton();
          addSendButtonListener();
          wireIdleVisualState();
          hookDeepseekBackgroundSearchTyping();
        })();
      }, 300);
    }
  }

  setInterval(() => {
    detectNavigation();
  }, 1000);

  window.addEventListener('popstate', () => setTimeout(detectNavigation, 100));
  const originalPushState = history.pushState;
  history.pushState = function (data: HistoryStateData, unused: string, url?: string | URL | null) {
    originalPushState.call(history, data, unused, url);
    setTimeout(detectNavigation, 100);
  };
  const originalReplaceState = history.replaceState;
  history.replaceState = function (
    data: HistoryStateData,
    unused: string,
    url?: string | URL | null
  ) {
    originalReplaceState.call(history, data, unused, url);
    setTimeout(detectNavigation, 100);
  };
}

initializeMem0Integration();
