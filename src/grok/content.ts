/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { createMemButton } from '../components/mem_button';
import { API_MEMORIES, API_SEARCH, APP_LOGIN } from '../consts/api';
import { DEFAULT_USER_ID, type LoginData, MessageRole, SOURCE } from '../types/api';
import type { SearchStorage } from '../types/background_search';
import type { MemButtonController, MemButtonState } from '../types/memButton';
import type { MemoryItem, MemorySearchItem, OptionalApiParams } from '../types/memory';
import { SidebarAction } from '../types/messages';
import { StorageKey } from '../types/storage';
import { createOrchestrator, normalizeQuery } from '../utils/background_search';
import { OPENMEMORY_PROMPTS } from '../utils/llm_prompts';
import { createSearchSession } from '../utils/searchSession';
import { Theme, detectTheme } from '../utils/theme';
import { THEME_COLORS } from '../utils/ui/button_theme';
import { getBrowser, sendExtensionEvent } from '../utils/util_functions';

export {};

// --- State ---
let memBtnCtrl: MemButtonController | null = null;

let isProcessingMem0 = false;
let isInitialized = false;
let sendListenerAdded = false;
let mainObserver: MutationObserver | null = null;
let elementDetectionInterval: number | null = null;

// Global memories buffer (what we inject into prompt)
let allMemories: string[] = [];
const allMemoriesById: Set<string> = new Set<string>();

// --- Search session and orchestrator (Grok) ---
const searchSession = createSearchSession<MemoryItem>({ normalizeQuery });

const grokSearch = createOrchestrator({
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

    // Clean query by stripping any appended memory header/content (debounced path)
    const cleanQuery = (function () {
      try {
        const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
        return String(query).replace(MEM0_PLAIN, '').trim();
      } catch (_e) {
        return query;
      }
    })();

    const payload = {
      query: cleanQuery,
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
    console.warn('Grok search error:', err);
  },

  minLength: 3,
  debounceMs: 150,
  cacheTTL: 60000,
});

// --- DOM helpers (Grok) ---
function getTextarea(): HTMLTextAreaElement | null {
  const selectors = [
    'textarea.w-full.px-2.\\@\\[480px\\]\\/input\\:px-3.bg-transparent.focus\\:outline-none.text-primary.align-bottom.min-h-14.pt-5.my-0.mb-5',
    'textarea.w-full.px-2.\\@\\[480px\\]\\/input\\:px-3.pt-5.mb-5.bg-transparent.focus\\:outline-none.text-primary.align-bottom',
    'textarea[dir="auto"][spellcheck="false"][placeholder="Ask anything"]',
    'textarea[dir="auto"][spellcheck="false"][placeholder="Ask follow-up"]',
    'textarea[dir="auto"][spellcheck="false"]',
    'textarea[aria-label="Ask Grok anything"]',
  ];
  for (const s of selectors) {
    const el = document.querySelector(s) as HTMLTextAreaElement | null;
    if (el) {
      return el;
    }
  }
  return null;
}

function getSendButton(): HTMLButtonElement | null {
  const selectors = [
    'button.group.flex.flex-col.justify-center.rounded-full[type="submit"]',
    'button.group.flex.flex-col.justify-center.rounded-full.focus\\:outline-none.focus-visible\\:outline-none[type="submit"]',
    'button[type="submit"]:not([aria-label="Submit attachment"])',
    'button[aria-label="Grok something"][role="button"]',
    'button[aria-label="Submit"][type="submit"]',
    'button[type="submit"].group.flex.flex-col.justify-center.rounded-full',
  ];
  for (const s of selectors) {
    const btn = document.querySelector(s) as HTMLButtonElement | null;
    if (btn) {
      return btn;
    }
  }
  return null;
}

// New function to find the Model select button by ID (more reliable)
function getModelSelectButton(): HTMLButtonElement | null {
  return document.querySelector('#model-select-trigger') as HTMLButtonElement | null;
}

// Function to find Auto button by text (fallback)
function getAutoButton(): HTMLButtonElement | null {
  const textarea = getTextarea();
  if (!textarea) {
    return null;
  }

  // Find the Auto button by looking in the immediate parent container of the textarea
  let container = textarea.parentElement;
  while (container && container !== document.body) {
    const buttons = container.querySelectorAll('button');
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i] as HTMLButtonElement;
      // Check if this button contains "Auto" text and is visible
      if (btn.textContent && btn.textContent.trim() === 'Auto' && btn.offsetParent !== null) {
        return btn;
      }
    }
    // Move to parent if we haven't found the Auto button yet
    container = container.parentElement;
  }
  return null;
}

// Function to find or create button container (like in Gemini)
function findOrCreateButtonContainer(): HTMLElement | null {
  // Strategy 1: Try to find model select button by ID first
  const modelBtn = getModelSelectButton();
  if (modelBtn?.parentElement) {
    return modelBtn.parentElement as HTMLElement;
  }

  // Strategy 2: Try to find Auto button by text
  const autoBtn = getAutoButton();
  if (autoBtn?.parentElement) {
    return autoBtn.parentElement as HTMLElement;
  }

  // Strategy 3: Try to find send button container
  const sendBtn = getSendButton();
  if (sendBtn?.parentElement) {
    return sendBtn.parentElement as HTMLElement;
  }

  // Strategy 4: Look for input container
  const textarea = getTextarea();
  if (textarea?.parentElement) {
    return textarea.parentElement as HTMLElement;
  }

  // Last fallback: floating container
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

// Function to insert button into container with smart positioning
function insertButtonIntoContainer(
  buttonContainer: HTMLElement,
  mem0ButtonContainer: HTMLElement
): void {
  // Strategy 1: Try to insert after model select button
  const modelBtn = getModelSelectButton();
  if (modelBtn?.parentElement === buttonContainer) {
    buttonContainer.insertBefore(mem0ButtonContainer, modelBtn.nextSibling);
    return;
  }

  // Strategy 2: Try to insert after Auto button
  const autoBtn = getAutoButton();
  if (autoBtn?.parentElement === buttonContainer) {
    buttonContainer.insertBefore(mem0ButtonContainer, autoBtn.nextSibling);
    return;
  }

  // Strategy 3: Try to place before send button
  const sendBtn = getSendButton();
  if (sendBtn?.parentElement === buttonContainer) {
    buttonContainer.insertBefore(mem0ButtonContainer, sendBtn);
    return;
  }

  // Strategy 4: Just append to container
  buttonContainer.appendChild(mem0ButtonContainer);

  // Ensure proper styling
  mem0ButtonContainer.style.cssText += `
    flex-shrink: 0 !important;
    display: inline-flex !important;
    margin-left: 4px !important;
    vertical-align: top !important;
  `;
}

// --- UI / Button visual state ---
function computeActive(): boolean {
  const el = getTextarea();
  const val = el ? (el.value || '').trim() : '';
  return val.length > 3;
}

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
}

// --- Text helpers ---
function setInputValue(inputElement: HTMLTextAreaElement, value: string): void {
  inputElement.value = value;
  inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  inputElement.focus();
}

function getContentWithoutMemories(provided?: string): string {
  const inputElement = getTextarea();
  let content = typeof provided === 'string' ? provided : inputElement?.value || '';
  try {
    const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
    content = content.replace(MEM0_PLAIN, '').trim();
  } catch {
    /* ignore */
  }
  const header = OPENMEMORY_PROMPTS.memory_header_text;
  const idx = content.indexOf(header);
  if (idx !== -1) {
    content = content.substring(0, idx).trim();
  }
  return content;
}

function updateInputWithMemories(): void {
  const ta = getTextarea();
  if (!ta || allMemories.length === 0) {
    return;
  }

  const base = getContentWithoutMemories();
  const header = OPENMEMORY_PROMPTS.memory_header_text;
  const body = allMemories.map(m => `- ${m}`).join('\n');
  const next = `${base}${base ? '\n\n' : ''}${header}\n${body}`;
  setInputValue(ta, next);
}

// --- Memory enabled state ---
async function getMemoryEnabledState(): Promise<boolean> {
  return new Promise(resolve => {
    chrome.storage.sync.get([StorageKey.MEMORY_ENABLED], data => {
      if (chrome.runtime?.lastError) {
        return resolve(true);
      }
      resolve(data.memory_enabled !== false);
    });
  });
}

// --- Popups ---
function showMemoriesPopup(isSuccess: boolean): void {
  const existing = document.querySelector('.mem0-memories-popup') as HTMLElement | null;
  if (existing) {
    existing.remove();
  }

  const colors = THEME_COLORS[detectTheme() as keyof typeof THEME_COLORS];
  const popup = document.createElement('div');
  popup.className = 'mem0-memories-popup';
  popup.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    background-color: ${colors.POPUP_BG};
    border: 1px solid ${colors.POPUP_BORDER};
    color: ${colors.POPUP_TEXT};
    padding: 14px 16px; border-radius: 12px; z-index: 10001;
    box-shadow: 0 4px 20px ${colors.POPUP_SHADOW};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  popup.textContent = isSuccess ? 'Memories added' : 'No relevant memories';
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 2500);
}

function showButtonPopup(button: HTMLElement, message: string): void {
  const existing = document.querySelector('.mem0-button-popup') as HTMLElement | null;
  if (existing) {
    existing.remove();
  }

  const popup = document.createElement('div');
  popup.className = 'mem0-button-popup';
  popup.style.cssText = `
    position: absolute; top: -40px; left: 50%; transform: translateX(-50%);
    background-color: #1C1C1E; border: 1px solid #27272A; color: white;
    padding: 8px 12px; border-radius: 6px; font-size: 12px; white-space: nowrap;
    z-index: 10001; box-shadow: 0 4px 8px rgba(0,0,0,0.2);
  `;
  popup.textContent = message;

  const arrow = document.createElement('div');
  arrow.style.cssText = `
    position: absolute; bottom: -5px; left: 50%; transform: translateX(-50%) rotate(45deg);
    width: 10px; height: 10px; background-color: #1C1C1E;
    border-right: 1px solid #27272A; border-bottom: 1px solid #27272A;
  `;
  popup.appendChild(arrow);

  button.style.position = 'relative';
  button.appendChild(popup);
  setTimeout(() => popup.remove(), 3000);
}

// Add modal login popup
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

// --- Background typing hook for Grok ---
function hookGrokBackgroundSearchTyping(): void {
  const ta = getTextarea();
  if (!ta) {
    return;
  }
  const handler = () => {
    let text = ta.value || '';
    try {
      const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
      text = text.replace(MEM0_PLAIN, '').trim();
    } catch {
      /* ignore */
    }
    grokSearch.setText(text);
  };
  ta.addEventListener('input', handler);
  ta.addEventListener('keyup', handler);
}

// --- Button insertion ---
async function addMem0IconButton(): Promise<void> {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    removeExistingButton();
    return;
  }
  if (document.querySelector('#mem0-icon-button')) {
    return;
  }

  const buttonContainer = findOrCreateButtonContainer();
  if (!buttonContainer) {
    console.log('Grok: No suitable container found for button');
    return;
  }

  // Build button
  const ctrl = createMemButton({
    theme: detectTheme(),
    label: 'Memories',
    shortcut: 'Ctrl + M',
    autoTheme: true,
    onClick: async () => {
      try {
        const enabled = await getMemoryEnabledState();
        if (!enabled) {
          chrome.runtime.sendMessage({ action: SidebarAction.OPEN_OPTIONS });
          return;
        }
        await handleMem0Click();
      } catch (e) {
        console.error('Mem0 button click error:', e);
      }
    },
    marginLeft: '4px',
  });
  memBtnCtrl = ctrl;

  insertButtonIntoContainer(buttonContainer, ctrl.root);

  ctrl.wireHover(computeActive);
  wireIdleVisualState();
  addSendButtonListener();
}

function removeExistingButton(): void {
  const existing = document.querySelector('#mem0-icon-button') as HTMLElement | null;
  if (existing?.parentElement) {
    // root is two levels up in mem_button, but remove safe:
    const root = existing.closest('[data-mem0-root]') as HTMLElement | null;
    (root || existing.parentElement).remove();
  }
}

// --- Main click: search -> inject -> save snapshot ---
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
    const btn = document.querySelector('#mem0-icon-button') as HTMLElement | null;
    if (btn) {
      showButtonPopup(btn, 'Sign in to use memories');
    }
    showLoginPopup();
    return;
  }

  const btn = memBtnCtrl?.button as HTMLElement | undefined;
  const ta = getTextarea();
  let message = ta ? ta.value : '';
  if (!message || !message.trim() || message.trim().length <= 3) {
    if (btn) {
      showButtonPopup(btn, 'Please enter some text first');
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
      provider: 'grok',
      source: 'OPENMEMORY_CHROME_EXTENSION',
      browser: getBrowser(),
    });

    const items = await searchSession.runSearchAndWait(grokSearch, message);

    // Reset and collect
    allMemories = [];
    allMemoriesById.clear();
    for (const m of items) {
      allMemoriesById.add(String(m.id));
      allMemories.push(m.text || m.memory || '');
    }

    if (allMemories.length > 0) {
      updateInputWithMemories();
      showMemoriesPopup(true);
    } else {
      showMemoriesPopup(false);
    }

    // Save snapshot in background
    captureAndStoreMemorySnapshot(message);
  } catch (err) {
    console.error('Grok add error:', err);
    showMemoriesPopup(false);
    setButtonState('error');
  } finally {
    setTimeout(() => setButtonState('added'), 400);
    setTimeout(() => setButtonState('success'), 1200);
    isProcessingMem0 = false;
  }
}

function setButtonState(s: MemButtonState) {
  memBtnCtrl?.setState(s);
}

// --- Send button: snapshot + clear buffers ---
function addSendButtonListener(): void {
  if (sendListenerAdded) {
    return;
  }

  const sendBtn = getSendButton();
  if (sendBtn && !(sendBtn as HTMLElement).dataset?.mem0Listener) {
    (sendBtn as HTMLElement).dataset.mem0Listener = 'true';
    sendBtn.addEventListener('click', () => {
      const ta = getTextarea();
      const msg = ta ? ta.value : '';
      captureAndStoreMemorySnapshot(msg);
      setTimeout(() => {
        allMemories = [];
        allMemoriesById.clear();
      }, 100);
    });
  }

  const ta = getTextarea();
  if (ta && !(ta as HTMLElement).dataset?.mem0KeyListener) {
    (ta as HTMLElement).dataset.mem0KeyListener = 'true';
    ta.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const msg = ta.value;
        captureAndStoreMemorySnapshot(msg);
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

// --- Save snapshot to Mem0 (with context) ---
function captureAndStoreMemorySnapshot(raw?: string): void {
  const ta = getTextarea();
  let message = typeof raw === 'string' ? raw : ta ? ta.value : '';
  message = getContentWithoutMemories(message);
  if (!message || !message.trim() || message.trim().length <= 3) {
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

      const msgs = [{ role: MessageRole.User, content: message }];
      msgs.push({ role: MessageRole.User, content: message });

      const optionalParams: OptionalApiParams = {};
      if (items[StorageKey.SELECTED_ORG]) {
        optionalParams.org_id = items[StorageKey.SELECTED_ORG];
      }
      if (items[StorageKey.SELECTED_PROJECT]) {
        optionalParams.project_id = items[StorageKey.SELECTED_PROJECT];
      }

      const payload = {
        messages: msgs,
        user_id: userId,
        infer: true,
        metadata: { provider: 'Grok' },
        source: SOURCE,
        ...optionalParams,
      };

      fetch(API_MEMORIES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify(payload),
      }).catch(err => console.error('Error saving memory:', err));
    }
  );
}

// --- Element detection loop ---
function startElementDetection(): void {
  if (elementDetectionInterval) {
    clearInterval(elementDetectionInterval);
  }
  elementDetectionInterval = window.setInterval(async () => {
    const enabled = await getMemoryEnabledState();
    if (!enabled) {
      removeExistingButton();
      return;
    }
    if (!document.querySelector('#mem0-icon-button')) {
      console.log('Grok: Periodic retry - adding button...');
      await addMem0IconButton();
    }
    if (!sendListenerAdded) {
      addSendButtonListener();
    }
  }, 1000);
}

// --- Init ---
function initializeMem0Integration(): void {
  if (isInitialized) {
    return;
  }

  try {
    // Try immediate insertion
    void addMem0IconButton();

    document.addEventListener('DOMContentLoaded', () => {
      void addMem0IconButton();
      addSendButtonListener();
      wireIdleVisualState();
      hookGrokBackgroundSearchTyping();
    });

    // Ctrl+M
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 'm') {
        event.preventDefault();
        (async () => {
          const enabled = await getMemoryEnabledState();
          if (!enabled) {
            chrome.runtime.sendMessage({ action: SidebarAction.OPEN_OPTIONS });
            return;
          }
          await handleMem0Click();
        })();
      }
    });

    startElementDetection();

    // More aggressive DOM observation
    let debounce: number | undefined;
    mainObserver = new MutationObserver(() => {
      if (debounce) {
        window.clearTimeout(debounce);
      }
      debounce = window.setTimeout(async () => {
        const enabled = await getMemoryEnabledState();
        if (enabled) {
          await addMem0IconButton();
          addSendButtonListener();
          hookGrokBackgroundSearchTyping();
        } else {
          removeExistingButton();
        }
      }, 100); // Reduced debounce time
    });
    mainObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true, // Also observe text changes
    });

    // More frequent periodic guard
    const guard = window.setInterval(async () => {
      const enabled = await getMemoryEnabledState();
      if (!enabled) {
        removeExistingButton();
      } else if (!document.querySelector('#mem0-icon-button')) {
        console.log('Periodic retry: adding button...');
        await addMem0IconButton();
      }
    }, 5000); // More frequent checks

    window.addEventListener('beforeunload', () => {
      mainObserver?.disconnect();
      if (elementDetectionInterval) {
        clearInterval(elementDetectionInterval);
      }
      clearInterval(guard);
    });

    isInitialized = true;
  } catch {
    /* ignore */
  }
}

initializeMem0Integration();
