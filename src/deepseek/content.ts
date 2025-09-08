import { MessageRole } from '../types/api';
import type { ExtendedHTMLElement } from '../types/dom';
import type { MemoryItem, MemorySearchItem, OptionalApiParams } from '../types/memory';
import { SidebarAction } from '../types/messages';
import { StorageKey } from '../types/storage';
import { createOrchestrator, type SearchStorage } from '../utils/background_search';
import { OPENMEMORY_PROMPTS } from '../utils/llm_prompts';
import { getBrowser, sendExtensionEvent } from '../utils/util_functions';

export {};

const INPUT_SELECTOR = "#chat-input, textarea, [contenteditable='true']";

// Helper function to check if a node matches ignored selectors
function isIgnoredNode(node: Element, ignoredSelectors: string[]): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  // Check self
  for (const selector of ignoredSelectors) {
    if (node.matches && node.matches(selector)) {
      return true;
    }
  }

  // Check parents up to 3 levels
  let parent: HTMLElement | null = node.parentElement;
  let level = 0;
  while (parent && level < 3) {
    for (const selector of ignoredSelectors) {
      if (parent.matches && parent.matches(selector)) {
        return true;
      }
    }
    parent = parent.parentElement;
    level++;
  }

  return false;
}

// Function to expand memory
function expandMemory(
  memoryContainer: HTMLElement,
  memoryText: HTMLElement,
  contentWrapper: HTMLElement,
  removeButton: HTMLElement,
  currentlyExpandedMemory: HTMLElement | null,
  memoriesContent: HTMLElement
) {
  if (currentlyExpandedMemory && currentlyExpandedMemory !== memoryContainer) {
    currentlyExpandedMemory.dispatchEvent(new Event('collapse'));
  }

  memoryText.style.webkitLineClamp = 'unset';
  memoryText.style.height = 'auto';
  contentWrapper.style.overflowY = 'auto';
  contentWrapper.style.maxHeight = '240px'; // Limit height to prevent overflow
  contentWrapper.style.scrollbarWidth = 'none';
  contentWrapper.style.msOverflowStyle = 'none';
  contentWrapper.style.cssText += '::-webkit-scrollbar { display: none; }';
  memoryContainer.style.backgroundColor = '#1C1C1E';
  memoryContainer.style.maxHeight = '300px'; // Allow expansion but within container
  memoryContainer.style.overflow = 'hidden';
  removeButton.style.display = 'flex';
  currentlyExpandedMemory = memoryContainer;

  // Scroll to make expanded memory visible if needed
  memoriesContent.scrollTop = memoryContainer.offsetTop - memoriesContent.offsetTop;
}

// Function to collapse memory
function collapseMemory(
  memoryContainer: HTMLElement,
  memoryText: HTMLElement,
  contentWrapper: HTMLElement,
  removeButton: HTMLElement
) {
  memoryText.style.webkitLineClamp = '2';
  memoryText.style.height = '42px';
  contentWrapper.style.overflowY = 'visible';
  memoryContainer.style.backgroundColor = '#27272A';
  memoryContainer.style.maxHeight = '52px';
  memoryContainer.style.overflow = 'hidden';
  removeButton.style.display = 'none';
}

// Initialize memory tracking variables
let isProcessingMem0: boolean = false;
let observer: MutationObserver;
let memoryModalShown: boolean = false;
let allMemories: string[] = [];
let allMemoriesById: Set<string> = new Set<string>();
let currentModalOverlay: HTMLDivElement | null = null;
let mem0ButtonCheckInterval: ReturnType<typeof setInterval> | null = null; // Add interval variable for button checks
let modalDragPosition: { left: number; top: number } | null = null; // Store the dragged position of the modal

// Using MemoryItem from src/types/content-scripts.ts (includes memory field for compatibility)

// Function to remove the Mem0 icon button when memory is disabled
function removeMem0IconButton() {
  const iconButton = document.querySelector('#mem0-icon-button');
  if (iconButton) {
    const buttonContainer = iconButton.closest('div');
    if (buttonContainer && buttonContainer.id !== 'mem0-custom-container') {
      // Only remove the button, not the container unless it's our custom one
      try {
        buttonContainer.removeChild(iconButton);
      } catch {
        // If removal fails, try removing just the button
        iconButton.remove();
      }
    } else {
      // Remove the button directly
      iconButton.remove();
    }
  }

  // Also remove custom container if it exists
  const customContainer = document.querySelector('#mem0-custom-container');
  if (customContainer) {
    customContainer.remove();
  }
}

function getInputElement() {
  // Try finding with the more specific selector first
  const inputElement = document.querySelector(INPUT_SELECTOR);

  if (inputElement) {
    return inputElement;
  }

  // If not found, try a more general approach

  // Try finding by common input attributes
  const textareas = document.querySelectorAll('textarea');
  if (textareas.length > 0) {
    // Return the textarea that's visible and has the largest area (likely the main input)
    let bestMatch = null;
    let largestArea = 0;

    Array.from(textareas).forEach(textarea => {
      const rect = (textarea as HTMLTextAreaElement).getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0;
      const area = rect.width * rect.height;

      if (isVisible && area > largestArea) {
        largestArea = area;
        bestMatch = textarea as HTMLTextAreaElement;
      }
    });

    if (bestMatch) {
      return bestMatch;
    }
  }

  // Try contenteditable divs
  const editableDivs = document.querySelectorAll('[contenteditable="true"]');
  if (editableDivs.length > 0) {
    return editableDivs[0];
  }

  // Try any element with role="textbox"
  const textboxes = document.querySelectorAll('[role="textbox"]');
  if (textboxes.length > 0) {
    return textboxes[0];
  }

  return null;
}

function getSendButtonElement(): HTMLElement | null {
  try {
    // Strategy 1: Look for buttons with send-like characteristics
    const buttons = document.querySelectorAll('div[role="button"]');

    if (buttons.length === 0) {
      return null;
    }

    // Get the input element to help with positioning-based detection
    const inputElement = getInputElement();
    const inputRect = inputElement ? (inputElement as HTMLElement).getBoundingClientRect() : null;

    // Find candidate buttons that might be send buttons
    let bestSendButton: HTMLElement | null = null;
    let bestScore = 0;

    Array.from(buttons).forEach(btn => {
      const button = btn as HTMLElement;
      // Skip if button is not visible or has no size
      const buttonRect = button.getBoundingClientRect();
      if (buttonRect.width === 0 || buttonRect.height === 0) {
        return;
      }

      let score = 0;

      // 1. Check if it has an SVG (likely an icon button)
      const svg = button.querySelector('svg');
      if (svg) {
        score += 2;
      }

      // 2. Check if it has no text content (icon-only buttons)
      const buttonText = (button.textContent || '').trim();
      if (buttonText === '') {
        score += 2;
      }

      // 3. Check if it contains a paper airplane shape (common in send buttons)
      const paths = svg ? svg.querySelectorAll('path') : [];
      if (paths.length > 0) {
        score += 1;
      }

      // 4. Check positioning relative to input (send buttons are usually close to input)
      if (inputRect) {
        // Check if button is positioned to the right of input
        if (buttonRect.left > inputRect.left) {
          score += 1;
        }

        // Check if button is at similar height to input
        if (Math.abs(buttonRect.top - inputRect.top) < 100) {
          score += 2;
        }

        // Check if button is very close to input (right next to it)
        if (Math.abs(buttonRect.left - (inputRect.right + 20)) < 40) {
          score += 3;
        }
      }

      // 5. Check for DeepSeek specific classes
      if (button.classList.contains('ds-button--primary')) {
        score += 2;
      }

      // Update best match if this button has a higher score
      if (score > bestScore) {
        bestScore = score;
        bestSendButton = button;
      }
    });

    // Return best match if score is reasonable
    if (bestScore >= 4) {
      return bestSendButton;
    }

    // Strategy 2: Look for buttons positioned at the right of the input
    if (inputElement && inputRect) {
      // Find buttons positioned to the right of the input
      const rightButtons = Array.from(buttons).filter(btn => {
        const buttonRect = (btn as HTMLElement).getBoundingClientRect();
        return (
          buttonRect.left > inputRect.right - 50 && // To the right
          Math.abs(buttonRect.top - inputRect.top) < 50
        ); // Similar height
      });

      // Sort by horizontal proximity to input
      rightButtons.sort((a, b) => {
        const aRect = (a as HTMLElement).getBoundingClientRect();
        const bRect = (b as HTMLElement).getBoundingClientRect();
        return aRect.left - inputRect.right - (bRect.left - inputRect.right);
      });

      // Return the closest button
      if (rightButtons.length > 0) {
        return (rightButtons[0] as HTMLElement) || null;
      }
    }

    // Strategy 3: Last resort - take the last button with an SVG
    const svgButtons = Array.from(buttons).filter(btn => (btn as HTMLElement).querySelector('svg'));
    if (svgButtons.length > 0) {
      return svgButtons[svgButtons.length - 1] as HTMLElement;
    }

    return null;
  } catch {
    return null; // Return null on error instead of failing
  }
}

// Updated handleEnterKey with additional safety checks
async function handleEnterKey(event: KeyboardEvent) {
  try {
    // Safety check - only proceed if we can identify an input element
    const inputElement = getInputElement();
    if (!inputElement) {
      return; // Skip processing if no input found
    }

    // Only handle Enter without Shift and when target is the input element
    if (event.key === 'Enter' && !event.shiftKey && event.target === inputElement) {
      // Don't prevent default behavior yet until we've checked memory state

      // Check if memory is enabled
      let memoryEnabled = false;
      try {
        memoryEnabled = await getMemoryEnabledState();
      } catch {
        return; // Don't interfere if we can't check memory state
      }

      if (!memoryEnabled) {
        return; // Let the default behavior proceed
      }

      // At this point, we know memory is enabled so let's handle the Enter key

      // Now prevent default since we'll handle the send ourselves
      event.preventDefault();
      event.stopPropagation();

      // Process memories and then send
      try {
        await handleMem0Processing();
      } catch {
        triggerSendAction();
      }
    }
  } catch {
    // Don't interfere with normal behavior if something goes wrong
  }
}

function initializeMem0Integration(): void {
  // Global flag to track initialization state
  window.mem0Initialized = window.mem0Initialized || false;

  // Reset initialization flag on navigation or visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Page likely navigated or became visible, reset initialization
      if (window.mem0Initialized) {
        setTimeout(() => {
          if (!document.querySelector('#mem0-icon-button')) {
            window.mem0Initialized = false;
            stageCriticalInit();
          }
        }, 1000);
      }
    }
  });

  // Avoid duplicating initialization
  if (window.mem0Initialized) {
    if (!document.querySelector('#mem0-icon-button')) {
      addMem0IconButton();
    }
    return;
  }

  // Step 1: Wait for the page to be fully loaded before doing anything
  if (document.readyState !== 'complete') {
    window.addEventListener('load', function () {
      setTimeout(stageCriticalInit, 500); // Reduced wait time after load
    });
  } else {
    // Page is already loaded, wait a moment and then initialize
    setTimeout(stageCriticalInit, 500); // Reduced wait time
  }

  // Stage 1: Initialize critical features (keyboard shortcuts, basic listeners)
  function stageCriticalInit() {
    try {
      // Early exit if already initialized
      if (window.mem0Initialized) {
        return;
      }

      // Add keyboard event listeners
      addKeyboardListeners();

      // Add send button listener (non-blocking)
      setTimeout(() => {
        try {
          addSendButtonListener();
        } catch {
          // Ignore errors
        }
      }, 2000);

      // Start background search typing hook once
      try {
        hookDeepseekBackgroundSearchTyping();
      } catch {
        // Ignore errors
      }
      // Wait additional time for UI to stabilize
      setTimeout(stageUIInit, 1000); // Reduced time
    } catch {
      // Don't mark as initialized on error
    }
  }

  // Stage 2: Initialize UI components after the DOM has settled
  function stageUIInit() {
    try {
      // Early exit if already initialized
      if (window.mem0Initialized) {
        return;
      }

      // Set up the observer to detect UI changes
      setupObserver();

      // Mark as initialized once we've completed both stages
      window.mem0Initialized = true;

      // Clear any existing interval
      if (mem0ButtonCheckInterval) {
        clearInterval(mem0ButtonCheckInterval);
      }

      // Set up periodic checks for button presence - check memory state first
      mem0ButtonCheckInterval = setInterval(async () => {
        try {
          const memoryEnabled = await getMemoryEnabledState();
          if (memoryEnabled) {
            if (!document.querySelector('#mem0-icon-button')) {
              addMem0IconButton();
            }
          } else {
            removeMem0IconButton();
          }
        } catch {
          // On error, don't do anything
        }
      }, 5000); // Check every 5 seconds

      // Final check after more time
      setTimeout(async () => {
        try {
          const memoryEnabled = await getMemoryEnabledState();
          if (memoryEnabled) {
            if (!document.querySelector('#mem0-icon-button')) {
              addMem0IconButton();
            }
          } else {
            removeMem0IconButton();
          }
        } catch {
          // On error, don't do anything
        }
      }, 5000);
    } catch {
      // Ignore errors
    }
  }

  // Add keyboard listeners with error handling
  function addKeyboardListeners() {
    try {
      // Skip if already added
      if (window.mem0KeyboardListenersAdded) {
        return;
      }

      // Listen for Enter key to handle memory processing
      document.addEventListener('keydown', handleEnterKey, true);

      // Listen for Ctrl+M to open the modal directly
      document.addEventListener('keydown', function (event) {
        if (event.ctrlKey && event.key === 'm') {
          event.preventDefault();
          (async () => {
            try {
              await handleMem0Modal('mem0-icon-button');
            } catch {
              // Ignore errors
            }
          })();
        }
      });

      window.mem0KeyboardListenersAdded = true;
    } catch {
      // Ignore errors
    }
  }

  // Set up mutation observer with throttling and filtering
  function setupObserver(): void {
    try {
      // Disconnect existing observer if any
      if (observer) {
        observer.disconnect();
      }

      // Track when we last processed mutations
      let lastObserverRun = 0;
      const MIN_THROTTLE_MS = 3000; // Reduced from 10s to 3s

      const ignoredSelectors = [
        '#mem0-icon-button',
        '.mem0-tooltip',
        '.mem0-tooltip-arrow',
        '#mem0-notification-dot',
        '#mem0-icon-button *', // Any children of the button
      ];

      observer = new MutationObserver(mutations => {
        // Skip mutations on ignored elements
        const shouldIgnore = mutations.every(mutation => {
          // Check if the mutation target or parents match any ignored selectors
          const isIgnoredElement =
            (mutation.target as Node).nodeType === Node.ELEMENT_NODE
              ? isIgnoredNode(mutation.target as Element, ignoredSelectors)
              : false;

          // Check added nodes for tooltip/button related elements
          if (mutation.type === 'childList') {
            const addedIgnored = Array.from(mutation.addedNodes).some(node => {
              return (
                node.nodeType === Node.ELEMENT_NODE &&
                isIgnoredNode(node as Element, ignoredSelectors)
              );
            });
            if (addedIgnored) {
              return true;
            }
          }

          return isIgnoredElement;
        });

        if (shouldIgnore) {
          return; // Skip these mutations
        }

        // Check if the button exists - no action needed if it does
        if (document.querySelector('#mem0-icon-button')) {
          return;
        }

        // Apply throttling
        const now = Date.now();
        if (now - lastObserverRun < MIN_THROTTLE_MS) {
          return; // Too soon, skip
        }

        // Process mutations - just check and add button
        lastObserverRun = now;
        addMem0IconButton();
      });

      // Helper function to check if a node matches ignored selectors
      // isIgnoredNode function is defined above

      // Only observe high-level document changes to detect navigation
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false,
        attributeFilter: ['class', 'style'], // Only observe class/style changes
      });
    } catch {
      // Ignore errors
    }
  }
}

async function getMemoryEnabledState(): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    chrome.storage.sync.get(
      [StorageKey.MEMORY_ENABLED, StorageKey.API_KEY, StorageKey.ACCESS_TOKEN],
      data => {
        // Check if memory is enabled AND if we have auth credentials
        const hasAuth = !!data.apiKey || !!data.access_token;
        const memoryEnabled = !!data.memory_enabled;

        // Only consider logged in if both memory is enabled and auth credentials exist
        resolve(!!(memoryEnabled && hasAuth));
      }
    );
  });
}

function getInputElementValue(): string | null {
  const inputElement = getInputElement();
  const el = inputElement as HTMLTextAreaElement | HTMLDivElement | null;
  if (!el) {
    return null;
  }
  // Prefer textContent for contenteditable
  const text = (el as HTMLDivElement).textContent ?? (el as HTMLTextAreaElement).value ?? null;
  return text;
}

function getAuthDetails(): Promise<{ apiKey: string; accessToken: string; userId: string }> {
  return new Promise(resolve => {
    chrome.storage.sync.get(
      [StorageKey.API_KEY, StorageKey.ACCESS_TOKEN, StorageKey.USER_ID_CAMEL],
      items => {
        resolve({
          apiKey: items.apiKey || null,
          accessToken: items.access_token || null,
          userId: items.userId || 'chrome-extension-user',
        });
      }
    );
  });
}

const MEM0_API_BASE_URL = 'https://api.mem0.ai';

let currentModalSourceButtonId: string | null = null;

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

    const res = await fetch('https://api.mem0.ai/v2/memories/search/', {
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

  // Don’t render on prefetch. When modal is open, update it.
  onSuccess: function (normQuery: string, responseData: MemorySearchItem[]) {
    if (!memoryModalShown) {
      return;
    }
    const memoryItems = ((responseData as MemorySearchItem[]) || []).map(
      (item: MemorySearchItem) => ({
        id: String(item.id),
        text: item.memory,
        categories: item.categories || [],
      })
    );
    createMemoryModal(memoryItems, false, currentModalSourceButtonId);
  },

  onError: function () {
    if (memoryModalShown) {
      createMemoryModal([], false, currentModalSourceButtonId);
    }
  },

  minLength: 3,
  debounceMs: 150,
  cacheTTL: 60000,
});

let deepseekBackgroundSearchHandler: (() => void) | null = null;
function hookDeepseekBackgroundSearchTyping() {
  const inputEl = getInputElement();
  if (!inputEl) {
    return;
  }
  if (!deepseekBackgroundSearchHandler) {
    deepseekBackgroundSearchHandler = function () {
      const text = getInputElementValue() || '';
      deepseekSearch.setText(text);
    };
  }
  inputEl.addEventListener('input', deepseekBackgroundSearchHandler);
  inputEl.addEventListener('keyup', deepseekBackgroundSearchHandler);
}

// async function searchMemories(query: string): Promise<MemoryItem[]> {
//   try {
//     const items = await chrome.storage.sync.get([
//       StorageKey.API_KEY,
//       StorageKey.USER_ID_CAMEL,
//       StorageKey.ACCESS_TOKEN,
//       StorageKey.SELECTED_ORG,
//       StorageKey.SELECTED_PROJECT,
//       StorageKey.USER_ID,
//       StorageKey.SIMILARITY_THRESHOLD,
//       StorageKey.TOP_K,
//     ]);
//     const userId = items.userId || items.user_id || "chrome-extension-user";
//     const threshold = items.similarity_threshold !== undefined ? items.similarity_threshold : 0.1;
//     const topK = items.top_k !== undefined ? items.top_k : 10;

//     if (!items.access_token && !items.apiKey) {
//       throw new Error("Authentication details missing");
//     }

//     const optionalParams: OptionalApiParams = {};
//     if (items.selected_org) {
//       optionalParams["org_id"] = items.selected_org;
//     }
//     if (items.selected_project) {
//       optionalParams["project_id"] = items.selected_project;
//     }

//     const headers: Record<string, string> = {
//       "Content-Type": "application/json",
//     };
//     if (items.access_token) {
//       headers["Authorization"] = `Bearer ${items.access_token}`;
//     } else {
//       headers["Authorization"] = `Api-Key ${items.apiKey}`;
//     }

//     const url = `${MEM0_API_BASE_URL}/v2/memories/search/`;
//     const body = JSON.stringify({
//       query: query,
//       filters: {
//         user_id: userId,
//       },
//       rerank: true,
//       threshold: threshold,
//       top_k: topK,
//       filter_memories: false,
//       // llm_rerank: true,
//       source: "OPENMEMORY_CHROME_EXTENSION",
//       ...optionalParams,
//     });

//     const response = await fetch(url, {
//       method: "POST",
//       headers: headers,
//       body: body,
//     });

//     if (!response.ok) {
//       throw new Error(`HTTP error! status: ${response.status}`);
//     }

//     const data = await response.json();

//     const memoryItems: MemoryItem[] = (data as MemorySearchResponse).map(item => ({
//       id: item.id,
//       text: item.text || item.memory,
//       created_at: item.created_at,
//       user_id: item.user_id,
//       memory: item.memory,
//     }));

//     return memoryItems;
//   } catch {
//     // Error preparing search request
//     return [];
//   }
// }

function addMemory(memoryText: string) {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const items = await chrome.storage.sync.get([
          StorageKey.API_KEY,
          StorageKey.USER_ID_CAMEL,
          StorageKey.ACCESS_TOKEN,
          StorageKey.SELECTED_ORG,
          StorageKey.SELECTED_PROJECT,
          StorageKey.USER_ID,
        ]);
        const userId = items.userId || items.user_id || 'chrome-extension-user';

        if (!items.access_token && !items.apiKey) {
          // No API Key or Access Token found for adding memory
          return reject(new Error('Authentication details missing'));
        }

        const optionalParams: OptionalApiParams = {};
        if (items.selected_org) {
          optionalParams['org_id'] = items.selected_org;
        }
        if (items.selected_project) {
          optionalParams['project_id'] = items.selected_project;
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (items.access_token) {
          headers['Authorization'] = `Bearer ${items.access_token}`;
        } else {
          headers['Authorization'] = `Api-Key ${items.apiKey}`;
        }

        const url = `${MEM0_API_BASE_URL}/v1/memories/`;
        const body = JSON.stringify({
          messages: [
            {
              role: MessageRole.User,
              content: memoryText,
            },
          ],
          user_id: userId,
          source: 'OPENMEMORY_CHROME_EXTENSION',
          ...optionalParams,
        });

        fetch(url, {
          method: 'POST',
          headers: headers,
          body: body,
        })
          .then(response => {
            if (!response.ok) {
              return response
                .json()
                .then(errorData => {
                  // Mem0 API Add Memory Error Response Body
                  throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
                })
                .catch(() => {
                  // Failed to parse add memory error response body
                  throw new Error(`HTTP error! status: ${response.status}`);
                });
            }
            if (response.status === 204) {
              return null;
            }
            return response.json();
          })
          .then(data => {
            resolve(data);
          })
          .catch(error => {
            // Error adding memory directly
            reject(error);
          });
      } catch (error) {
        // Error preparing add memory request
        reject(error);
      }
    })();
  });
}

async function triggerSendAction(): Promise<void> {
  try {
    // Get send button with multiple attempts if needed
    let sendButton = getSendButtonElement();
    let attempts = 0;

    // If button not found, try again a few times with increasing delays
    while (!sendButton && attempts < 3) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, attempts * 300));
      sendButton = getSendButtonElement();
    }

    if (sendButton) {
      // Check if button is disabled
      const isDisabled =
        sendButton.getAttribute('aria-disabled') === 'true' ||
        sendButton.classList.contains('disabled') ||
        sendButton.classList.contains('ds-button--disabled') ||
        sendButton.hasAttribute('disabled') ||
        (sendButton as ExtendedHTMLElement).disabled;

      if (!isDisabled) {
        // Try multiple click strategies
        try {
          // Strategy 1: Native click() method
          sendButton.click();

          // Strategy 2: After a short delay, try a MouseEvent if the first click didn't work
          setTimeout(() => {
            try {
              // Check if the input field is now empty (indicating message was sent)
              const inputElement = getInputElement() as HTMLTextAreaElement | HTMLDivElement;
              const inputValue = inputElement
                ? (
                    (inputElement as HTMLDivElement).textContent ||
                    (inputElement as HTMLTextAreaElement).value ||
                    ''
                  ).trim()
                : null;

              // If input is still not empty, try alternative click method
              if (inputValue && inputValue.length > 0) {
                const clickEvent = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                });
                sendButton.dispatchEvent(clickEvent);
              }
            } catch {
              // Ignore errors
            }
          }, 200);

          // Strategy 3: As a last resort, try to focus and press Enter
          setTimeout(() => {
            try {
              const inputElement = getInputElement() as HTMLTextAreaElement | HTMLDivElement;
              const inputValue = inputElement
                ? (
                    (inputElement as HTMLDivElement).textContent ||
                    (inputElement as HTMLTextAreaElement).value ||
                    ''
                  ).trim()
                : null;

              // If input is still not empty, try pressing Enter
              if (inputValue && inputValue.length > 0) {
                (inputElement as HTMLElement).focus();
                const enterEvent = new KeyboardEvent('keydown', {
                  key: 'Enter',
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                  bubbles: true,
                  cancelable: true,
                });
                if (inputElement) {
                  (inputElement as HTMLElement).dispatchEvent(enterEvent);
                }
              }
            } catch {
              // Ignore errors
            }
          }, 500);
        } catch {
          // Ignore errors
        }
      } else {
        // Button is disabled
      }
    } else {
      // No send button found
    }
  } catch {
    // Ignore errors
  }
}

async function handleMem0Processing(): Promise<void> {
  try {
    // Check if we're already processing (prevent double processing)
    if (isProcessingMem0) {
      return;
    }

    isProcessingMem0 = true;

    // Get the current input value
    const originalPrompt = getInputElementValue();
    if (!originalPrompt || originalPrompt.trim() === '') {
      isProcessingMem0 = false;
      triggerSendAction();
      return;
    }

    // Trigger the send action
    await triggerSendAction();

    // Add the user's input as a new memory
    try {
      if (originalPrompt.trim().length > 5) {
        // Only add non-trivial prompts
        await addMemory(originalPrompt);
      }
    } catch {
      // Continue regardless of error adding memory
    }

    // Reset state after a short delay
    setTimeout(() => {
      isProcessingMem0 = false;
      allMemories = []; // Clear loaded memories
      allMemoriesById = new Set();
    }, 1000);
  } catch {
    // Reset processing state and trigger send as fallback
    isProcessingMem0 = false;
    triggerSendAction();
  }
}

// Function to create a memory modal
function createMemoryModal(
  memoryItems: MemoryItem[],
  isLoading: boolean = false,
  sourceButtonId: string | null = null
): void {
  // Close existing modal if it exists (but preserve drag position for updates)
  if (memoryModalShown && currentModalOverlay) {
    document.body.removeChild(currentModalOverlay);
  }

  memoryModalShown = true;
  let currentMemoryIndex = 0;

  // Calculate modal dimensions
  const modalWidth = 447;
  let modalHeight = 400; // Default height
  let memoriesPerPage = 3; // Default number of memories per page

  let topPosition: number | undefined;
  let leftPosition: number | undefined;

  // Check if we have a stored drag position and use it
  if (modalDragPosition) {
    topPosition = modalDragPosition.top;
    leftPosition = modalDragPosition.left;
  } else {
    // Different positioning based on which button triggered the modal
    if (sourceButtonId === 'mem0-icon-button') {
      // Position relative to the mem0-icon-button
      const iconButton = document.querySelector('#mem0-icon-button');
      if (iconButton) {
        const buttonRect = iconButton.getBoundingClientRect();

        // Determine if there's enough space above the button
        const spaceAbove = buttonRect.top;
        const viewportHeight = window.innerHeight;

        leftPosition = buttonRect.left - modalWidth + buttonRect.width;
        leftPosition = Math.max(leftPosition, 10);

        if (spaceAbove >= modalHeight + 10) {
          // Place above
          topPosition = buttonRect.top - modalHeight - 10;
        } else {
          // Not enough space above, place below
          topPosition = buttonRect.bottom + 10;

          if (buttonRect.bottom > viewportHeight / 2) {
            modalHeight = 300; // Reduced height
            memoriesPerPage = 2; // Show only 2 memories
          }
        }
      } else {
        // Fallback to input-based positioning
        positionRelativeToInput();
      }
    } else {
      // Default positioning relative to the input field
      positionRelativeToInput();
    }
  }

  // Helper function to position modal relative to input field
  function positionRelativeToInput() {
    const inputElement = getInputElement();

    if (!inputElement) {
      return;
    }

    // Get the position and dimensions of the input field
    const inputRect = inputElement.getBoundingClientRect();

    // Determine if there's enough space below the input field
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - inputRect.bottom;

    // Position the modal aligned to the right of the input
    leftPosition = Math.max(inputRect.right - 20 - modalWidth, 10); // 20px offset from right edge

    // Decide whether to place modal above or below based on available space
    if (spaceBelow >= modalHeight) {
      // Place below the input
      topPosition = inputRect.bottom + 10;

      // Check if it's in the lower half of the screen
      if (inputRect.bottom > viewportHeight / 2) {
        modalHeight = 300; // Reduced height
        memoriesPerPage = 2; // Show only 2 memories
      }
    } else {
      // Place above the input if not enough space below
      topPosition = inputRect.top - modalHeight - 10;
    }
  }

  // Create modal overlay
  const modalOverlay = document.createElement('div');
  modalOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: transparent;
    display: flex;
    z-index: 10000;
    pointer-events: auto;
  `;

  // Save reference to current modal overlay
  currentModalOverlay = modalOverlay;

  // Add event listener to close modal when clicking outside
  modalOverlay.addEventListener('click', (event: MouseEvent) => {
    // Only close if clicking directly on the overlay, not its children
    if (event.target === modalOverlay) {
      closeModal();
    }
  });

  // Create modal container with positioning
  const modalContainer = document.createElement('div');
  modalContainer.style.cssText = `
    background-color: #1C1C1E;
    border-radius: 12px;
    width: ${modalWidth}px;
    height: ${modalHeight}px;
    display: flex;
    flex-direction: column;
    color: white;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    position: absolute;
    top: ${topPosition}px;
    left: ${leftPosition}px;
    pointer-events: auto;
    border: 1px solid #27272A;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
  `;

  // Create modal header
  const modalHeader = document.createElement('div');
  modalHeader.style.cssText = `
    display: flex;
    align-items: center;
    padding: 10px 16px;
    justify-content: space-between;
    background-color: #232325;
    flex-shrink: 0;
    cursor: move;
    user-select: none;
  `;

  // Create header left section with logo
  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    pointer-events: none;
  `;

  // Add Mem0 logo
  const logoImg = document.createElement('img');
  logoImg.src = chrome.runtime.getURL('icons/mem0-claude-icon.png');
  logoImg.style.cssText = `
    width: 26px;
    height: 26px;
    border-radius: 50%;
    margin-right: 10px;
  `;

  // OpenMemory titel
  const title = document.createElement('div');
  title.textContent = 'OpenMemory';
  title.style.cssText = `
    font-size: 16px;
    font-weight: 600;
    color: white;
  `;

  // Create header right section
  const headerRight = document.createElement('div');
  headerRight.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    pointer-events: auto;
  `;

  // Create Add to Prompt button with arrow
  const addToPromptBtn = document.createElement('button');
  addToPromptBtn.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 5px 16px;
    gap: 8px;
    background-color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    color: black;
  `;
  addToPromptBtn.textContent = 'Add to Prompt';

  // Add arrow icon to button
  const arrowIcon = document.createElement('span');
  arrowIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
  addToPromptBtn.appendChild(arrowIcon);

  // Create settings button
  const settingsBtn = document.createElement('button');
  settingsBtn.style.cssText = `
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px;
    opacity: 0.6;
    transition: opacity 0.2s;
  `;
  settingsBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  // Add click event to open app.mem0.ai in a new tab
  settingsBtn.addEventListener('click', () => {
    if (currentModalOverlay && document.body.contains(currentModalOverlay)) {
      document.body.removeChild(currentModalOverlay);
      memoryModalShown = false;
      currentModalOverlay = null;
    }

    chrome.runtime.sendMessage({ action: SidebarAction.SIDEBAR_SETTINGS });
  });

  // Add hover effect for the settings button
  settingsBtn.addEventListener('mouseenter', () => {
    settingsBtn.style.opacity = '1';
  });
  settingsBtn.addEventListener('mouseleave', () => {
    settingsBtn.style.opacity = '0.6';
  });

  // Content section
  const contentSection = document.createElement('div');
  const contentSectionHeight = modalHeight - 130; // Account for header and navigation
  contentSection.style.cssText = `
    display: flex;
    flex-direction: column;
    padding: 0 16px;
    gap: 12px;
    overflow: hidden;
    flex: 1;
    height: ${contentSectionHeight}px;
  `;

  // Create memories counter
  const memoriesCounter = document.createElement('div');
  memoriesCounter.style.cssText = `
    font-size: 16px;
    font-weight: 600;
    color: #FFFFFF;
    margin-top: 16px;
    flex-shrink: 0;
  `;

  // Update counter text based on loading state and number of memories
  if (isLoading) {
    memoriesCounter.textContent = `Loading Relevant Memories...`;
  } else {
    memoriesCounter.textContent = `${memoryItems.length} Relevant Memories`;
  }

  // Calculate max height for memories content based on modal height
  const memoriesContentMaxHeight = contentSectionHeight - 40; // Account for memories counter

  // Create memories content container with adjusted height
  const memoriesContent = document.createElement('div');
  memoriesContent.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
    max-height: ${memoriesContentMaxHeight}px;
    padding-right: 8px;
    margin-right: -8px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  `;
  memoriesContent.style.cssText += '::-webkit-scrollbar { display: none; }';

  // Track currently expanded memory
  let currentlyExpandedMemory: HTMLElement | null = null;

  // Function to create skeleton loading items
  function createSkeletonItems() {
    memoriesContent.innerHTML = '';

    for (let i = 0; i < memoriesPerPage; i++) {
      const skeletonItem = document.createElement('div');
      skeletonItem.style.cssText = `
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        justify-content: space-between;
        padding: 12px;
        background-color: #27272A;
        border-radius: 8px;
        height: 52px;
        flex-shrink: 0;
        animation: pulse 1.5s infinite ease-in-out;
      `;

      const skeletonText = document.createElement('div');
      skeletonText.style.cssText = `
        background-color: #383838;
        border-radius: 4px;
        height: 14px;
        width: 85%;
        margin-bottom: 8px;
      `;

      const skeletonText2 = document.createElement('div');
      skeletonText2.style.cssText = `
        background-color: #383838;
        border-radius: 4px;
        height: 14px;
        width: 65%;
      `;

      const skeletonActions = document.createElement('div');
      skeletonActions.style.cssText = `
        display: flex;
        gap: 4px;
        margin-left: 10px;
      `;

      const skeletonButton1 = document.createElement('div');
      skeletonButton1.style.cssText = `
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background-color: #383838;
      `;

      const skeletonButton2 = document.createElement('div');
      skeletonButton2.style.cssText = `
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background-color: #383838;
      `;

      skeletonActions.appendChild(skeletonButton1);
      skeletonActions.appendChild(skeletonButton2);

      const textContainer = document.createElement('div');
      textContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        flex-grow: 1;
      `;
      textContainer.appendChild(skeletonText);
      textContainer.appendChild(skeletonText2);

      skeletonItem.appendChild(textContainer);
      skeletonItem.appendChild(skeletonActions);
      memoriesContent.appendChild(skeletonItem);
    }

    // Add keyframe animation to document if not exists
    if (!document.getElementById('skeleton-animation')) {
      const style = document.createElement('style');
      style.id = 'skeleton-animation';
      style.innerHTML = `
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 0.8; }
          100% { opacity: 0.6; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  // Navigation section at bottom
  const navigationSection = document.createElement('div');
  navigationSection.style.cssText = `
    display: flex;
    justify-content: center;
    gap: 12px;
    padding: 10px;
    border-top: none;
    flex-shrink: 0;
  `;

  // Navigation buttons
  const prevButton = document.createElement('button');
  prevButton.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 19l-7-7 7-7" stroke="#A1A1AA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  prevButton.style.cssText = `
    background: #27272A;
    border: none;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.2s;
  `;

  const nextButton = document.createElement('button');
  nextButton.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 5l7 7-7 7" stroke="#A1A1AA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  nextButton.style.cssText = prevButton.style.cssText;

  // Add click handlers for navigation buttons
  prevButton.addEventListener('click', () => {
    // Calculate current page information
    const memoriesToShow = Math.min(memoriesPerPage, memoryItems.length);
    // const totalPages = Math.ceil(memoryItems.length / memoriesToShow);
    const currentPage = Math.floor(currentMemoryIndex / memoriesToShow) + 1;

    if (currentPage > 1) {
      currentMemoryIndex = Math.max(0, currentMemoryIndex - memoriesPerPage);
      showMemories();
    }
  });

  nextButton.addEventListener('click', () => {
    // Calculate current page information
    const memoriesToShow = Math.min(memoriesPerPage, memoryItems.length);
    const totalPages = Math.ceil(memoryItems.length / memoriesToShow);
    const currentPage = Math.floor(currentMemoryIndex / memoriesToShow) + 1;

    if (currentPage < totalPages) {
      currentMemoryIndex = currentMemoryIndex + memoriesPerPage;
      showMemories();
    }
  });

  // Assemble modal
  headerLeft.appendChild(logoImg);
  headerLeft.appendChild(title);
  headerRight.appendChild(addToPromptBtn);
  headerRight.appendChild(settingsBtn);

  modalHeader.appendChild(headerLeft);
  modalHeader.appendChild(headerRight);

  contentSection.appendChild(memoriesCounter);
  contentSection.appendChild(memoriesContent);

  navigationSection.appendChild(prevButton);
  navigationSection.appendChild(nextButton);

  modalContainer.appendChild(modalHeader);
  modalContainer.appendChild(contentSection);
  modalContainer.appendChild(navigationSection);

  modalOverlay.appendChild(modalContainer);

  // Add drag functionality
  let isDragging = false;
  const dragOffset = { x: 0, y: 0 };

  modalHeader.addEventListener('mousedown', (e: MouseEvent) => {
    isDragging = true;
    const containerRect = modalContainer.getBoundingClientRect();
    dragOffset.x = e.clientX - containerRect.left;
    dragOffset.y = e.clientY - containerRect.top;

    modalHeader.style.cursor = 'grabbing';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    e.preventDefault();
  });

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) {
      return;
    }

    const newLeft = e.clientX - dragOffset.x;
    const newTop = e.clientY - dragOffset.y;

    // Keep modal within viewport bounds
    const maxLeft = window.innerWidth - modalWidth;
    const maxTop = window.innerHeight - modalHeight;

    const constrainedLeft = Math.max(0, Math.min(newLeft, maxLeft));
    const constrainedTop = Math.max(0, Math.min(newTop, maxTop));

    modalContainer.style.left = constrainedLeft + 'px';
    modalContainer.style.top = constrainedTop + 'px';

    // Store the position for future modal recreations
    modalDragPosition = {
      left: constrainedLeft,
      top: constrainedTop,
    };
  }

  function handleMouseUp() {
    isDragging = false;
    modalHeader.style.cursor = 'move';
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }

  // Append to body
  document.body.appendChild(modalOverlay);

  // Show initial memories or loading state
  if (isLoading) {
    createSkeletonItems();
  } else {
    showMemories();
  }

  // Function to close the modal
  function closeModal() {
    if (currentModalOverlay && document.body.contains(currentModalOverlay)) {
      document.body.removeChild(currentModalOverlay);
    }
    currentModalOverlay = null;
    memoryModalShown = false;
    // Reset drag position when modal is truly closed by user action
    modalDragPosition = null;
  }

  // Function to show memories
  function showMemories() {
    memoriesContent.innerHTML = '';

    if (isLoading) {
      createSkeletonItems();
      return;
    }

    if (memoryItems.length === 0) {
      showEmptyState(memoriesContent);
      updateNavigationState(prevButton, nextButton, 0, 0);
      return;
    }

    // Use the dynamically set memoriesPerPage value
    const memoriesToShow = Math.min(memoriesPerPage, memoryItems.length);

    // Calculate total pages and current page
    const totalPages = Math.ceil(memoryItems.length / memoriesToShow);
    const currentPage = Math.floor(currentMemoryIndex / memoriesToShow) + 1;

    // Update navigation buttons state
    updateNavigationState(prevButton, nextButton, currentPage, totalPages);

    for (let i = 0; i < memoriesToShow; i++) {
      const memoryIndex = currentMemoryIndex + i;
      if (memoryIndex >= memoryItems.length) {
        break;
      }

      const memory = memoryItems[memoryIndex];
      if (!memory) {
        continue;
      }

      // Skip memories that have been added already
      if (allMemoriesById.has(String(memory.id))) {
        continue;
      }

      // Ensure memory has an ID
      if (!memory.id) {
        memory.id = `memory-${Date.now()}-${memoryIndex}`;
      }

      const memoryContainer = document.createElement('div');
      memoryContainer.style.cssText = `
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        justify-content: space-between;
        padding: 12px; 
        background-color: #27272A;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        min-height: 52px; 
        max-height: 52px; 
        overflow: hidden;
        flex-shrink: 0;
      `;

      const memoryText = document.createElement('div');
      memoryText.style.cssText = `
        font-size: 14px;
        line-height: 1.5;
        color: #D4D4D8;
        flex-grow: 1;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        transition: all 0.2s ease;
        height: 42px;
      `;
      memoryText.textContent = memory.memory || memory.text || '';

      // Create remove button (hidden by default)
      const removeButton = document.createElement('button');
      removeButton.style.cssText = `
        display: none;
        align-items: center;
        gap: 6px;
        background:rgba(54, 54, 54, 0.71);
        color:rgb(199, 199, 201);
        border-radius: 8px;
        padding: 2px 4px;
        border: none;
        cursor: pointer;
        font-size: 13px;
        margin-top: 12px;
        width: fit-content;
      `;
      removeButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Remove
      `;

      // Create content wrapper for text and remove button
      const contentWrapper = document.createElement('div');
      contentWrapper.style.cssText = `
        display: flex;
        flex-direction: column;
        flex-grow: 1;
      `;
      contentWrapper.appendChild(memoryText);
      contentWrapper.appendChild(removeButton);

      const actionsContainer = document.createElement('div');
      actionsContainer.style.cssText = `
        display: flex;
        gap: 4px;
        margin-left: 10px;
        flex-shrink: 0;
      `;

      // Add button
      const addButton = document.createElement('button');
      addButton.style.cssText = `
        border: none;
        cursor: pointer;
        padding: 4px;
        height: 28px;
        background:rgb(66, 66, 69);
        color:rgb(199, 199, 201);
        border-radius: 100%;
        transition: all 0.2s ease;
      `;

      addButton.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;

      // Add click handler for add button
      addButton.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        sendExtensionEvent('memory_injection', {
          provider: 'deepseek',
          source: 'OPENMEMORY_CHROME_EXTENSION',
          browser: getBrowser(),
          injected_all: false,
          memory_id: memory.id,
        });

        // Add this memory
        allMemoriesById.add(String(memory.id));
        allMemories.push(String(memory.memory || memory.text || ''));
        updateInputWithMemories();

        // Remove this memory from the list
        const index = memoryItems.findIndex((m: MemoryItem) => m.id === memory.id);
        if (index !== -1) {
          memoryItems.splice(index, 1);

          // Recalculate pagination after removing an item
          if (currentMemoryIndex > 0 && currentMemoryIndex >= memoryItems.length) {
            currentMemoryIndex = Math.max(0, currentMemoryIndex - memoriesPerPage);
          }

          memoriesCounter.textContent = `${memoryItems.length} Relevant Memories`;
          showMemories();
        }
      });

      // Menu button (more options)
      const menuButton = document.createElement('button');
      menuButton.style.cssText = `
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        color: #A1A1AA;
      `;
      menuButton.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="2"/>
        <circle cx="12" cy="5" r="2"/>
        <circle cx="12" cy="19" r="2"/>
      </svg>`;

      // Track expanded state
      let isExpanded = false;

      // Function to expand memory
      const expandMemoryHandler = () => {
        expandMemory(
          memoryContainer,
          memoryText,
          contentWrapper,
          removeButton,
          currentlyExpandedMemory,
          memoriesContent
        );
      };

      // Function to collapse memory
      const collapseMemoryHandler = () => {
        collapseMemory(memoryContainer, memoryText, contentWrapper, removeButton);
      };

      // Add collapse event listener
      memoryContainer.addEventListener('collapse', collapseMemoryHandler);

      // Add click handler for the menu button
      menuButton.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        if (isExpanded) {
          collapseMemoryHandler();
        } else {
          expandMemoryHandler();
        }
      });

      // Add click handler for remove button
      removeButton.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        // Remove from memoryItems
        const index = memoryItems.findIndex(m => m.id === memory.id);
        if (index !== -1) {
          memoryItems.splice(index, 1);

          // Recalculate pagination after removing an item
          // const newTotalPages = Math.ceil(memoryItems.length / memoriesPerPage);

          // If we're on the last page and it's now empty, go to previous page
          if (currentMemoryIndex > 0 && currentMemoryIndex >= memoryItems.length) {
            currentMemoryIndex = Math.max(0, currentMemoryIndex - memoriesPerPage);
          }

          memoriesCounter.textContent = `${memoryItems.length} Relevant Memories`;
          showMemories();
        }
      });

      actionsContainer.appendChild(addButton);
      actionsContainer.appendChild(menuButton);

      memoryContainer.appendChild(contentWrapper);
      memoryContainer.appendChild(actionsContainer);
      memoriesContent.appendChild(memoryContainer);

      // Add hover effect
      memoryContainer.addEventListener('mouseenter', () => {
        memoryContainer.style.backgroundColor = isExpanded ? '#1C1C1E' : '#323232';
      });

      memoryContainer.addEventListener('mouseleave', () => {
        memoryContainer.style.backgroundColor = isExpanded ? '#1C1C1E' : '#27272A';
      });

      // Add click handler to expand/collapse when clicking on memory
      memoryContainer.addEventListener('click', () => {
        if (isExpanded) {
          collapseMemoryHandler();
        } else {
          expandMemoryHandler();
        }
      });
    }
  }

  // Update Add to Prompt button click handler
  addToPromptBtn.addEventListener('click', () => {
    // Only add memories that are not already added
    const newMemories = memoryItems
      .filter(memory => !allMemoriesById.has(String(memory.id)))
      .map(memory => {
        allMemoriesById.add(String(memory.id));
        return String(memory.memory || memory.text || '');
      });

    sendExtensionEvent('memory_injection', {
      provider: 'deepseek',
      source: 'OPENMEMORY_CHROME_EXTENSION',
      browser: getBrowser(),
      injected_all: true,
      memory_count: newMemories.length,
    });
    // Add all new memories to allMemories
    allMemories.push(...newMemories);

    // Update the input with all memories
    if (allMemories.length > 0) {
      updateInputWithMemories();
      closeModal();
    } else {
      // If no new memories were added but we have existing ones, just close
      if (allMemoriesById.size > 0) {
        closeModal();
      }
    }
  });
}

// Function to show empty state with specific container
function showEmptyState(container: HTMLElement) {
  if (!container) {
    return;
  }

  container.innerHTML = '';

  const emptyContainer = document.createElement('div');
  emptyContainer.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    text-align: center;
    flex: 1;
    min-height: 200px;
  `;

  const emptyIcon = document.createElement('div');
  emptyIcon.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#71717A" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v10a2 2 0 01-2 2h-4M3 21h4a2 2 0 002-2v-4m-6 6V9m18 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  emptyIcon.style.marginBottom = '16px';

  const emptyText = document.createElement('div');
  emptyText.textContent = 'No relevant memories found';
  emptyText.style.cssText = `
    color: #71717A;
    font-size: 14px;
    font-weight: 500;
  `;

  emptyContainer.appendChild(emptyIcon);
  emptyContainer.appendChild(emptyText);
  container.appendChild(emptyContainer);
}

// Update navigation button states with specific buttons
function updateNavigationState(
  prevButton: HTMLButtonElement,
  nextButton: HTMLButtonElement,
  currentPage: number,
  totalPages: number
) {
  if (!prevButton || !nextButton) {
    return;
  }

  if (totalPages === 0) {
    prevButton.disabled = true;
    prevButton.style.opacity = '0.5';
    prevButton.style.cursor = 'not-allowed';
    nextButton.disabled = true;
    nextButton.style.opacity = '0.5';
    nextButton.style.cursor = 'not-allowed';
    return;
  }

  if (currentPage <= 1) {
    prevButton.disabled = true;
    prevButton.style.opacity = '0.5';
    prevButton.style.cursor = 'not-allowed';
  } else {
    prevButton.disabled = false;
    prevButton.style.opacity = '1';
    prevButton.style.cursor = 'pointer';
  }

  if (currentPage >= totalPages) {
    nextButton.disabled = true;
    nextButton.style.opacity = '0.5';
    nextButton.style.cursor = 'not-allowed';
  } else {
    nextButton.disabled = false;
    nextButton.style.opacity = '1';
    nextButton.style.cursor = 'pointer';
  }
}

// Function to apply memories to the input field
function updateInputWithMemories(): void {
  const inputElement = getInputElement();

  if (inputElement && allMemories.length > 0) {
    // Get the content without any existing memory wrappers
    const baseContent = getContentWithoutMemories();

    // Create the memory wrapper with all collected memories
    let memoriesContent = '\n\n' + OPENMEMORY_PROMPTS.memory_header_text + '\n';
    // Add all memories to the content
    allMemories.forEach(mem => {
      memoriesContent += `- ${mem}\n`;
    });

    // Add the final content to the input
    (inputElement as HTMLTextAreaElement).value = `${baseContent}${memoriesContent}`;
    (inputElement as HTMLElement).dispatchEvent(new Event('input', { bubbles: true }));
    (inputElement as HTMLElement).focus();
  }
}

// Function to get the content without any memory wrappers
function getContentWithoutMemories(): string {
  const inputElement = getInputElement();
  if (!inputElement) {
    return '';
  }

  let content =
    (inputElement as HTMLDivElement).textContent ||
    (inputElement as HTMLTextAreaElement).value ||
    '';

  // Remove memories section
  content = content.replace(/\n\nHere is some of my memories[\s\S]*$/, '');

  return content.trim();
}

// Function to handle the Mem0 modal
async function handleMem0Modal(sourceButtonId: string | null = null): Promise<void> {
  try {
    // First check if memory is enabled (user is logged in)
    const memoryEnabled = await getMemoryEnabledState();
    if (!memoryEnabled) {
      // User is not logged in, show login modal
      showLoginModal();
      return;
    }

    // Get current input text
    const message = getInputElementValue();

    // If no message, show a guidance popover and return
    if (!message || message.trim() === '') {
      showGuidancePopover();
      return;
    }

    if (isProcessingMem0) {
      return;
    }

    isProcessingMem0 = true;

    // Show the loading modal immediately
    createMemoryModal([], true, sourceButtonId);

    try {
      const auth = await getAuthDetails();
      if (!auth.apiKey && !auth.accessToken) {
        isProcessingMem0 = false;
        showLoginModal();
        return;
      }

      sendExtensionEvent('modal_clicked', {
        provider: 'deepseek',
        source: 'OPENMEMORY_CHROME_EXTENSION',
        browser: getBrowser(),
      });
      currentModalSourceButtonId = sourceButtonId;
      deepseekSearch.runImmediate(message);

      addMemory(message).catch(() => {
        // Ignore errors
      });
    } catch {
      // Error in handleMem0Modal
      createMemoryModal([], false, sourceButtonId);
    } finally {
      isProcessingMem0 = false;
    }
  } catch {
    isProcessingMem0 = false;
  }
}

// Function to show a guidance popover when input is empty
function showGuidancePopover(): void {
  // First remove any existing popovers
  const existingPopover = document.getElementById('mem0-guidance-popover');
  if (existingPopover) {
    document.body.removeChild(existingPopover);
  }

  // Get the Mem0 button to position relative to it
  const mem0Button = document.getElementById('mem0-icon-button');
  if (!mem0Button) {
    return;
  }

  const buttonRect = mem0Button.getBoundingClientRect();

  // Create the popover
  const popover = document.createElement('div');
  popover.id = 'mem0-guidance-popover';
  popover.style.cssText = `
    position: fixed;
    background-color: #1C1C1E;
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    z-index: 10002;
    max-width: 250px;
    border: 1px solid #383838;
    top: ${buttonRect.bottom + 10}px;
    left: ${buttonRect.left - 110}px;
  `;

  // Add content to the popover
  popover.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 8px; color: #F8FAFF;">No Input Detected</div>
    <div style="color: #D4D4D8; line-height: 1.4;">
      Please type your message in the input field first to add or search memories.
    </div>
  `;

  // Add close button
  const closeButton = document.createElement('button');
  closeButton.style.cssText = `
    position: absolute;
    top: 8px;
    right: 8px;
    background: none;
    border: none;
    color: #A1A1AA;
    cursor: pointer;
    padding: 4px;
    line-height: 1;
  `;
  closeButton.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" fill="none">
      <path d="M18 6L6 18M6 6l12 12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  closeButton.addEventListener('click', () => {
    if (document.body.contains(popover)) {
      document.body.removeChild(popover);
    }
  });

  // Add arrow
  const arrow = document.createElement('div');
  arrow.style.cssText = `
    position: absolute;
    top: -6px;
    left: 120px;
    width: 12px;
    height: 12px;
    background: #1C1C1E;
    transform: rotate(45deg);
    border-left: 1px solid #383838;
    border-top: 1px solid #383838;
  `;

  popover.appendChild(closeButton);
  popover.appendChild(arrow);
  document.body.appendChild(popover);

  // Auto-close after 5 seconds
  setTimeout(() => {
    if (document.body.contains(popover)) {
      document.body.removeChild(popover);
    }
  }, 5000);
}

// Function to show login modal
function showLoginModal(): void {
  // First check if modal already exists
  if (document.getElementById('mem0-login-popup')) {
    return;
  }

  // Create popup overlay
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
    z-index: 100000;
  `;

  // Create popup container
  const popupContainer = document.createElement('div');
  popupContainer.style.cssText = `
    background-color: #1C1C1E;
    border-radius: 12px;
    width: 320px;
    padding: 24px;
    color: white;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
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
    font-weight: 500;
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
    // Send message to background script to handle authentication
    try {
      chrome.runtime.sendMessage({ action: SidebarAction.SHOW_LOGIN_POPUP });
    } catch {
      // Ignore errors
    }
    // Fallback: open the login page directly
    window.open('https://app.mem0.ai/login', '_blank');

    // Close the modal
    document.body.removeChild(popupOverlay);
  });

  // Assemble popup
  popupContainer.appendChild(logoContainer);
  popupContainer.appendChild(message);
  popupContainer.appendChild(signInButton);

  popupOverlay.appendChild(popupContainer);
  popupOverlay.appendChild(closeButton);

  // Add click event to close when clicking outside
  popupOverlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });

  // Add to body
  document.body.appendChild(popupOverlay);
}

// Function to add the Mem0 icon button - enhanced with error handling and return status
function addMem0IconButton() {
  try {
    // Check if memory is enabled before adding the button
    getMemoryEnabledState()
      .then(memoryEnabled => {
        if (!memoryEnabled) {
          removeMem0IconButton();
          return;
        }

        // Continue with button creation if memory is enabled
        createAndAddButton();
      })
      .catch(() => {
        // If we can't check memory state, don't add the button
      });

    return { success: true, status: 'checking_memory_state' };
  } catch {
    return { success: false, status: 'unexpected_error', error: 'Unknown error' };
  }

  // Helper function to create and add the button
  function createAndAddButton() {
    // Check if the button already exists
    if (document.querySelector('#mem0-icon-button')) {
      return { success: true, status: 'already_exists' };
    }

    // Wait for input element to be available before trying to add the button
    const inputElement = getInputElement();
    if (!inputElement) {
      // Retry in 1 second
      setTimeout(addMem0IconButton, 1000);
      return { success: false, status: 'no_input_element' };
    }

    // Try multiple approaches to find placement locations
    let searchButton = null;
    let buttonContainer = null;
    let status = 'searching';

    // Approach 1: Look for the search button by class and specific selectors
    searchButton = document.querySelector('div[role="button"] .ds-button__icon + span');
    if (searchButton && (searchButton.textContent || '').trim().toLowerCase() === 'search') {
      const parentBtn = searchButton.closest('div[role="button"]');
      buttonContainer = parentBtn ? (parentBtn.parentElement as HTMLElement) : null;
      if (buttonContainer) {
        status = 'found_search_button';
      }
    } else {
      // Try alternative selector
      const allButtons = document.querySelectorAll('div[role="button"]');
      Array.from(allButtons).some(btn => {
        if ((btn.textContent || '').trim().toLowerCase() === 'search') {
          searchButton = btn.querySelector('span');
          buttonContainer = (btn as HTMLElement).parentElement as HTMLElement;
          status = 'found_search_button_alt';
          return true;
        }
        return false;
      });
    }

    // Approach 2: Look for any toolbar or button container
    if (!buttonContainer) {
      const toolbars = document.querySelectorAll('.toolbar, .button-container, .controls');
      if (toolbars.length > 0) {
        buttonContainer = toolbars[0];
        status = 'found_toolbar';
      }
    }

    // Approach 3: Try to find the input field and place it near there
    if (!buttonContainer) {
      if (inputElement && inputElement.parentElement) {
        // Try going up a few levels to find a good container
        let parent: HTMLElement = inputElement.parentElement as HTMLElement;
        let level = 0;
        while (parent && level < 3) {
          const buttons = parent.querySelectorAll('div[role="button"]');
          if (buttons.length > 0) {
            buttonContainer = parent;
            status = 'found_input_parent_with_buttons';
            break;
          }
          parent = parent.parentElement as HTMLElement;
          level++;
        }

        // If still not found, use direct parent
        if (!buttonContainer) {
          buttonContainer = inputElement.parentElement;
          status = 'found_input_parent';
        }
      }
    }

    // Approach 4: Look for a div with role="toolbar"
    if (!buttonContainer) {
      const toolbars = document.querySelectorAll('div[role="toolbar"]');
      if (toolbars.length > 0) {
        buttonContainer = toolbars[0];
        status = 'found_role_toolbar';
      }
    }

    // If we couldn't find a suitable container, create one near the input
    if (!buttonContainer && inputElement) {
      buttonContainer = document.createElement('div');
      buttonContainer.id = 'mem0-custom-container';
      buttonContainer.style.cssText = `
        display: flex;
        position: absolute;
        top: ${inputElement.getBoundingClientRect().top - 40}px;
        left: ${inputElement.getBoundingClientRect().right - 100}px;
        z-index: 1000;
      `;
      document.body.appendChild(buttonContainer);
      status = 'created_custom_container';
    }

    // If we couldn't find a suitable container, bail out
    if (!buttonContainer) {
      return { success: false, status: 'no_container' };
    }

    // Remove existing button if any
    const existingButton = document.querySelector('#mem0-icon-button');
    if (existingButton) {
      try {
        if (existingButton.parentElement) {
          existingButton.parentElement.removeChild(existingButton);
        }
      } catch {
        // Ignore errors
      }
    }

    // Create button container
    const mem0ButtonContainer = document.createElement('div');
    mem0ButtonContainer.style.cssText = `
      display: inline-flex;
      position: relative;
      margin: 0 4px;
      align-items: center;
    `;

    // Create notification dot
    const notificationDot = document.createElement('div');
    notificationDot.id = 'mem0-notification-dot';
    notificationDot.style.cssText = `
      position: absolute;
      top: -3px;
      right: -3px;
      width: 8px;
      height: 8px;
      background-color: rgb(128, 221, 162);
      border-radius: 50%;
      border: 1px solid #1C1C1E;
      display: none;
      z-index: 1001;
      pointer-events: none;
    `;

    // Add keyframe animation for the dot
    if (!document.getElementById('notification-dot-animation')) {
      try {
        const style = document.createElement('style');
        style.id = 'notification-dot-animation';
        style.innerHTML = `
          @keyframes popIn {
            0% { transform: scale(0); }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); }
          }
          
          #mem0-notification-dot.active {
            display: block !important;
            animation: popIn 0.3s ease-out forwards;
          }
        `;
        document.head.appendChild(style);
      } catch {
        // Ignore errors
      }
    }

    // Create the button to match DeepSeek style
    const mem0Button = document.createElement('div');
    mem0Button.id = 'mem0-icon-button';
    mem0Button.setAttribute('role', 'button');
    mem0Button.className = 'ds-button ds-button--rect ds-button--m';
    mem0Button.tabIndex = 0 as number;
    mem0Button.style.cssText = `
      cursor: pointer;
      height: 30px;
      display: inline-flex;
      margin-left: -2px;
      align-items: center;
      padding: 0px 6px;
      border: 1px solid rgb(95, 95, 95);
      border-radius: 16px;
      background-color: rgba(255, 255, 255, 0.0);
      transition: background-color 0.2s;
    `;

    // Rest of the existing button creation code...
    // Create the icon container
    const iconContainer = document.createElement('div');
    iconContainer.className = 'ds-button__icon';
    iconContainer.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 2px;
    `;

    // Create the icon
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/mem0-claude-icon-p.png');
    icon.style.cssText = `
      width: 14px;
      height: 14px;
      border-radius: 100%;
    `;

    // Create button text
    const buttonText = document.createElement('span');
    buttonText.style.cssText = `
      color: #F8FAFF;
      font-size: 12px;
    `;
    buttonText.textContent = 'Memory';

    // Create tooltip with improved stability
    const tooltip = document.createElement('div');
    tooltip.className = 'mem0-tooltip';
    tooltip.style.cssText = `
      position: absolute;
      bottom: 40px;
      left: 50%;
      transform: translateX(-50%);
      background-color: #1C1C1E;
      color: white;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      white-space: nowrap;
      z-index: 10001;
      display: none;
      transition: opacity 0.2s;
      opacity: 0;
      pointer-events: none;
    `;
    tooltip.textContent = 'Add memories to your prompt';

    // Add arrow to tooltip
    const arrow = document.createElement('div');
    arrow.className = 'mem0-tooltip-arrow';
    arrow.style.cssText = `
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%) rotate(45deg);
      width: 8px;
      height: 8px;
      background-color: #1C1C1E;
      pointer-events: none;
    `;
    tooltip.appendChild(arrow);

    // Show/hide tooltip using more stable approach with a data attribute
    let tooltipVisible = false;

    mem0Button.addEventListener('mouseenter', () => {
      if (tooltipVisible) {
        return;
      }
      tooltipVisible = true;

      tooltip.style.display = 'block';
      requestAnimationFrame(() => {
        tooltip.style.opacity = '1';
        mem0Button.style.backgroundColor = '#424451';
      });
    });

    mem0Button.addEventListener('mouseleave', () => {
      if (!tooltipVisible) {
        return;
      }
      tooltipVisible = false;

      tooltip.style.opacity = '0';
      setTimeout(() => {
        if (!tooltipVisible) {
          tooltip.style.display = 'none';
          mem0Button.style.backgroundColor = 'rgba(41, 41, 46, 0.5)';
        }
      }, 200);
    });

    // Add click event to open memories modal - also check memory state again
    mem0Button.addEventListener('click', async () => {
      try {
        const memoryEnabled = await getMemoryEnabledState();
        if (memoryEnabled) {
          await handleMem0Modal('mem0-icon-button');
        } else {
          // Show login modal for non-logged in users
          showLoginModal();

          // Remove the button since memory is disabled
          removeMem0IconButton();
        }
      } catch {
        showLoginModal();
      }
    });

    // Assemble the button
    iconContainer.appendChild(icon);
    mem0Button.appendChild(iconContainer);
    mem0Button.appendChild(buttonText);
    mem0Button.appendChild(notificationDot);
    mem0ButtonContainer.appendChild(mem0Button);
    mem0ButtonContainer.appendChild(tooltip);

    // Insert the button in the appropriate position
    try {
      if (status === 'found_search_button' || status === 'found_search_button_alt') {
        // Position after the search button (to the right)
        const searchButtonParent = searchButton ? searchButton.closest('div[role="button"]') : null;
        if (searchButtonParent && searchButtonParent.nextSibling) {
          buttonContainer.insertBefore(mem0ButtonContainer, searchButtonParent.nextSibling);
        } else {
          buttonContainer.appendChild(mem0ButtonContainer);
        }
      } else if (status === 'found_toolbar' || status === 'found_role_toolbar') {
        // Find an appropriate position in the toolbar - prefer the right side
        const lastChild = buttonContainer.lastChild;
        if (lastChild) {
          buttonContainer.insertBefore(mem0ButtonContainer, null); // append to end
        } else {
          buttonContainer.appendChild(mem0ButtonContainer);
        }
      } else if (status === 'created_custom_container') {
        // Custom container - just append
        buttonContainer.appendChild(mem0ButtonContainer);
      } else {
        // Other cases - try to position after any buttons in the container
        const buttons = buttonContainer.querySelectorAll('div[role="button"]');
        if (buttons.length > 0) {
          const lastButton = buttons[buttons.length - 1];
          buttonContainer.insertBefore(
            mem0ButtonContainer,
            lastButton && lastButton.nextSibling ? lastButton.nextSibling : null
          );
        } else {
          buttonContainer.appendChild(mem0ButtonContainer);
        }
      }

      // Only log the first time, not on subsequent calls
      if (!window.mem0ButtonAdded) {
        window.mem0ButtonAdded = true;
      }
    } catch {
      return { success: false, status: 'insert_failed', error: 'Insert failed' };
    }

    // Update notification dot based on input content
    try {
      updateNotificationDot();
    } catch {
      // Ignore errors
    }

    return { success: true, status: status };
  }
}

// Function to update the notification dot
function updateNotificationDot() {
  const inputElement = getInputElement();
  const notificationDot = document.querySelector('#mem0-notification-dot');

  if (inputElement && notificationDot) {
    // Function to check if input has text
    const checkForText = () => {
      const inputText = inputElement.value || '';
      const hasText = inputText.trim() !== '';

      if (hasText) {
        notificationDot.classList.add('active');
        notificationDot.style.display = 'block';
      } else {
        notificationDot.classList.remove('active');
        notificationDot.style.display = 'none';
      }
    };

    // Set up an observer to watch for changes to the input field
    const inputObserver = new MutationObserver(checkForText);

    // Start observing the input element
    inputObserver.observe(inputElement, {
      attributes: true,
      attributeFilter: ['value'],
    });

    // Also check on input events
    inputElement.addEventListener('input', checkForText);

    // Initial check
    checkForText();
  }
}

// Add a function to clear memories after sending a message
function addSendButtonListener(): void {
  // Get all potential buttons
  const allButtons = document.querySelectorAll('div[role="button"]');

  // Log details of each button for debugging
  Array.from(allButtons).forEach(() => {
    // Debug logging
  });

  // Try to get the send button
  const sendButton = getSendButtonElement();

  if (sendButton) {
    if (!sendButton.dataset.mem0Listener) {
      sendButton.dataset.mem0Listener = 'true';
      sendButton.addEventListener('click', function () {
        // Clear all memories after sending
        setTimeout(() => {
          allMemories = [];
          allMemoriesById.clear();
        }, 100);
      });
    } else {
      // Button already has listener
    }
  } else {
    // No send button found
  }
}

// Call the initialization function
initializeMem0Integration();
