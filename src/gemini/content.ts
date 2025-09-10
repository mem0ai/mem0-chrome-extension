/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { createMemButton } from '../components/mem_button';
import { API_MEMORIES, API_SEARCH, APP_LOGIN } from '../consts/api';
import { DEFAULT_USER_ID, type LoginData, MessageRole, SOURCE } from '../types/api';
import type { SearchStorage } from '../types/background_search';
import type { MemButtonController, MemButtonState } from '../types/memButton';
import type { MemoryItem, MemorySearchItem, OptionalApiParams } from '../types/memory';
import { type StorageData, StorageKey } from '../types/storage';
import { createOrchestrator, normalizeQuery } from '../utils/background_search';
import { OPENMEMORY_PROMPTS } from '../utils/llm_prompts';
import { createSearchSession } from '../utils/searchSession';
import { Theme, detectTheme } from '../utils/theme';
import { THEME_COLORS } from '../utils/ui/button_theme';
import { getBrowser, sendExtensionEvent } from '../utils/util_functions';

export {};

// controller for mem0 button
let memBtnCtrl: MemButtonController | null = null;

let isProcessingMem0 = false;

// Global variable to store all memories
let allMemories: string[] = [];

// Track added memories by ID
const allMemoriesById: Set<string> = new Set<string>();

// **PERFORMANCE FIX: Add initialization flags and cleanup variables**
let isInitialized = false;
let sendListenerAdded = false;
let mainObserver: MutationObserver | null = null;

// **TIMING FIX: Add periodic element detection**
let elementDetectionInterval: number | null = null;

// Cache of the latest typed text to avoid race when the editor is cleared
let lastTyped = '';
let inputValueCopy = '';

const searchSession = createSearchSession<MemoryItem>({ normalizeQuery });

const geminiSearch = createOrchestrator({
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

// Gemini DOM helpers
function getTextarea(): HTMLElement | null {
  const selectors = [
    'rich-textarea .ql-editor[contenteditable="true"]',
    'rich-textarea .ql-editor.textarea',
    '.ql-editor[aria-label="Enter a prompt here"]',
    '.ql-editor.textarea.new-input-ui',
    '.text-input-field_textarea .ql-editor',
    'div[contenteditable="true"][role="textbox"][aria-label="Enter a prompt here"]',
  ];
  for (const s of selectors) {
    const el = document.querySelector(s) as HTMLElement | null;
    if (el) {
      return el;
    }
  }
  return null;
}

// **TIMING FIX: Add function to detect send button**
function getSendButton(): HTMLButtonElement | null {
  const selectors = [
    'button[aria-label="Send message"]',
    'button[data-testid="send-button"]',
    'button[type="submit"]:not([aria-label*="attachment"])',
    '.send-button',
    'button[aria-label*="Send"]',
    'button[title*="Send"]',
  ];
  for (const s of selectors) {
    const btn = document.querySelector(s) as HTMLButtonElement | null;
    if (btn) {
      return btn;
    }
  }
  return null;
}

function getInputValue(): string | null {
  const el = getTextarea();
  if (!el) {
    return null;
  }
  return el.textContent || '';
}

// Check if the input has text
function computeActive(): boolean {
  const el = getTextarea();
  const val = el ? (el.textContent || '').trim() : '';
  return val.length > 3;
}

// Wire idle visual state (background/check/shortcut)
function wireIdleVisualState(): void {
  const input = getTextarea();
  if (!memBtnCtrl || !input) {
    return;
  }

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
  input.addEventListener('input', apply);
  input.addEventListener('keyup', apply);
  input.addEventListener('focus', apply);
  const mo = new MutationObserver(apply);
  mo.observe(input, { childList: true, characterData: true, subtree: true });
}

// Helper functions for main logic
function removeExistingButton(): void {
  const existing = document.querySelector('#mem0-icon-button') as HTMLElement;
  if (existing?.parentNode) {
    (existing.parentNode as HTMLElement).remove();
  }

  const floating = document.querySelector('#mem0-floating-container');
  if (floating) {
    floating.remove();
  }
}

// **TIMING FIX: Add periodic element detection**
function startElementDetection(): void {
  if (elementDetectionInterval) {
    clearInterval(elementDetectionInterval);
  }
  elementDetectionInterval = window.setInterval(() => {
    const container = findOrCreateButtonContainer();
    const btnExists = !!document.querySelector('#mem0-icon-button');
    if (container && !btnExists) {
      void addMem0IconButton();
    }
    const sendButton = getSendButton();
    if (sendButton && !sendListenerAdded) {
      addSendButtonListener();
    }
  }, 1000);
}

function findOrCreateButtonContainer(): HTMLElement | null {
  // Try to find the specific div with class text-input-field-main-area
  const mainArea = document.querySelector('.text-input-field-main-area');
  if (mainArea?.parentElement) {
    return mainArea.parentElement as HTMLElement;
  }

  // Fallback: Prefer Gemini toolbox drawer
  const toolbox = document.querySelector('toolbox-drawer .toolbox-drawer-container');
  if (toolbox) {
    return toolbox as HTMLElement;
  }

  // Fallback near Send button
  const sendButton = getSendButton();
  if (sendButton?.parentElement) {
    return sendButton.parentElement as HTMLElement;
  }

  // Last fallback: floating
  const inputElement = getTextarea();
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
  // If we found the main area, insert button before it
  const mainArea = buttonContainer.querySelector('.text-input-field-main-area');
  if (mainArea) {
    buttonContainer.insertBefore(mem0ButtonContainer, mainArea);

    // Ensure the container has proper flex alignment
    buttonContainer.style.display = 'flex';
    buttonContainer.style.alignItems = 'center';
  } else if (buttonContainer.matches('.toolbox-drawer-container')) {
    // If placed into toolbox drawer, just append to the end to preserve layout
    buttonContainer.appendChild(mem0ButtonContainer);
  } else {
    // Try to place before send button for consistency
    const sendButton = getSendButton();
    if (sendButton?.parentElement) {
      sendButton.parentElement.insertBefore(mem0ButtonContainer, sendButton);
    } else {
      buttonContainer.appendChild(mem0ButtonContainer);
    }
  }

  // Ensure it doesn't shrink and position it properly
  mem0ButtonContainer.style.cssText += `
    flex-shrink: 0 !important;
    display: inline-flex !important;
    margin-right: 8px !important;
    vertical-align: top !important;
  `;
}

// Shared function to update the input field with all collected memories
function updateInputWithMemories(): void {
  const inputElement = getTextarea();
  if (!inputElement || allMemories.length === 0) {
    return;
  }

  const headerText = OPENMEMORY_PROMPTS.memory_header_text;

  // For Gemini's Quill editor (contenteditable .ql-editor)
  if (inputElement.contentEditable === 'true') {
    // Get content without previous memory wrappers
    const baseText = getContentWithoutMemoriesInternal(inputElement, undefined, true);

    // Build HTML with header and bullet lines
    let html = '';
    if (baseText && baseText.trim()) {
      // Preserve existing content (as paragraphs)
      const paragraphs = baseText
        .split('\n')
        .map(line => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'))
        .join('');
      html += paragraphs + '<p><br></p>';
    }

    html += `<p><strong>${escapeHtml(headerText)}</strong></p>`;
    html += allMemories.map(mem => `<p>- ${escapeHtml(mem)}</p>`).join('');

    (inputElement as HTMLElement).innerHTML = html;

    // Dispatch input events for the editor
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
    });
    inputElement.dispatchEvent(inputEvent);
    const changeEvent = new Event('change', { bubbles: true });
    inputElement.dispatchEvent(changeEvent);
    (inputElement as HTMLElement).focus();
  } else {
    // Fallback (textarea)
    const basePlain = getContentWithoutMemories(undefined);
    const ta = inputElement as HTMLTextAreaElement;
    ta.value = `${basePlain}${basePlain ? '\n\n' : ''}${headerText}\n\n${allMemories.map(m => `- ${m}`).join('\n')}`;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    (inputElement as HTMLElement).focus();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Function to get the content without any memory wrappers
function getContentWithoutMemories(providedMessage: string | undefined): string {
  const inputElement = getTextarea();
  return getContentWithoutMemoriesInternal(inputElement, providedMessage, false);
}

// Internal: supports both HTML Quill and plain text
function getContentWithoutMemoriesInternal(
  inputElement: HTMLElement | null,
  providedMessage: string | undefined,
  returnPlainText: boolean
): string {
  let content = '';

  if (typeof providedMessage === 'string') {
    content = providedMessage;
  } else {
    if (!inputElement) {
      return '';
    }
    if (inputElement.contentEditable === 'true') {
      content = returnPlainText
        ? inputElement.textContent || ''
        : (inputElement as HTMLElement).innerHTML;
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

  // Clean trailing empty paragraphs (Quill)
  content = content.replace(/<p><br><\/p>$/g, '');

  return content.trim();
}

// Function to check if memory is enabled
async function getMemoryEnabledState(): Promise<boolean> {
  return new Promise(resolve => {
    try {
      chrome.storage.sync.get([StorageKey.MEMORY_ENABLED], data => {
        try {
          if (chrome.runtime?.lastError) {
            resolve(true);
            return;
          }
          resolve(data.memory_enabled !== false); // Default to true if not set
        } catch {
          resolve(true);
        }
      });
    } catch {
      resolve(true);
    }
  });
}

// Function to show memories popup (success/error)
function showMemoriesPopup(isSuccess: boolean): void {
  // Remove existing
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
    text-align: center;
  `;

  popup.textContent = isSuccess ? 'Memories added' : 'Error while adding memories';

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

// Function to show login popup
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

function hookGeminiBackgroundSearchTyping(): void {
  const el = getTextarea();
  if (!el) {
    return;
  }

  const handler = () => {
    let text = getInputValue() || '';
    try {
      const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
      text = text.replace(MEM0_PLAIN, '').trim();
    } catch {
      /* ignore */
    }
    geminiSearch.setText(text);
  };

  el.addEventListener('input', handler);
  el.addEventListener('keyup', handler);
}

// Function to add the Mem0 button (Gemini)
async function addMem0IconButton(): Promise<void> {
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
          await handleMem0Click();
        }
      } catch (e) {
        console.error('Error handling Mem0 button click:', e);
      }
    },
    marginLeft: '-6px',
  });
  memBtnCtrl = ctrl;

  insertButtonIntoContainer(buttonContainer, ctrl.root);
  ctrl.wireHover(computeActive);
  wireIdleVisualState();
  addSendButtonListener();

  ctrl.root.style.display = 'inline-flex';
  ctrl.root.style.visibility = 'visible';
  ctrl.root.style.opacity = '1';
}

// Modified function to handle Mem0 button click - searches and adds immediately
async function handleMem0Click(): Promise<void> {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    return;
  }

  const loginData = await new Promise<LoginData>(resolve => {
    chrome.storage.sync.get(
      [StorageKey.API_KEY, StorageKey.USER_ID_CAMEL, StorageKey.ACCESS_TOKEN],
      items => resolve(items as unknown as LoginData)
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
      provider: 'gemini',
      source: 'OPENMEMORY_CHROME_EXTENSION',
      browser: getBrowser(),
    });

    // Wait orchestrator result
    const items = await searchSession.runSearchAndWait(geminiSearch, message);

    // Reset collection
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

    // Parallel - save to Mem0
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

function setButtonState(s: MemButtonState) {
  memBtnCtrl?.setState(s);
}

// Add an event listener for the send button to clear memories after sending and store snapshot
function addSendButtonListener(): void {
  if (sendListenerAdded) {
    return;
  }

  const sendButton = getSendButton();
  if (sendButton && !sendButton.dataset.mem0Listener) {
    sendButton.dataset.mem0Listener = 'true';
    sendButton.addEventListener('click', function () {
      // Snapshot before clear
      captureAndStoreMemorySnapshot();

      // Clear after send
      setTimeout(() => {
        allMemories = [];
        allMemoriesById.clear();
      }, 100);
    });
  }

  const inputElement = getTextarea();
  if (inputElement && !(inputElement as HTMLElement).dataset.mem0KeyListener) {
    (inputElement as HTMLElement).dataset.mem0KeyListener = 'true';
    (inputElement as HTMLElement).addEventListener('keydown', function (event: KeyboardEvent) {
      inputValueCopy = (inputElement as HTMLElement).textContent || inputValueCopy;

      // Check if Enter was pressed without Shift (standard send behavior)
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const current = getInputValue();
        if (current && current.trim() !== '') {
          lastTyped = current;
        }

        // Snapshot before send
        captureAndStoreMemorySnapshot();

        // Clear after send
        setTimeout(() => {
          allMemories = [];
          allMemoriesById.clear();
        }, 100);
      }
    });
  }

  if (getTextarea() && getSendButton()) {
    sendListenerAdded = true;
  }
}

// Function to capture and store memory asynchronously
function captureAndStoreMemorySnapshot(): void {
  const inputElement = getTextarea();
  if (!inputElement) {
    return;
  }

  let message = (inputElement as HTMLElement).textContent || '';
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

  // Clean from memory wrapper
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
    function (items: StorageData) {
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

      const messages = [{ role: MessageRole.User, content: message }];

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
        metadata: { provider: 'Gemini' },
        source: SOURCE,
        ...optionalParams,
      };

      fetch(API_MEMORIES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify(storagePayload),
      }).catch(err => {
        console.error('Error saving memory:', err);
      });
    }
  );
}

function computeAndPrimeCaches(): void {
  const initVal = getInputValue();
  if (initVal && initVal.trim()) {
    lastTyped = initVal;
  }
}

// Initialize the integration when the page loads
function initializeMem0Integration(): void {
  // **PERFORMANCE FIX: Prevent multiple initializations**
  if (isInitialized) {
    return;
  }

  try {
    document.addEventListener('DOMContentLoaded', () => {
      (async () => await addMem0IconButton())();
      addSendButtonListener();
      wireIdleVisualState();
      hookGeminiBackgroundSearchTyping();
    });

    // Ctrl+M
    document.addEventListener('keydown', function (event: KeyboardEvent) {
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
    startElementDetection();

    // **PERFORMANCE FIX: Consolidated debounced observer**
    let debounceTimer: number | undefined;
    mainObserver = new MutationObserver(async () => {
      if (debounceTimer) {
        window.clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(async () => {
        try {
          const enabled = await getMemoryEnabledState();
          if (enabled) {
            await addMem0IconButton();
            addSendButtonListener();
            hookGeminiBackgroundSearchTyping();
          } else {
            removeExistingButton();
          }
        } catch {
          /* ignore */
        }
      }, 300);
    });

    // **PERFORMANCE FIX: Observe with more specific targeting**
    mainObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributeFilter: ['class', 'id'],
    });

    // Periodic guard to ensure button presence
    const memoryStateCheckInterval = window.setInterval(async () => {
      try {
        const memoryEnabled = await getMemoryEnabledState();
        if (!memoryEnabled) {
          removeExistingButton();
        } else if (!document.querySelector('#mem0-icon-button')) {
          await addMem0IconButton();
        }
      } catch {
        /* ignore */
      }
    }, 15000);

    // Cleanup on unload
    window.addEventListener('beforeunload', () => {
      if (mainObserver) {
        mainObserver.disconnect();
      }
      if (elementDetectionInterval) {
        clearInterval(elementDetectionInterval);
      }
      clearInterval(memoryStateCheckInterval);
    });

    isInitialized = true;
  } catch {
    /* ignore */
  }
}

initializeMem0Integration();
