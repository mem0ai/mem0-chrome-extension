/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { createMemButton } from '../components/mem_button';
import { API_MEMORIES, API_SEARCH, APP_LOGIN } from '../consts/api';
import { DEFAULT_USER_ID, type LoginData, MessageRole, SOURCE } from '../types/api';
import type { SearchStorage } from '../types/background_search';
import type { HistoryStateData } from '../types/browser';
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

// Check if the input has text
function computeActive(): boolean {
  const el =
    (document.querySelector('#prompt-textarea') as HTMLTextAreaElement | HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector('textarea') as HTMLTextAreaElement);
  const val = el ? (el.textContent || (el as HTMLTextAreaElement).value || '').trim() : '';
  return val.length > 3;
}

// Wire idle visual state (background/check/shortcut)
function wireIdleVisualState(): void {
  const input =
    (document.querySelector('#prompt-textarea') as HTMLTextAreaElement | HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector('textarea') as HTMLTextAreaElement);
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
      // Set the background color based on the input text
      memBtnCtrl.button.style.backgroundColor = hasText ? c.BUTTON_BG_ACTIVE : c.BUTTON_BG;
    }
    memBtnCtrl.elements.checkmark.style.display = hasText ? 'inline-block' : 'none';
    // Set the shortcut display based on the input text
    memBtnCtrl.elements.shortcut.style.display = hasText ? 'inline-block' : 'none';
    // Set the text color based on the input text
    if (detectTheme() === Theme.LIGHT) {
      const color = hasText ? 'white' : '#1a1a1a';
      memBtnCtrl.elements.text.style.color = color;
      memBtnCtrl.elements.checkmark.style.color = color;
    }
  };

  apply();
  // Listen for input changes
  input.addEventListener('input', apply);
  input.addEventListener('keyup', apply);
  input.addEventListener('focus', apply);
  const mo = new MutationObserver(apply);
  mo.observe(input, { childList: true, characterData: true, subtree: true });
}

// Set the button state
function setButtonState(s: MemButtonState) {
  memBtnCtrl?.setState(s);
}

let isProcessingMem0: boolean = false;

// Initialize the MutationObserver variable
let observer: MutationObserver;

// Global variable to store all memories
let allMemories: string[] = [];

// Track added memories by ID
const allMemoriesById: Set<string> = new Set<string>();

let inputValueCopy: string = '';

const searchSession = createSearchSession<MemoryItem>({ normalizeQuery });

const chatgptSearch = createOrchestrator({
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
        function (items) {
          resolve(items as SearchStorage);
        }
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
      threshold: threshold,
      top_k: topK,
      filter_memories: false,
      source: 'OPENMEMORY_CHROME_EXTENSION',
      ...optionalParams,
    };

    const res = await fetch(API_SEARCH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
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

// Helper functions for main logic
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

function findOrCreateButtonContainer(): HTMLElement | null {
  const plusButton = document.querySelector('button[data-testid="composer-plus-btn"]');
  const plusButtonParent = plusButton?.closest('span.flex');
  const leadingContainer = plusButton?.closest('div[class*="leading"]');

  if (plusButton && leadingContainer) {
    // Return parent of the plusButtonParent
    return (plusButtonParent?.parentElement as HTMLElement) || leadingContainer;
  }

  // Fallback: create floating container
  const inputElement =
    document.querySelector('#prompt-textarea') ||
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector('textarea');

  if (inputElement) {
    const container = document.createElement('div');
    container.id = 'mem0-floating-container';
    container.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 1000;
      display: flex;
      gap: 4px;
    `;
    document.body.appendChild(container);
    return container;
  }

  return null;
}

function insertButtonIntoContainer(
  buttonContainer: HTMLElement,
  mem0ButtonContainer: HTMLElement
): void {
  const plusButton = document.querySelector('button[data-testid="composer-plus-btn"]');

  if (plusButton && buttonContainer.contains(plusButton)) {
    // Insert our button after the parent of the plusButtonParent, not inside it
    const plusButtonParent = plusButton.closest('span.flex');
    if (plusButtonParent && plusButtonParent.parentElement) {
      plusButtonParent.parentElement.insertBefore(
        mem0ButtonContainer,
        plusButtonParent.nextSibling
      );
    } else {
      // Fallback: insert after the GPT button
      plusButton.parentElement?.insertBefore(mem0ButtonContainer, plusButton.nextSibling);
    }
  } else {
    buttonContainer.appendChild(mem0ButtonContainer);
  }

  // Ensure horizontal layout
  buttonContainer.style.cssText += `
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    gap: 8px !important;
  `;
}

// Shared function to update the input field with all collected memories
function updateInputWithMemories(): void {
  const inputElement =
    document.querySelector('#prompt-textarea') ||
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector('textarea');

  if (inputElement && allMemories.length > 0) {
    // Get the content without any existing memory wrappers
    const baseContent = getContentWithoutMemories();

    // Create the memory wrapper with all collected memories
    let memoriesContent =
      '<div id="mem0-wrapper" contenteditable="false" style="background-color: rgb(220, 252, 231); padding: 8px; border-radius: 4px; margin-top: 8px; margin-bottom: 8px;">';
    memoriesContent += OPENMEMORY_PROMPTS.memory_header_html_strong;

    // Add all memories to the content
    allMemories.forEach((mem, idx) => {
      const safe = (mem || '').toString();
      memoriesContent += `<div data-mem0-idx="${idx}" style="user-select: text;">- ${safe}</div>`;
    });
    memoriesContent += '</div>';

    // Add the final content to the input
    if (inputElement.tagName.toLowerCase() === 'div') {
      inputElement.innerHTML = `${baseContent}<div><br></div>${memoriesContent}`;
    } else {
      (inputElement as HTMLTextAreaElement).value = `${baseContent}\n${memoriesContent}`;
    }

    // Make only the wrapper non-editable; allow user to select/copy text inside
    try {
      const wrapper = document.getElementById('mem0-wrapper');
      if (wrapper) {
        wrapper.setAttribute('contenteditable', 'false');
        wrapper.style.userSelect = 'text';
      }
    } catch {
      // Ignore errors when setting contenteditable
    }

    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Function to get the content without any memory wrappers
function getContentWithoutMemories(message?: string): string {
  if (typeof message === 'string') {
    return message;
  }

  const inputElement =
    (document.querySelector('#prompt-textarea') as HTMLTextAreaElement | HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector('textarea') as HTMLTextAreaElement);

  if (!inputElement) {
    return '';
  }

  let content =
    (inputElement as HTMLTextAreaElement)?.value ||
    inputElement.textContent ||
    (inputElement as HTMLDivElement).innerHTML;

  if (
    message &&
    (!content ||
      content.trim() ===
        '<p data-placeholder="Ask anything" class="placeholder"><br class="ProseMirror-trailingBreak"></p>')
  ) {
    content = message;
  }

  // Remove any memory wrappers
  content = content.replace(/<div id="mem0-wrapper"[\s\S]*?<\/div>/g, '');

  // Remove any memory headers using shared prompts (HTML and plain variants)
  try {
    const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
    const MEM0_HTML = OPENMEMORY_PROMPTS.memory_header_html_regex;
    content = content.replace(MEM0_HTML, '');
    content = content.replace(MEM0_PLAIN, '');
  } catch {
    // Ignore errors during re-initialization
  }

  // Clean up any leftover paragraph markers
  content = content.replace(/<p><br class="ProseMirror-trailingBreak"><\/p><p>$/g, '');

  // Replace <p> with nothing
  content = content.replace(/<p>[\s\S]*?<\/p>/g, '');

  return content.trim();
}

// Add an event listener for the send button to clear memories after sending
function addSendButtonListener(): void {
  const sendButton = document.querySelector('#composer-submit-button') as HTMLButtonElement;

  if (sendButton && !sendButton.dataset.mem0Listener) {
    sendButton.dataset.mem0Listener = 'true';
    sendButton.addEventListener('click', function () {
      // Capture and save memory asynchronously
      captureAndStoreMemory();

      // Clear all memories after sending
      setTimeout(() => {
        allMemories = [];
        allMemoriesById.clear();
      }, 100);
    });

    // Also handle Enter key press
    const inputElement =
      (document.querySelector('#prompt-textarea') as HTMLTextAreaElement | HTMLDivElement) ||
      (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
      (document.querySelector('textarea') as HTMLTextAreaElement);

    if (inputElement && !inputElement.dataset.mem0KeyListener) {
      inputElement.dataset.mem0KeyListener = 'true';
      (inputElement as HTMLElement).addEventListener('keydown', function (event: KeyboardEvent) {
        // Check if Enter was pressed without Shift (standard send behavior)

        inputValueCopy =
          (inputElement as HTMLTextAreaElement)?.value ||
          inputElement.textContent ||
          inputValueCopy;

        if (event.key === 'Enter' && !event.shiftKey) {
          // Capture and save memory asynchronously
          captureAndStoreMemory();

          // Clear all memories after sending
          setTimeout(() => {
            allMemories = [];
            allMemoriesById.clear();
          }, 100);
        }
      });
    }
  }
}

// Function to capture and store memory asynchronously
function captureAndStoreMemory(): void {
  // Get the message content
  // id is prompt-textarea
  const inputElement =
    (document.querySelector('#prompt-textarea') as HTMLTextAreaElement | HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector('textarea') as HTMLTextAreaElement) ||
    (document.querySelector('textarea[data-virtualkeyboard="true"]') as HTMLTextAreaElement);

  if (!inputElement) {
    return;
  }

  // Get raw content from the input element
  let message = inputElement.textContent || (inputElement as HTMLTextAreaElement)?.value;

  if (!message || message.trim() === '') {
    message = inputValueCopy;
  }

  if (!message || message.trim() === '' || message.trim().length <= 3) {
    const btn = document.querySelector('#mem0-icon-button') as HTMLElement | null;
    if (btn) {
      showButtonPopup(btn, 'Please enter some text first');
    }
    return;
  }

  // Clean the message of any memory wrapper content
  message = getContentWithoutMemories(message);

  // Skip if message is empty after cleaning
  if (!message || message.trim() === '') {
    return;
  }

  // Asynchronously store the memory
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
      // Skip if memory is disabled or no credentials
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

      // Get recent messages for context (if available)
      const messages = getLastMessages(2);
      messages.push({ role: MessageRole.User, content: message });

      const optionalParams: OptionalApiParams = {};
      if (items[StorageKey.SELECTED_ORG]) {
        optionalParams.org_id = items[StorageKey.SELECTED_ORG];
      }
      if (items[StorageKey.SELECTED_PROJECT]) {
        optionalParams.project_id = items[StorageKey.SELECTED_PROJECT];
      }

      // Send memory to mem0 API asynchronously without waiting for response
      const storagePayload = {
        messages: messages,
        user_id: userId,
        infer: true,
        metadata: {
          provider: Provider.ChatGPT,
        },
        source: SOURCE,
        ...optionalParams,
      };

      fetch(API_MEMORIES, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(storagePayload),
      }).catch(error => {
        console.error('Error saving memory:', error);
      });
    }
  );
}

// Function to add the Mem0 button next to the plus icon
async function addMem0IconButton(): Promise<void> {
  // Check if memory is enabled
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    removeExistingButton();
    return;
  }

  const buttonContainer = findOrCreateButtonContainer();
  if (!buttonContainer || document.querySelector('#mem0-icon-button')) {
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
          await handleMem0Modal();
        }
      } catch (e) {
        console.error('Error handling Mem0 button click:', e);
      }
    },
  });
  memBtnCtrl = ctrl;
  // Insert next to the plus button (your logic position)
  insertButtonIntoContainer(buttonContainer, ctrl.root);
  // hover: active background when there is text in the input
  ctrl.wireHover(computeActive);
  // maintain idle state (background/check/shortcut)
  wireIdleVisualState();
  // listener for sending
  addSendButtonListener();
}

// Modified function to handle Mem0 button click - now it will search and add memories
async function handleMem0Modal(): Promise<void> {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    return;
  }

  // login/token
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

  const mem0Button = document.querySelector('#mem0-icon-button') as HTMLElement;
  let message = getInputValue();

  if (!message || message.trim() === '') {
    if (mem0Button) {
      showButtonPopup(mem0Button, 'Please enter some text first');
    }
    return;
  }

  if (!message || message.trim() === '' || message.trim().length <= 3) {
    if (mem0Button) {
      showButtonPopup(mem0Button, 'Please enter some text first');
    }
    return;
  }

  try {
    const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
    message = message.replace(MEM0_PLAIN, '').trim();
  } catch {
    /* ignore */
  }
  const endIndex = message.indexOf('</p>');
  if (endIndex !== -1) {
    message = message.slice(0, endIndex + 4);
  }

  if (isProcessingMem0) {
    return;
  }
  isProcessingMem0 = true;
  setButtonState('loading');

  try {
    sendExtensionEvent('modal_clicked', {
      provider: 'chatgpt',
      source: 'OPENMEMORY_CHROME_EXTENSION',
      browser: getBrowser(),
    });

    // Waiting for orchestrator response
    const items = await searchSession.runSearchAndWait(chatgptSearch, message);

    // Remove all
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
    captureAndStoreMemory();
  } catch (error) {
    if ((error as Error).message === 'no-result') {
      if (mem0Button) {
        showButtonPopup(mem0Button, 'Too short or no matches');
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

// Function to show memories popup
function showMemoriesPopup(isSuccess: boolean): void {
  // Remove any existing popups
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

  // Create content
  const content = document.createElement('div');
  content.style.cssText = `
    font-size: 14px;
    line-height: 1.4;
    color: ${colors.POPUP_TEXT};
    text-align: center;
  `;

  if (isSuccess) {
    content.textContent = 'Memories added';
  } else {
    content.textContent = 'Error while adding memories';
  }

  popup.appendChild(content);

  // Add to body
  document.body.appendChild(popup);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (document.body.contains(popup)) {
      popup.remove();
    }
  }, 3000);
}

// Function to show a small popup message near the button
function showButtonPopup(button: HTMLElement, message: string): void {
  let host = button || document.getElementById('mem0-icon-button');
  if (!host) {
    return;
  }
  let root = host.shadowRoot || host;
  // Remove any existing popups
  const existingPopup = root.querySelector('.mem0-button-popup');
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
  root.appendChild(popup);

  // Add to body instead of button
  document.body.appendChild(popup);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (document.body.contains(popup)) {
      popup.remove();
    }
  }, 3000);

  // Position relative to button
  // button.style.position = 'relative';
  // button.appendChild(popup);

  // // Auto-remove after 3 seconds
  // setTimeout(() => {
  //   if (document.body.contains(popup)) {
  //     popup.remove();
  //   }
  // }, 3000);
}

function getLastMessages(count: number): Array<{ role: MessageRole; content: string }> {
  const messageContainer = document.querySelector('.flex.flex-col.text-sm.md\\:pb-9');
  if (!messageContainer) {
    return [];
  }

  const messageElements = Array.from(messageContainer.children).reverse();
  const messages: Array<{ role: MessageRole; content: string }> = [];

  for (const element of messageElements) {
    if (messages.length >= count) {
      break;
    }

    const userElement = element.querySelector('[data-message-author-role="user"]');
    const assistantElement = element.querySelector('[data-message-author-role="assistant"]');

    if (userElement) {
      const content = userElement.querySelector('.whitespace-pre-wrap')?.textContent?.trim() || '';
      messages.unshift({ role: MessageRole.User, content });
    } else if (assistantElement) {
      const content = assistantElement.querySelector('.markdown')?.textContent?.trim() || '';
      messages.unshift({ role: MessageRole.Assistant, content });
    }
  }

  return messages;
}

function getInputValue(): string {
  const inputElement =
    (document.querySelector('#prompt-textarea') as HTMLTextAreaElement | HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector('textarea') as HTMLTextAreaElement);

  return inputElement
    ? inputElement.textContent || (inputElement as HTMLTextAreaElement)?.value || ''
    : '';
}

let chatgptBackgroundSearchHandler: ((this: Element, ev: Event) => void) | null = null;

function hookBackgroundSearchTyping() {
  const inputElement =
    document.querySelector('#prompt-textarea') ||
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector('textarea');
  if (!inputElement) {
    return;
  }

  if (!chatgptBackgroundSearchHandler) {
    chatgptBackgroundSearchHandler = function () {
      const text = getInputValue() || '';
      chatgptSearch.setText(text);
    };
  }
  inputElement.addEventListener(
    'input',
    chatgptBackgroundSearchHandler as (this: Element, ev: Event) => void
  );
  inputElement.addEventListener(
    'keyup',
    chatgptBackgroundSearchHandler as (this: Element, ev: Event) => void
  );
}

function addSyncButton(): void {
  const buttonContainer = document.querySelector('div.mt-5.flex.justify-end');
  if (buttonContainer) {
    let syncButton = document.querySelector('#sync-button') as HTMLButtonElement;

    // If the syncButton does not exist, create it
    if (!syncButton) {
      syncButton = document.createElement('button');
      syncButton.id = 'sync-button';
      syncButton.className = 'btn relative btn-neutral mr-2';
      syncButton.style.color = 'rgb(213, 213, 213)';
      syncButton.style.backgroundColor = 'transparent';
      syncButton.innerHTML =
        '<div id="sync-button-content" class="flex items-center justify-center font-semibold">Sync Memory</div>';
      syncButton.style.border = '1px solid rgb(213, 213, 213)';
      syncButton.style.fontSize = '12px';
      syncButton.style.fontWeight = '500';
      // add margin right to syncButton
      syncButton.style.marginRight = '8px';

      const syncIcon = document.createElement('img');
      syncIcon.src = chrome.runtime.getURL('icons/mem0-claude-icon.png');
      syncIcon.style.width = '16px';
      syncIcon.style.height = '16px';
      syncIcon.style.marginRight = '8px';

      syncButton.prepend(syncIcon);

      syncButton.addEventListener('click', handleSyncClick);

      syncButton.addEventListener('mouseenter', () => {
        if (!syncButton!.disabled) {
          syncButton!.style.filter = 'opacity(0.7)';
        }
      });
      syncButton.addEventListener('mouseleave', () => {
        if (!syncButton!.disabled) {
          syncButton!.style.filter = 'opacity(1)';
        }
      });
    }

    if (!buttonContainer.contains(syncButton)) {
      buttonContainer.insertBefore(syncButton, buttonContainer.firstChild);
    }

    // Update sync button state
    const updateSyncButtonState = (): void => {
      // Define when the sync button should be enabled or disabled
      (syncButton as HTMLButtonElement).disabled = false; // For example, always enabled
      // Update opacity or pointer events if needed
      if ((syncButton as HTMLButtonElement).disabled) {
        (syncButton as HTMLButtonElement).style.opacity = '0.5';
        (syncButton as HTMLButtonElement).style.pointerEvents = 'none';
      } else {
        (syncButton as HTMLButtonElement).style.opacity = '1';
        (syncButton as HTMLButtonElement).style.pointerEvents = 'auto';
      }
    };

    updateSyncButtonState();
  } else {
    // If resetMemoriesButton or specificTable is not found, remove syncButton from DOM
    const existingSyncButton = document.querySelector('#sync-button');
    if (existingSyncButton && existingSyncButton.parentNode) {
      existingSyncButton.parentNode.removeChild(existingSyncButton);
    }
  }
}

function handleSyncClick(): void {
  getMemoryEnabledState().then(memoryEnabled => {
    if (!memoryEnabled) {
      const btn = document.querySelector('#sync-button') as HTMLElement;
      if (btn) {
        showSyncPopup(btn, 'Memory is disabled');
      }
      return;
    }

    const table = document.querySelector('table.w-full.border-separate.border-spacing-0');
    const syncButton = document.querySelector('#sync-button') as HTMLButtonElement;

    if (table && syncButton) {
      const rows = table.querySelectorAll('tbody tr');
      const memories: Array<{ role: string; content: string }> = [];

      // Change sync button state to loading
      setSyncButtonLoadingState(true);

      let syncedCount = 0;
      const totalCount = rows.length;

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 1 && cells[0]) {
          const content =
            cells[0].querySelector('div.whitespace-pre-wrap')?.textContent?.trim() || '';

          const memory = {
            role: MessageRole.User,
            content: `Remember this about me: ${content}`,
          };

          memories.push(memory);

          sendMemoryToMem0(memory, false)
            .then(() => {
              syncedCount++;
              if (syncedCount === totalCount) {
                showSyncPopup(syncButton, `${syncedCount} memories synced`);
                setSyncButtonLoadingState(false);
                // Open the modal with memories after syncing
                // handleMem0Modal('sync-button');
              }
            })
            .catch(() => {
              if (syncedCount === totalCount) {
                showSyncPopup(syncButton, `${syncedCount}/${totalCount} memories synced`);
                setSyncButtonLoadingState(false);
                // Open the modal with memories after syncing
                // handleMem0Modal('sync-button');
              }
            });
        }
      });

      sendMemoriesToMem0(memories)
        .then(() => {
          if (syncButton) {
            showSyncPopup(syncButton, `${memories.length} memories synced`);
          }
          setSyncButtonLoadingState(false);
          // Open the modal with memories after syncing
          handleMem0Modal();
        })
        .catch(error => {
          console.error('Error syncing memories:', error);
          if (syncButton) {
            showSyncPopup(syncButton, 'Error syncing memories');
          }
          setSyncButtonLoadingState(false);
          // Open the modal even if there was an error
          handleMem0Modal();
        });
    } else {
      console.error('Table or Sync button not found');
    }
  });
}

// New function to send memories in batch
function sendMemoriesToMem0(memories: Array<{ role: string; content: string }>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.sync.get(
      [
        StorageKey.API_KEY,
        StorageKey.USER_ID_CAMEL,
        StorageKey.ACCESS_TOKEN,
        StorageKey.SELECTED_ORG,
        StorageKey.SELECTED_PROJECT,
        StorageKey.USER_ID,
      ],
      function (items) {
        if (items[StorageKey.API_KEY] || items[StorageKey.ACCESS_TOKEN]) {
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
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify({
              messages: memories,
              user_id: userId,
              infer: true,
              metadata: {
                provider: Provider.ChatGPT,
              },
              source: SOURCE,
              ...optionalParams,
            }),
          })
            .then(response => {
              if (!response.ok) {
                reject(`Failed to add memories: ${response.status}`);
              } else {
                resolve();
              }
            })
            .catch(error => reject(`Error sending memories to Mem0: ${error}`));
        } else {
          reject('API Key/Access Token not set');
        }
      }
    );
  });
}

function setSyncButtonLoadingState(isLoading: boolean): void {
  const syncButton = document.querySelector('#sync-button') as HTMLButtonElement;
  const syncButtonContent = document.querySelector('#sync-button-content') as HTMLElement;
  if (syncButton) {
    if (isLoading) {
      syncButton.disabled = true;
      syncButton.style.cursor = 'wait';
      document.body.style.cursor = 'wait';
      syncButton.style.opacity = '0.7';
      if (syncButtonContent) {
        syncButtonContent.textContent = 'Syncing...';
      }
    } else {
      syncButton.disabled = false;
      syncButton.style.cursor = 'pointer';
      syncButton.style.opacity = '1';
      document.body.style.cursor = 'default';
      if (syncButtonContent) {
        syncButtonContent.textContent = 'Sync Memory';
      }
    }
  }
}

function showSyncPopup(button: HTMLElement, message: string): void {
  const popup = document.createElement('div');

  // Create and add the (i) icon
  const infoIcon = document.createElement('span');
  infoIcon.textContent = 'ⓘ ';
  infoIcon.style.marginRight = '3px';

  popup.appendChild(infoIcon);
  popup.appendChild(document.createTextNode(message));

  popup.style.cssText = `
        position: absolute;
        top: 50%;
        left: -160px;
        transform: translateY(-50%);
        background-color: #171717;
        color: white;
        padding: 6px 8px;
        border-radius: 6px;
        font-size: 12px;
        white-space: nowrap;
        z-index: 1000;
    `;

  button.style.position = 'relative';
  button.appendChild(popup);

  setTimeout(() => {
    popup.remove();
  }, 3000);
}

function sendMemoryToMem0(
  memory: { role: string; content: string },
  infer: boolean = true
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.sync.get(
      [
        StorageKey.API_KEY,
        StorageKey.USER_ID_CAMEL,
        StorageKey.ACCESS_TOKEN,
        StorageKey.SELECTED_ORG,
        StorageKey.SELECTED_PROJECT,
        StorageKey.USER_ID,
      ],
      function (items) {
        if (items[StorageKey.API_KEY] || items[StorageKey.ACCESS_TOKEN]) {
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
            headers: {
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify({
              messages: [{ content: memory.content, role: MessageRole.User }],
              user_id: userId,
              infer: infer,
              metadata: {
                provider: Provider.ChatGPT,
              },
              source: SOURCE,
              ...optionalParams,
            }),
          })
            .then(response => {
              if (!response.ok) {
                reject(`Failed to add memory: ${response.status}`);
              } else {
                resolve();
              }
            })
            .catch(error => reject(`Error sending memory to Mem0: ${error}`));
        } else {
          reject('API Key/Access Token not set');
        }
      }
    );
  });
}

// Add this new function to get the memory_enabled state
function getMemoryEnabledState(): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    chrome.storage.sync.get([StorageKey.MEMORY_ENABLED], function (result) {
      resolve(result.memory_enabled !== false); // Default to true if not set
    });
  });
}

// Returns whether auto-inject is enabled (default: false if not present)
// (auto-inject helpers removed)

// Update the initialization function to add the Mem0 icon button but not intercept Enter key
function initializeMem0Integration(): void {
  // Initialize the listener for theme changes

  document.addEventListener('DOMContentLoaded', () => {
    addSyncButton();
    (async () => await addMem0IconButton())();
    addSendButtonListener();
    wireIdleVisualState();
    hookBackgroundSearchTyping();
  });

  document.addEventListener('keydown', function (event) {
    if (event.ctrlKey && event.key === 'm') {
      event.preventDefault();
      (async () => {
        await handleMem0Modal();
      })();
    }
  });

  // Remove global Enter interception previously added for auto-inject

  observer = new MutationObserver(() => {
    addSyncButton();
    (async () => await addMem0IconButton())();
    addSendButtonListener();
    wireIdleVisualState();
    hookBackgroundSearchTyping();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Add a MutationObserver to watch for changes in the DOM but don't intercept Enter key
  const observerForUI = new MutationObserver(() => {
    (async () => await addMem0IconButton())();
    addSendButtonListener();
    wireIdleVisualState();
    hookBackgroundSearchTyping();
  });

  observerForUI.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// (global auto-inject interceptors removed)

// Function to show login popup
function showLoginPopup(): void {
  // First remove any existing popups
  const existingPopup = document.querySelector('#mem0-login-popup');
  if (existingPopup) {
    existingPopup.remove();
  }

  // Create popup container
  const popupOverlay = document.createElement('div');
  popupOverlay.id = 'mem0-login-popup';
  popupOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
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

  // Close button
  const closeButton = document.createElement('button');
  closeButton.style.cssText = `
    position: absolute;
    top: 16px;
    right: 16px;
    background: none;
    border: none;
    color: #A1A1AA;
    font-size: 16px;
    cursor: pointer;
  `;
  closeButton.innerHTML = '&times;';
  closeButton.addEventListener('click', () => {
    document.body.removeChild(popupOverlay);
  });

  // Logo and heading
  const logoContainer = document.createElement('div');
  logoContainer.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
  `;

  const logo = document.createElement('img');
  logo.src = chrome.runtime.getURL('icons/mem0-claude-icon.png');
  logo.style.cssText = `
    width: 24px;
    height: 24px;
    border-radius: 50%;
    margin-right: 12px;
  `;

  const logoDark = document.createElement('img');
  logoDark.src = chrome.runtime.getURL('icons/mem0-icon-black.png');
  logoDark.style.cssText = `
    width: 24px;
    height: 24px;
    border-radius: 50%;
    margin-right: 12px;
  `;

  const heading = document.createElement('h2');
  heading.textContent = 'Sign in to OpenMemory';
  heading.style.cssText = `
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  `;

  logoContainer.appendChild(heading);

  // Message
  const message = document.createElement('p');
  message.textContent =
    'Please sign in to access your memories and personalize your conversations!';
  message.style.cssText = `
    margin-bottom: 24px;
    color: #D4D4D8;
    font-size: 14px;
    line-height: 1.5;
    text-align: center;
  `;

  // Sign in button
  const signInButton = document.createElement('button');
  signInButton.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 10px;
    background-color: white;
    color: black;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s;
  `;

  // Add text in span for better centering
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

  // Open sign-in page when clicked
  signInButton.addEventListener('click', () => {
    window.open(APP_LOGIN, '_blank');
    document.body.removeChild(popupOverlay);
  });

  // Assemble popup
  popupContainer.appendChild(logoContainer);
  popupContainer.appendChild(message);
  popupContainer.appendChild(signInButton);

  popupOverlay.appendChild(popupContainer);
  popupOverlay.appendChild(closeButton);

  // Add click event to close when clicking outside
  popupOverlay.addEventListener('click', e => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });

  // Add to body
  document.body.appendChild(popupOverlay);
}

initializeMem0Integration();
// --- SPA navigation handling and extension context guard (mirrors Claude) ---
let chatgptExtensionContextValid = true;
let chatgptCurrentUrl = window.location.href;

function chatgptCheckExtensionContext(): boolean {
  try {
    // chrome.runtime may throw if context invalidated
    // Using optional chaining to avoid ReferenceError
    // lastError exists only after an API call; treat presence of runtime as validity
    const isValid = !!(chrome && chrome.runtime);
    if (chatgptExtensionContextValid && !isValid) {
      chatgptExtensionContextValid = false;
    }
    return isValid;
  } catch {
    chatgptExtensionContextValid = false;
    return false;
  }
}

function chatgptDetectNavigation(): void {
  const newUrl = window.location.href;
  if (newUrl !== chatgptCurrentUrl) {
    chatgptCurrentUrl = newUrl;

    // Re-initialize UI after small delay for DOM to settle
    setTimeout(() => {
      try {
        addSyncButton();
        (async () => await addMem0IconButton())();
        addSendButtonListener();
        wireIdleVisualState();
      } catch {
        // Ignore errors when setting contenteditable
      }
    }, 300);
  }
}

// Poll for SPA navigations and context validity
setInterval(() => {
  chatgptCheckExtensionContext();
  chatgptDetectNavigation();
}, 1000);

// Hook browser history navigation
window.addEventListener('popstate', () => setTimeout(chatgptDetectNavigation, 100));
const chatgptOriginalPushState = history.pushState;
history.pushState = function (data: HistoryStateData, unused: string, url?: string | URL | null) {
  chatgptOriginalPushState.call(history, data, unused, url);
  setTimeout(chatgptDetectNavigation, 100);
};
const chatgptOriginalReplaceState = history.replaceState;
history.replaceState = function (
  data: HistoryStateData,
  unused: string,
  url?: string | URL | null
) {
  chatgptOriginalReplaceState.call(history, data, unused, url);
  setTimeout(chatgptDetectNavigation, 100);
};
