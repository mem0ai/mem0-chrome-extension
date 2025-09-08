import { MessageRole } from '../types/api';
import type { HistoryStateData } from '../types/browser';
import type { ExtendedDocument, ExtendedElement, ExtendedHTMLElement } from '../types/dom';
import type { MemoryItem, MemorySearchItem, OptionalApiParams } from '../types/memory';
import { SidebarAction } from '../types/messages';
import { type StorageData, StorageKey } from '../types/storage';
import { createOrchestrator, type SearchStorage } from '../utils/background_search';
import { OPENMEMORY_PROMPTS } from '../utils/llm_prompts';
import { getBrowser, sendExtensionEvent } from '../utils/util_functions';

export {};

// Global variables to store all memories
let allMemories: string[] = [];
let memoryModalShown: boolean = false;
let isProcessingMem0: boolean = false;
let memoryEnabled: boolean = true;

// Cache of the latest typed text to avoid race when the editor is cleared
let lastTyped = '';
// Timestamp of when a send was initiated (to prevent duplicate fallback posts)
let lastSendInitiatedAt = 0;

let currentModalSourceButtonId: string | null = null;

const claudeSearch = createOrchestrator({
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
      threshold,
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

  onSuccess: function (normQuery: string, responseData: MemorySearchItem[]) {
    if (!memoryModalShown) {
      return;
    }
    const memoryItems = (responseData || []).map((item: MemorySearchItem, index: number) => ({
      id: String(item.id || `memory-${Date.now()}-${index}`),
      text: item.memory,
      categories: item.categories || [],
    }));
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

// Sliding window for conversation context
let conversationHistory: Array<{ role: MessageRole; content: string; timestamp: number }> = [];
const MAX_CONVERSATION_HISTORY = 12; // Keep last 12 messages (6 pairs of user/assistant)

// Function to add message to conversation history with sliding window
function addToConversationHistory(role: MessageRole, content: string) {
  if (!content || !content.trim()) {
    return;
  }

  const trimmedContent = content.trim();

  // Check for duplicate - don't add if the last message is identical
  if (conversationHistory.length > 0) {
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (lastMessage && lastMessage.role === role && lastMessage.content === trimmedContent) {
      return;
    }
  }

  const message = {
    role: role,
    content: trimmedContent,
    timestamp: Date.now(),
  };

  // Add to history
  conversationHistory.push(message);

  // Maintain sliding window - remove oldest messages if we exceed limit
  if (conversationHistory.length > MAX_CONVERSATION_HISTORY) {
    conversationHistory.splice(0, conversationHistory.length - MAX_CONVERSATION_HISTORY);
  }
}

// Function to get conversation context for memory creation
function getConversationContext(includeCurrent: boolean = true) {
  if (conversationHistory.length === 0) {
    return [];
  }

  // Get the last 6 messages for context (excluding current if requested)
  const contextSize = 6;
  let contextMessages = [...conversationHistory];

  if (!includeCurrent && contextMessages.length > 0) {
    // Remove the last message if it's the current user message
    contextMessages = contextMessages.slice(0, -1);
  }

  // Get last N messages
  const context = contextMessages.slice(-contextSize).map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  return context;
}

// Function to initialize conversation history from existing messages on page
function initializeConversationHistoryFromDOM() {
  const messageContainer = document.querySelector(
    '.flex-1.flex.flex-col.gap-3.px-4.max-w-3xl.mx-auto.w-full'
  );

  if (!messageContainer) {
    return;
  }

  const messageElements = Array.from(messageContainer.children);

  // Process existing messages in chronological order
  messageElements.forEach(element => {
    const userElement = element.querySelector('.font-user-message');
    const assistantElement = element.querySelector('.font-claude-message');

    if (userElement) {
      const content = (userElement.textContent || '').trim();
      if (content) {
        addToConversationHistory(MessageRole.User, content);
      }
    } else if (assistantElement) {
      const content = (assistantElement.textContent || '').trim();
      if (content) {
        addToConversationHistory(MessageRole.Assistant, content);
      }
    }
  });
}

// Initialize the MutationObserver variable
let observer: MutationObserver;
let debounceTimer: number | undefined;

// Track added memories by ID
const allMemoriesById: Set<string> = new Set<string>();

// Reference to the modal overlay for updates
let currentModalOverlay:
  | HTMLDivElement
  | (HTMLDivElement & { _cleanupDragEvents?: () => void })
  | null = null;

// Variables to track modal position for draggable functionality
let modalPosition: { top: number; left: number } | null = null;
let isDragging: boolean = false;
const dragOffset: { x: number; y: number } = { x: 0, y: 0 };

// Function to get memory enabled state from storage
async function getMemoryEnabledState() {
  return new Promise(resolve => {
    // Check if extension context is valid
    if (!chrome || !chrome.storage || !chrome.storage.sync) {
      resolve(true); // Default to enabled if we can't check
      return;
    }

    try {
      chrome.storage.sync.get(StorageKey.MEMORY_ENABLED, function (data) {
        try {
          // @ts-ignore
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(true); // Default to enabled if error
            return;
          }
          resolve(data.memory_enabled);
        } catch {
          // Ignore errors when checking chrome.runtime.lastError
        }
      });
    } catch {
      resolve(true); // Default to enabled if exception
    }
  });
}

// Function to remove mem0 button if it exists
function removeMemButton(): void {
  const mem0Button = document.querySelector('#mem0-button');
  if (mem0Button) {
    const buttonContainer = mem0Button.closest('div');
    if (buttonContainer) {
      buttonContainer.remove();
    } else {
      mem0Button.remove();
    }
  }

  // Also remove tooltip if it exists
  const tooltip = document.querySelector('#mem0-tooltip');
  if (tooltip) {
    tooltip.remove();
  }
}

function addMem0Button(): void {
  // Check if memory is enabled before adding the button
  getMemoryEnabledState().then(enabled => {
    memoryEnabled = Boolean(enabled);

    // If memory is disabled, remove any existing button and return
    if (memoryEnabled === false) {
      removeMemButton();
      return;
    }

    const sendButton = document.querySelector('button[aria-label="Send Message"]');
    const sendUpButton = document.querySelector('button[aria-label="Send message"]');
    const screenshotButton = document.querySelector('button[aria-label="Capture screenshot"]');
    const inputToolsMenuButton = document.querySelector('#input-tools-menu-trigger') as HTMLElement;

    function createPopup(
      container: HTMLElement,
      position: 'top' | 'right' = 'top'
    ): HTMLDivElement {
      const popup = document.createElement('div');
      popup.className = 'mem0-popup';
      let positionStyles = '';

      if (position === 'top') {
        positionStyles = `
          bottom: 100%;
          left: 50%;
          transform: translateX(-40%);
          margin-bottom: 11px;
        `;
      } else if (position === 'right') {
        positionStyles = `
          top: 50%;
          left: 100%;
          transform: translateY(-50%);
          margin-left: 11px;
        `;
      }

      popup.style.cssText = `
              display: none;
              position: absolute;
              background-color: #21201C;
              color: white;
              padding: 6px 8px;
              border-radius: 6px;
              font-size: 12px;
              z-index: 10000;
              white-space: nowrap;
              box-shadow: 0 2px 5px rgba(0,0,0,0.2);
              ${positionStyles}
          `;
      container.appendChild(popup);
      return popup;
    }

    if (inputToolsMenuButton && !document.querySelector('#mem0-button')) {
      const buttonContainer = document.createElement('div');
      buttonContainer.style.position = 'relative';
      buttonContainer.style.display = 'inline-block';

      const mem0Button = document.createElement('button');
      mem0Button.id = 'mem0-button';
      mem0Button.className = inputToolsMenuButton.className;
      mem0Button.style.marginLeft = '0px';
      mem0Button.setAttribute('aria-label', 'Add memories to your prompt');

      const mem0Icon = document.createElement('img');
      mem0Icon.src = chrome.runtime.getURL('icons/mem0-claude-icon-p.png');
      mem0Icon.style.width = '16px';
      mem0Icon.style.height = '16px';
      mem0Icon.style.borderRadius = '50%';

      const popup = createPopup(buttonContainer, 'top');
      mem0Button.appendChild(mem0Icon);
      mem0Button.addEventListener('click', () => {
        if (memoryEnabled) {
          // Hide the tooltip if it's showing
          const tooltip = document.querySelector('#mem0-tooltip');
          if (tooltip) {
            tooltip.style.display = 'none';
          }

          handleMem0Modal(popup);
        }
      });

      // Create notification dot
      const notificationDot = document.createElement('div');
      notificationDot.id = 'mem0-notification-dot';
      notificationDot.style.cssText = `
        position: absolute;
        top: -3px;
        right: -3px;
        width: 10px;
        height: 10px;
        background-color: rgb(128, 221, 162);
        border-radius: 50%;
        border: 2px solid #1C1C1E;
        display: none;
        z-index: 1001;
        pointer-events: none;
      `;
      mem0Button.appendChild(notificationDot);

      // Add keyframe animation for the dot
      if (!document.getElementById('notification-dot-animation')) {
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
      }

      buttonContainer.appendChild(mem0Button);

      const tooltip = document.createElement('div');
      tooltip.id = 'mem0-tooltip';
      tooltip.textContent = 'Add memories to your prompt';
      tooltip.style.cssText = `
              display: none;
              position: fixed;
              background-color: black;
              color: white;
              padding: 3px 7px;
              border-radius: 6px;
              font-size: 12px;
              z-index: 10000;
              pointer-events: none;
              white-space: nowrap;
              transform: translateX(-50%);
          `;
      document.body.appendChild(tooltip);

      mem0Button.addEventListener('mouseenter', () => {
        // Hide any existing popup first
        const existingMem0Popup = document.querySelector('.mem0-popup[style*="display: block"]');
        if (existingMem0Popup && existingMem0Popup !== popup) {
          existingMem0Popup.style.display = 'none';
        }

        const rect = mem0Button.getBoundingClientRect();
        const buttonCenterX = rect.left + rect.width / 2;

        // Set initial tooltip properties
        tooltip.style.display = 'block';

        // Once displayed, we can get its height and set proper positioning
        const tooltipHeight = (tooltip as HTMLElement).offsetHeight || 24; // Default height if not yet rendered

        tooltip.style.left = `${buttonCenterX}px`;
        tooltip.style.top = `${rect.top - tooltipHeight - 10}px`; // Position 10px above button
      });

      mem0Button.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });

      // Find the parent container to place the button at the same level as input-tools-menu
      const parentContainer =
        inputToolsMenuButton.closest('.relative.flex-1.flex.items-center.gap-2') ||
        inputToolsMenuButton.closest('.relative.flex-1') ||
        ((inputToolsMenuButton.parentNode as HTMLElement)?.parentNode?.parentNode?.parentNode
          ?.parentNode as HTMLElement);

      if (parentContainer) {
        // Find the third position in the container - after the first two divs
        // Looking for the flex-row div to insert before it
        const flexRowDiv = parentContainer.querySelector(
          '.flex.flex-row.items-center.gap-2.min-w-0'
        );

        // Find the tools div that we want to position after
        const toolsDiv = (inputToolsMenuButton.closest('div > div > div > div') as HTMLElement)
          ?.parentNode?.parentNode as HTMLElement;

        // Make sure our button is the third div in the container
        if (flexRowDiv && toolsDiv) {
          // Insert right after the tools div and before the flex-row div
          parentContainer.insertBefore(buttonContainer, flexRowDiv);
        } else {
          // Fallback to just append to the parent
          parentContainer.appendChild(buttonContainer);
        }
      } else {
        // Fallback to original behavior if parent not found
        (inputToolsMenuButton.parentNode as HTMLElement)?.insertBefore(
          buttonContainer,
          inputToolsMenuButton.nextSibling
        );
      }

      // Update notification dot
      try {
        updateNotificationDot();
      } catch {
        // Ignore errors during updateNotificationDot
      }
    } else if (
      window.location.href.includes('claude.ai/new') &&
      screenshotButton &&
      !document.querySelector('#mem0-button')
    ) {
      const buttonContainer = document.createElement('div');
      buttonContainer.style.position = 'relative';
      buttonContainer.style.display = 'inline-block';

      const mem0Button = document.createElement('button');
      mem0Button.id = 'mem0-button';
      mem0Button.className = screenshotButton.className;
      mem0Button.style.marginLeft = '0px';
      mem0Button.setAttribute('aria-label', 'Add memories to your prompt');

      const mem0Icon = document.createElement('img');
      mem0Icon.src = chrome.runtime.getURL('icons/mem0-claude-icon-p.png');
      mem0Icon.style.width = '16px';
      mem0Icon.style.height = '16px';
      mem0Icon.style.borderRadius = '50%';

      const popup = createPopup(buttonContainer, 'right');
      mem0Button.appendChild(mem0Icon);
      mem0Button.addEventListener('click', () => {
        if (memoryEnabled) {
          // Hide the tooltip if it's showing
          const tooltip = document.querySelector('#mem0-tooltip');
          if (tooltip) {
            tooltip.style.display = 'none';
          }

          handleMem0Modal(popup);
        }
      });

      // Create notification dot
      const notificationDot = document.createElement('div');
      notificationDot.id = 'mem0-notification-dot';
      notificationDot.style.cssText = `
        position: absolute;
        top: -3px;
        right: -3px;
        width: 10px;
        height: 10px;
        background-color: rgb(128, 221, 162);
        border-radius: 50%;
        border: 2px solid #1C1C1E;
        display: none;
        z-index: 1001;
        pointer-events: none;
      `;
      mem0Button.appendChild(notificationDot);

      buttonContainer.appendChild(mem0Button);

      const tooltip = document.createElement('div');
      tooltip.id = 'mem0-tooltip';
      tooltip.textContent = 'Add memories to your prompt';
      tooltip.style.cssText = `
              display: none;
              position: fixed;
              background-color: black;
              color: white;
              padding: 3px 7px;
              border-radius: 6px;
              font-size: 12px;
              z-index: 10000;
              pointer-events: none;
              white-space: nowrap;
              transform: translateX(-50%);
          `;
      document.body.appendChild(tooltip);

      mem0Button.addEventListener('mouseenter', () => {
        // Hide any existing popup first
        const existingMem0Popup = document.querySelector('.mem0-popup[style*="display: block"]');
        if (existingMem0Popup && existingMem0Popup !== popup) {
          existingMem0Popup.style.display = 'none';
        }

        const rect = mem0Button.getBoundingClientRect();
        const buttonCenterX = rect.left + rect.width / 2;

        // Set initial tooltip properties
        tooltip.style.display = 'block';

        // Once displayed, we can get its height and set proper positioning
        const tooltipHeight = tooltip.offsetHeight || 24; // Default height if not yet rendered

        tooltip.style.left = `${buttonCenterX}px`;
        tooltip.style.top = `${rect.top - tooltipHeight - 10}px`; // Position 10px above button
      });

      mem0Button.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });

      (screenshotButton.parentNode as HTMLElement)?.insertBefore(
        buttonContainer,
        screenshotButton.nextSibling
      );

      // Update notification dot
      try {
        updateNotificationDot();
      } catch {
        // Ignore errors during updateNotificationDot
      }
    } else if ((sendButton || sendUpButton) && !document.querySelector('#mem0-button')) {
      const targetButton = sendButton || sendUpButton;
      if (!targetButton) {
        return;
      }

      // Find the parent container of the send button
      const buttonParent = targetButton.parentNode;
      if (!buttonParent) {
        return;
      }

      const buttonContainer = document.createElement('div');
      buttonContainer.style.position = 'relative';
      buttonContainer.style.display = 'inline-block';
      buttonContainer.style.marginRight = '12px';

      const mem0Button = document.createElement('button');
      mem0Button.id = 'mem0-button';
      mem0Button.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        padding: 0;
        background: transparent;
        border: none;
        cursor: pointer;
        border-radius: 8px;
        position: relative;
        transition: background-color 0.3s ease;
      `;
      mem0Button.setAttribute('aria-label', 'Add memories to your prompt');

      const mem0Icon = document.createElement('img');
      mem0Icon.src = chrome.runtime.getURL('icons/mem0-claude-icon-p.png');
      mem0Icon.style.width = '20px';
      mem0Icon.style.height = '20px';
      mem0Icon.style.borderRadius = '50%';

      // Create notification dot
      const notificationDot = document.createElement('div');
      notificationDot.id = 'mem0-notification-dot';
      notificationDot.style.cssText = `
        position: absolute;
        top: 0px;
        right: 0px;
        width: 10px;
        height: 10px;
        background-color: rgb(128, 221, 162);
        border-radius: 50%;
        border: 2px solid #1C1C1E;
        display: none;
        z-index: 1001;
        pointer-events: none;
      `;

      const popup = createPopup(buttonContainer, 'top');
      mem0Button.appendChild(mem0Icon);
      mem0Button.appendChild(notificationDot);
      mem0Button.addEventListener('click', () => {
        if (memoryEnabled) {
          // Hide the tooltip if it's showing
          const tooltip = document.querySelector('#mem0-tooltip');
          if (tooltip) {
            tooltip.style.display = 'none';
          }

          handleMem0Modal(popup);
        }
      });

      mem0Button.addEventListener('mouseenter', () => {
        // Hide any existing popup first
        const existingMem0Popup = document.querySelector('.mem0-popup[style*="display: block"]');
        if (existingMem0Popup && existingMem0Popup !== popup) {
          existingMem0Popup.style.display = 'none';
        }

        const rect = mem0Button.getBoundingClientRect();
        const buttonCenterX = rect.left + rect.width / 2;

        // Set initial tooltip properties
        const tooltipEl = document.querySelector('#mem0-tooltip') as HTMLElement;
        if (tooltipEl) {
          tooltipEl.style.display = 'block';
          const tooltipHeight = tooltipEl.offsetHeight || 24;
          tooltipEl.style.left = `${buttonCenterX}px`;
          tooltipEl.style.top = `${rect.top - tooltipHeight - 10}px`;
        }
      });

      mem0Button.addEventListener('mouseleave', () => {
        mem0Button.style.backgroundColor = 'transparent';
        popup.style.display = 'none';
      });

      // Set popover text
      popup.textContent = 'Add memories to your prompt';

      buttonContainer.appendChild(mem0Button);

      // Insert the button before the send button
      if (buttonParent.querySelector('button[aria-label="Send message"]')) {
        buttonParent.insertBefore(
          buttonContainer,
          buttonParent.querySelector('button[aria-label="Send message"]')
        );
      } else {
        buttonParent.insertBefore(buttonContainer, targetButton);
      }

      // Update notification dot
      updateNotificationDot();
    }

    // Send button listeners are now handled in initializeMem0Integration for better reliability

    // Also handle Enter key press for sending messages
    const inputElement =
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea') ||
      document.querySelector('p[data-placeholder="How can I help you today?"]') ||
      document.querySelector('p[data-placeholder="Reply to Claude..."]');

    if (inputElement && !(inputElement as HTMLElement).dataset.mem0KeyListener) {
      (inputElement as HTMLElement).dataset.mem0KeyListener = 'true';
      (inputElement as HTMLElement).addEventListener('keydown', function (event: KeyboardEvent) {
        // Check if Enter was pressed without Shift (standard send behavior)
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          // Don't process for textarea which may want newlines
          if (inputElement.tagName.toLowerCase() !== 'textarea') {
            // Snapshot before send
            const current = getInputValue();
            if (current && current.trim() !== '') {
              lastTyped = current;
            }
            lastSendInitiatedAt = Date.now();
            // Capture and save memory asynchronously
            captureAndStoreMemory(lastTyped);

            // Clear all memories after sending
            setTimeout(() => {
              allMemories = [];
              allMemoriesById.clear();
            }, 100);
          }
        }
      });
      // Keep a live cache during typing to improve reliability
      if (!inputElement.dataset.mem0CacheListener) {
        inputElement.dataset.mem0CacheListener = 'true';
        const updateCache = () => {
          const val = getInputValue();
          if (val && val.trim() !== '') {
            lastTyped = val;
          }
        };
        inputElement.addEventListener('input', updateCache, true);
        inputElement.addEventListener('compositionend', updateCache, true);
      }
    }

    // Update notification dot state
    updateNotificationDot();
  });
}

// Using MemoryItem from src/types/content-scripts.ts

function createMemoryModal(
  memoryItems: MemoryItem[],
  isLoading: boolean = false,
  sourceButtonId: string | null = null
): void {
  // Close existing modal if it exists
  if (memoryModalShown && currentModalOverlay) {
    document.body.removeChild(currentModalOverlay);
  }

  memoryModalShown = true;
  let currentMemoryIndex = 0;

  // Calculate modal dimensions (estimated)
  const modalWidth = 447;
  let modalHeight = 400; // Default height
  let memoriesPerPage = 3; // Default number of memories per page

  let topPosition: number = 0;
  let leftPosition: number = 0;

  // Use stored position if available and modal is being recreated after loading
  if (modalPosition && currentModalOverlay) {
    topPosition = modalPosition.top;
    leftPosition = modalPosition.left;
  } else {
    // Different positioning based on which button triggered the modal
    if (sourceButtonId === 'mem0-icon-button') {
      // Position relative to the mem0-icon-button
      const iconButton = document.querySelector('#mem0-icon-button') as HTMLElement | null;
      if (iconButton) {
        const buttonRect = iconButton.getBoundingClientRect();

        // Determine if there's enough space above the button
        const spaceAbove = buttonRect.top;
        const viewportHeight = window.innerHeight;

        // Calculate position - for icon button, prefer to show ABOVE
        leftPosition = buttonRect.left - modalWidth + buttonRect.width;

        // Make sure modal doesn't go off-screen to the left
        leftPosition = Math.max(leftPosition, 10);

        // For icon button, show above if enough space, otherwise below
        if (spaceAbove >= modalHeight + 10) {
          // Place above
          topPosition = buttonRect.top - modalHeight - 10;
          memoriesPerPage = 3; // Show 3 memories when above
        } else {
          // Not enough space above, place below
          topPosition = buttonRect.bottom + 10;

          // Check if it's in the lower half of the screen
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
      // Default positioning relative to the Mem0 button
      const mem0Button = document.querySelector('#mem0-button') as HTMLElement | null;
      if (mem0Button) {
        const buttonRect = mem0Button.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const spaceAbove = buttonRect.top;

        // Position to the right of the button by default
        leftPosition = buttonRect.left;

        // Decide whether to place modal above or below based on available space
        if (spaceAbove >= modalHeight + 10) {
          // Place above
          topPosition = buttonRect.top - modalHeight - 10;
          memoriesPerPage = 3; // Show 3 memories when placed above
        } else {
          // Place below
          topPosition = buttonRect.bottom + 10;

          // Check if it's in the lower half of the screen
          if (buttonRect.bottom > viewportHeight / 2) {
            modalHeight = 300; // Reduced height
            memoriesPerPage = 2; // Show only 2 memories
          }
        }

        // Make sure modal doesn't go off-screen to the right
        leftPosition = Math.min(leftPosition, window.innerWidth - modalWidth - 10);
      } else {
        // Fallback to input-based positioning
        positionRelativeToInput();
      }
    }

    // Store the initial position
    modalPosition = { top: topPosition, left: leftPosition };
  }

  // Helper function to position modal relative to input field
  function positionRelativeToInput() {
    const inputElement =
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea') ||
      document.querySelector('p[data-placeholder="How can I help you today?"]') ||
      document.querySelector('p[data-placeholder="Reply to Claude..."]');

    if (!inputElement) {
      return;
    }

    // Get the position and dimensions of the input field
    const inputRect = inputElement.getBoundingClientRect();

    // Determine if there's enough space below the input field
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - inputRect.bottom;
    const spaceAbove = inputRect.top;

    // Position the modal aligned to the right of the input
    leftPosition = Math.max(inputRect.right - 20 - modalWidth, 10); // 20px offset from right edge

    // Decide whether to place modal above or below based on available space
    if (spaceAbove >= modalHeight + 10) {
      // Place above the input
      topPosition = inputRect.top - modalHeight - 10;
      memoriesPerPage = 3; // Show 3 memories when placed above
    } else if (spaceBelow >= modalHeight) {
      // Place below the input
      topPosition = inputRect.bottom + 10;

      // Check if it's in the lower half of the screen
      if (inputRect.bottom > viewportHeight / 2) {
        modalHeight = 300; // Reduced height
        memoriesPerPage = 2; // Show only 2 memories
      }
    } else {
      // Not enough space in either direction, place above with adjusted height
      topPosition = inputRect.top - 300 - 10; // Use reduced height
      modalHeight = 300;
      memoriesPerPage = 2; // Show only 2 memories
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
  modalOverlay.addEventListener('click', event => {
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

  // Create header left section with just the logo
  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
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

  // Add "OpenMemory" title
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
  </svg>`;
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
  } else if (memoryItems.length === 0) {
    memoriesCounter.textContent = `No Relevant Memories`;
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
        height: 72px;
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

  // Function to expand memory
  function expandMemory(
    memoryContainer: HTMLDivElement,
    memoryText: HTMLDivElement,
    contentWrapper: HTMLDivElement,
    removeButton: HTMLButtonElement,
    isExpanded: { value: boolean }
  ) {
    if (currentlyExpandedMemory && currentlyExpandedMemory !== memoryContainer) {
      currentlyExpandedMemory.dispatchEvent(new Event('collapse'));
    }

    isExpanded.value = true;
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
    memoryContainer: HTMLDivElement,
    memoryText: HTMLDivElement,
    contentWrapper: HTMLDivElement,
    removeButton: HTMLButtonElement,
    isExpanded: { value: boolean }
  ) {
    isExpanded.value = false;
    memoryText.style.webkitLineClamp = '2';
    memoryText.style.height = '42px';
    contentWrapper.style.overflowY = 'visible';
    memoryContainer.style.backgroundColor = '#27272A';
    memoryContainer.style.maxHeight = '72px';
    memoryContainer.style.overflow = 'hidden';
    removeButton.style.display = 'none';
    currentlyExpandedMemory = null;
  }

  // Function to show memories with adjusted count based on modal position
  function showMemories() {
    memoriesContent.innerHTML = '';

    if (isLoading) {
      createSkeletonItems();
      return;
    }

    if (memoryItems.length === 0) {
      showEmptyState();
      updateNavigationState(0, 0);
      return;
    }

    // Reset Add to Prompt button state
    if (addToPromptBtn) {
      addToPromptBtn.disabled = false;
      addToPromptBtn.style.opacity = '1';
      addToPromptBtn.style.cursor = 'pointer';
    }

    // Use the dynamically set memoriesPerPage value
    const memoriesToShow = Math.min(memoriesPerPage, memoryItems.length);

    // Calculate total pages and current page
    const totalPages = Math.ceil(memoryItems.length / memoriesToShow);
    const currentPage = Math.floor(currentMemoryIndex / memoriesToShow) + 1;

    // Update navigation buttons state
    updateNavigationState(currentPage, totalPages);

    for (let i = 0; i < memoriesToShow; i++) {
      const memoryIndex = currentMemoryIndex + i;
      if (memoryIndex >= memoryItems.length) {
        break;
      } // Stop if we've reached the end

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
        min-height: 72px; 
        max-height: 72px; 
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
        height: 42px; /* Height for 2 lines of text */
      `;
      memoryText.textContent = memory.text || '';

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
          provider: 'claude',
          source: 'OPENMEMORY_CHROME_EXTENSION',
          browser: getBrowser(),
          injected_all: false,
          memory_id: memory.id,
        });

        // Mark this memory as added
        allMemoriesById.add(String(memory.id));

        // Add this memory to existing ones instead of replacing
        allMemories.push(String(memory.text || ''));

        // Update the input with all memories
        updateInputWithMemories();

        // Remove this memory from the list
        const index = memoryItems.findIndex((m: MemoryItem) => m.id === memory.id);
        if (index !== -1) {
          memoryItems.splice(index, 1);

          // Recalculate pagination after removing an item
          // If we're on a page that's now empty, go to previous page
          if (currentMemoryIndex > 0 && currentMemoryIndex >= memoryItems.length) {
            currentMemoryIndex = Math.max(0, currentMemoryIndex - memoriesPerPage);
          }

          memoriesCounter.textContent = `${memoryItems.length} Relevant Memories`;
          showMemories();
        }

        // Don't close the modal, allow adding more memories
      });

      // Menu button
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

      // Track expanded state using object to maintain reference
      const isExpanded = { value: false };

      // Create remove button (hidden by default)
      const removeButton = document.createElement('button');
      removeButton.style.cssText = `
        display: none;
        align-items: center;
        gap: 6px;
        background:rgb(66, 66, 69);
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

      memoryContainer.addEventListener('collapse', () => {
        collapseMemory(memoryContainer, memoryText, contentWrapper, removeButton, isExpanded);
      });

      menuButton.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        if (isExpanded.value) {
          collapseMemory(memoryContainer, memoryText, contentWrapper, removeButton, isExpanded);
        } else {
          expandMemory(memoryContainer, memoryText, contentWrapper, removeButton, isExpanded);
        }
      });

      // Add click handler for remove button
      removeButton.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        // Remove from memoryItems
        const index = memoryItems.findIndex((m: MemoryItem) => m.id === memory.id);
        if (index !== -1) {
          memoryItems.splice(index, 1);

          // Recalculate pagination after removing an item

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
        memoryContainer.style.backgroundColor = isExpanded.value ? '#18181B' : '#323232';
      });
      memoryContainer.addEventListener('mouseleave', () => {
        memoryContainer.style.backgroundColor = isExpanded.value ? '#1C1C1E' : '#27272A';
      });
    }

    // If after filtering for already added memories, there are no items to show,
    // check if we need to go to previous page
    if (memoriesContent.children.length === 0 && memoryItems.length > 0) {
      if (currentMemoryIndex > 0) {
        currentMemoryIndex = Math.max(0, currentMemoryIndex - memoriesPerPage);
        showMemories();
      } else {
        updateNavigationState(0, 0);
        showEmptyState();
      }
    }
  }

  // Function to show empty state
  function showEmptyState() {
    memoriesContent.innerHTML = '';
    memoriesCounter.textContent = 'No Relevant Memories';

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
    memoriesContent.appendChild(emptyContainer);

    // Disable the Add to Prompt button when there are no memories
    if (addToPromptBtn) {
      addToPromptBtn.disabled = true;
      addToPromptBtn.style.opacity = '0.5';
      addToPromptBtn.style.cursor = 'not-allowed';
    }
  }

  // Update navigation button states
  function updateNavigationState(currentPage: number, totalPages: number): void {
    if (memoryItems.length === 0 || totalPages === 0) {
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

  // Add navigation button handlers
  prevButton.addEventListener('click', () => {
    if (currentMemoryIndex >= memoriesPerPage) {
      currentMemoryIndex = Math.max(0, currentMemoryIndex - memoriesPerPage);
      showMemories();
    }
  });

  nextButton.addEventListener('click', () => {
    if (currentMemoryIndex + memoriesPerPage < memoryItems.length) {
      currentMemoryIndex = currentMemoryIndex + memoriesPerPage;
      showMemories();
    }
  });

  // Add hover effects
  [prevButton, nextButton].forEach(button => {
    button.addEventListener('mouseenter', () => {
      if (!button.disabled) {
        button.style.backgroundColor = '#323232';
      }
    });
    button.addEventListener('mouseleave', () => {
      if (!button.disabled) {
        button.style.backgroundColor = '#27272A';
      }
    });
  });

  // Assemble modal
  headerLeft.appendChild(logoImg);
  headerLeft.appendChild(title);
  headerRight.appendChild(addToPromptBtn);
  headerRight.appendChild(settingsBtn);

  modalHeader.appendChild(headerLeft);
  modalHeader.appendChild(headerRight);

  // Add draggable functionality to the modal header
  modalHeader.addEventListener('mousedown', (e: MouseEvent) => {
    // Don't start dragging if clicking on a button or interactive element
    const target = e.target as HTMLElement;
    if (!target) {
      return;
    }
    if (
      target.tagName === 'BUTTON' ||
      target.closest('button') ||
      target.tagName === 'SVG' ||
      target.closest('svg')
    ) {
      return;
    }

    isDragging = true;
    const modalRect = modalContainer.getBoundingClientRect();
    dragOffset.x = e.clientX - modalRect.left;
    dragOffset.y = e.clientY - modalRect.top;

    // Prevent default to avoid text selection
    e.preventDefault();

    // Add styles to indicate dragging
    modalContainer.style.transition = 'none';
    document.body.style.userSelect = 'none';
    modalHeader.style.cursor = 'grabbing';
  });

  // Add global mouse move and mouse up handlers
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) {
      return;
    }

    const newLeft = e.clientX - dragOffset.x;
    const newTop = e.clientY - dragOffset.y;

    // Constrain to viewport bounds
    const maxLeft = window.innerWidth - modalWidth;
    const maxTop = window.innerHeight - modalHeight;

    const constrainedLeft = Math.max(0, Math.min(newLeft, maxLeft));
    const constrainedTop = Math.max(0, Math.min(newTop, maxTop));

    modalContainer.style.left = `${constrainedLeft}px`;
    modalContainer.style.top = `${constrainedTop}px`;

    // Update stored position
    modalPosition = { top: constrainedTop, left: constrainedLeft };
  };

  const handleMouseUp = () => {
    if (!isDragging) {
      return;
    }

    isDragging = false;

    // Restore styles
    modalContainer.style.transition = '';
    document.body.style.userSelect = '';
    modalHeader.style.cursor = 'move';
  };

  // Add event listeners to document for global mouse events
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  // Store cleanup function for later use
  (modalOverlay as ExtendedHTMLElement)._cleanupDragEvents = () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    isDragging = false;
  };

  contentSection.appendChild(memoriesCounter);
  contentSection.appendChild(memoriesContent);

  navigationSection.appendChild(prevButton);
  navigationSection.appendChild(nextButton);

  modalContainer.appendChild(modalHeader);
  modalContainer.appendChild(contentSection);
  modalContainer.appendChild(navigationSection);

  modalOverlay.appendChild(modalContainer);

  // Append to body
  document.body.appendChild(modalOverlay);

  // Show initial memories or loading state
  if (isLoading) {
    createSkeletonItems();
  } else if (memoryItems.length === 0) {
    showEmptyState();
  } else {
    showMemories();
  }

  // Function to close the modal
  function closeModal(): void {
    if (currentModalOverlay && document.body.contains(currentModalOverlay)) {
      // Clean up drag event listeners
      const cleanupFn = (currentModalOverlay as ExtendedHTMLElement)._cleanupDragEvents;
      if (cleanupFn) {
        cleanupFn();
      }
      document.body.removeChild(currentModalOverlay);
    }
    currentModalOverlay = null;
    memoryModalShown = false;
    // Reset modal position when closing
    modalPosition = null;
    isDragging = false;
  }

  // Update Add to Prompt button click handler
  addToPromptBtn.addEventListener('click', () => {
    // Only add memories that are not already added
    const newMemories = memoryItems
      .filter(memory => !allMemoriesById.has(String(memory.id)) && !memory.removed)
      .map(memory => {
        allMemoriesById.add(String(memory.id));
        return String(memory.text || '');
      });

    sendExtensionEvent('memory_injection', {
      provider: 'claude',
      source: 'OPENMEMORY_CHROME_EXTENSION',
      browser: getBrowser(),
      injected_all: true,
      memory_count: newMemories.length,
    });

    // Add new memories to allMemories (don't replace existing ones)
    if (newMemories.length > 0) {
      // Add new memories to the existing array
      allMemories = [...allMemories, ...newMemories];

      // Update the input with all memories
      updateInputWithMemories();
    }

    // Close the modal
    closeModal();

    // Remove all added memories from the memoryItems list
    for (let i = memoryItems.length - 1; i >= 0; i--) {
      if (allMemoriesById.has(String(memoryItems[i]?.id))) {
        memoryItems.splice(i, 1);
      }
    }
  });
}

// Shared function to update the input field with all collected memories
function updateInputWithMemories() {
  // Find the input element (prioritizing the ProseMirror div with contenteditable="true")
  let inputElement = document.querySelector('div[contenteditable="true"].ProseMirror');

  // If ProseMirror not found, try other input elements
  if (!inputElement) {
    inputElement =
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea') ||
      document.querySelector('p[data-placeholder="How can I help you today?"]') ||
      document.querySelector('p[data-placeholder="Reply to Claude..."]');
  }

  if (inputElement && allMemories.length > 0) {
    // Define the header text
    const headerText = OPENMEMORY_PROMPTS.memory_header_text;

    // Check if ProseMirror editor
    if (inputElement.classList.contains('ProseMirror')) {
      // First check if the header already exists
      const headerExists = Array.from(inputElement.querySelectorAll('p strong')).some(el =>
        (el.textContent || '').includes('Here is some of my memories')
      );

      if (headerExists) {
        // Get all existing memory paragraphs
        const paragraphs = Array.from(inputElement.querySelectorAll('p')) as HTMLElement[];
        let headerIndex = -1;
        const existingMemories = [];

        // Find the index of the header paragraph
        for (let i = 0; i < paragraphs.length; i++) {
          const strongEl = paragraphs[i]?.querySelector('strong');
          if (strongEl && (strongEl.textContent || '').includes('Here is some of my memories')) {
            headerIndex = i;
            break;
          }
        }

        // Collect all existing memories after the header
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

          // Keep everything up to and including the header paragraph
          const newHTML = Array.from(paragraphs)
            .slice(0, headerIndex + 1)
            .map(p => p.outerHTML)
            .join('');

          // Combine existing and new memories, avoiding duplicates
          const combinedMemories = [...existingMemories];

          // Add new memories if they don't already exist
          allMemories.forEach(mem => {
            if (!combinedMemories.includes(mem)) {
              combinedMemories.push(mem);
            }
          });

          // Add the memories after the header
          const memoriesHTML = combinedMemories.map(mem => `<p>- ${mem}</p>`).join('');

          // Set the new HTML content
          inputElement.innerHTML = newHTML + memoriesHTML;
        }
      } else {
        // Header doesn't exist, get the content without any existing memory wrappers
        const baseContent = getContentWithoutMemories(undefined);

        // Create the memory section
        let memoriesContent = `<p><strong>${headerText}</strong></p>`;

        // Add all memories to the content with proper paragraph tags
        memoriesContent += allMemories.map(mem => `<p>- ${mem}</p>`).join('');

        // If empty, replace the entire content
        if (
          !baseContent ||
          baseContent.trim() === '' ||
          (inputElement.querySelectorAll('p').length === 1 &&
            inputElement.querySelector('p.is-empty') !== null)
        ) {
          inputElement.innerHTML = memoriesContent;
        } else {
          // Otherwise append after a line break
          inputElement.innerHTML = `${baseContent}<p><br></p>${memoriesContent}`;
        }
      }

      // Dispatch proper events for ProseMirror
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
      });
      inputElement.dispatchEvent(inputEvent);

      // Also dispatch a change event
      const changeEvent = new Event('change', { bubbles: true });
      inputElement.dispatchEvent(changeEvent);
    } else if (inputElement.tagName.toLowerCase() === 'div') {
      // For normal contenteditable divs
      // Check if the header already exists
      if (inputElement.innerHTML.includes(headerText)) {
        // Find the header position and extract existing memories
        const htmlParts = inputElement.innerHTML.split(headerText);
        if (htmlParts.length > 1) {
          const beforeHeader = htmlParts[0];
          const afterHeader = htmlParts[1];

          // Extract existing memories from the content after the header
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = afterHeader || '';
          const existingMemories: string[] = [];

          // Find all paragraphs that start with a dash
          Array.from(tempDiv.querySelectorAll('p')).forEach(p => {
            const text = (p.textContent || '').trim();
            if (text.startsWith('-')) {
              existingMemories.push(text.substring(1).trim());
            }
          });

          // Combine existing and new memories, avoiding duplicates
          const combinedMemories = [...existingMemories];

          // Add new memories if they don't already exist
          allMemories.forEach(mem => {
            if (!combinedMemories.includes(mem)) {
              combinedMemories.push(mem);
            }
          });

          // Create HTML with header and all memories
          let newHTML = beforeHeader + `<p><strong>${headerText}</strong></p>`;
          combinedMemories.forEach(mem => {
            newHTML += `<p>- ${mem}</p>`;
          });

          inputElement.innerHTML = newHTML;
        }
      } else {
        // Header doesn't exist
        const baseContent = getContentWithoutMemories(undefined);
        let memoriesContent = `<p><strong>${headerText}</strong></p>`;

        allMemories.forEach(mem => {
          memoriesContent += `<p>- ${mem}</p>`;
        });

        inputElement.innerHTML = `${baseContent}${baseContent ? '<p><br></p>' : ''}${memoriesContent}`;
      }

      // Dispatch input event
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (
      inputElement.tagName.toLowerCase() === 'p' &&
      (inputElement.getAttribute('data-placeholder') === 'How can I help you today?' ||
        inputElement.getAttribute('data-placeholder') === 'Reply to Claude...')
    ) {
      // For p element placeholders
      // Check if the header already exists
      if ((inputElement.textContent || '').includes(headerText)) {
        // Find the header position and extract existing memories
        const textParts = (inputElement.textContent || '').split(headerText);
        if (textParts.length > 1) {
          const beforeHeader = textParts[0];
          const afterHeader = textParts[1];

          // Extract existing memories
          const existingMemories: string[] = [];
          const memoryLines = (afterHeader || '').split('\n');

          memoryLines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('-')) {
              existingMemories.push(trimmed.substring(1).trim());
            }
          });

          // Combine existing and new memories, avoiding duplicates
          const combinedMemories = [...existingMemories];

          // Add new memories if they don't already exist
          allMemories.forEach(mem => {
            if (!combinedMemories.includes(mem)) {
              combinedMemories.push(mem);
            }
          });

          // Create text with header and all memories
          const newText =
            beforeHeader + headerText + '\n\n' + combinedMemories.map(mem => `- ${mem}`).join('\n');

          inputElement.textContent = newText;
        }
      } else {
        // Header doesn't exist
        const baseContent = getContentWithoutMemories(undefined);

        inputElement.textContent = `${baseContent}${baseContent ? '\n\n' : ''}${headerText}\n\n${allMemories.map(mem => `- ${mem}`).join('\n')}`;
      }

      // Dispatch various events
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('focus', { bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // For textarea
      // Check if the header already exists
      if (((inputElement as HTMLTextAreaElement).value || '').includes(headerText)) {
        // Find the header position and extract existing memories
        const valueParts = ((inputElement as HTMLTextAreaElement).value || '').split(headerText);
        if (valueParts.length > 1) {
          const beforeHeader = valueParts[0];
          const afterHeader = valueParts[1];

          // Extract existing memories
          const existingMemories: string[] = [];
          const memoryLines = (afterHeader || '').split('\n');

          memoryLines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('-')) {
              existingMemories.push(trimmed.substring(1).trim());
            }
          });

          // Combine existing and new memories, avoiding duplicates
          const combinedMemories = [...existingMemories];

          // Add new memories if they don't already exist
          allMemories.forEach(mem => {
            if (!combinedMemories.includes(mem)) {
              combinedMemories.push(mem);
            }
          });

          // Create text with header and all memories
          const newValue =
            beforeHeader + headerText + '\n\n' + combinedMemories.map(mem => `- ${mem}`).join('\n');

          inputElement.value = newValue;
        }
      } else {
        // Header doesn't exist
        const baseContent = getContentWithoutMemories(undefined);

        (inputElement as HTMLTextAreaElement).value =
          `${baseContent}${baseContent ? '\n\n' : ''}${headerText}\n\n${allMemories.map(mem => `- ${mem}`).join('\n')}`;
      }

      // Dispatch input event
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Focus the input element to ensure the user can continue typing
    (inputElement as HTMLElement).focus();
  }
}

// Function to get the content without any memory wrappers
function getContentWithoutMemories(providedMessage: string | undefined) {
  // Find the input element (prioritizing the ProseMirror div with contenteditable="true")
  let inputElement = document.querySelector('div[contenteditable="true"].ProseMirror');

  // If ProseMirror not found, try other input elements
  if (!inputElement) {
    inputElement =
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea') ||
      document.querySelector('p[data-placeholder="How can I help you today?"]') ||
      document.querySelector('p[data-placeholder="Reply to Claude..."]');
  }

  // If a message is provided, operate on it; otherwise read from DOM
  let content = '';

  if (typeof providedMessage === 'string') {
    content = providedMessage;
  } else {
    if (!inputElement) {
      return '';
    }
    if (inputElement.classList.contains('ProseMirror')) {
      // For ProseMirror, get the innerHTML for proper structure handling
      content = inputElement.innerHTML;
    } else if (inputElement.tagName.toLowerCase() === 'div') {
      // For normal contenteditable divs
      content = inputElement.innerHTML;
    } else if (
      inputElement.tagName.toLowerCase() === 'p' &&
      (inputElement.getAttribute('data-placeholder') === 'How can I help you today?' ||
        inputElement.getAttribute('data-placeholder') === 'Reply to Claude...')
    ) {
      // For p element placeholders
      content = inputElement.innerHTML || inputElement.textContent || '';
    } else {
      // For textarea
      content = (inputElement as HTMLTextAreaElement).value || '';
    }
  }

  // Remove any memory headers and content
  // Match both HTML and plain text variants

  // HTML variant
  try {
    const MEM0_HTML = OPENMEMORY_PROMPTS.memory_header_html_regex;
    const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
    content = content.replace(MEM0_HTML, '');
    content = content.replace(MEM0_PLAIN, '');
  } catch {
    // Ignore errors when processing memory content
  }

  // Also clean up any empty paragraphs at the end
  content = content.replace(/<p><br><\/p>$/g, '');
  content = content.replace(
    /<p class="is-empty"><br class="ProseMirror-trailingBreak"><\/p>$/g,
    ''
  );

  return content.trim();
}

// New function to handle the memory modal
async function handleMem0Modal(
  popup: HTMLElement | null,
  clickSendButton: boolean = false,
  sourceButtonId: string | null = null
): Promise<void> {
  if (isProcessingMem0) {
    return;
  }

  // First check if memory is enabled
  const enabled = await getMemoryEnabledState();
  if (enabled === false) {
    return; // Don't show modal or login popup if memory is disabled
  }

  isProcessingMem0 = true;

  // Set loading state for button
  setButtonLoadingState(true);

  // Hide any tooltip that might be showing
  const tooltip = document.querySelector('#mem0-tooltip');
  if (tooltip) {
    tooltip.style.display = 'none';
  }

  try {
    const data = await new Promise<StorageData>(resolve => {
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
          resolve(items);
        }
      );
    });

    const apiKey = data.apiKey;
    const userId = data.userId || data.user_id || 'chrome-extension-user';
    const accessToken = data.access_token;

    if (!apiKey && !accessToken) {
      // Show login popup instead of error message
      isProcessingMem0 = false;
      setButtonLoadingState(false);

      showLoginPopup();
      return;
    }

    let message = getInputValue();

    if (!message || message.trim() === '') {
      if (popup) {
        // Hide any existing tooltip first
        const tooltip = document.querySelector('#mem0-tooltip');
        if (tooltip) {
          tooltip.style.display = 'none';
        }

        showPopup(popup, 'Please enter some text first');
      }

      isProcessingMem0 = false;
      setButtonLoadingState(false);
      return;
    }

    // Now we can show the loading modal since we have text input
    createMemoryModal([], true, sourceButtonId);

    // Clean the message by removing any existing memory wrappers
    message = getContentWithoutMemories(undefined);
    // Strip HTML tags to ensure clean text for search (fix for <p> tag issue)
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = message;
    message = tempDiv.textContent || tempDiv.innerText || message;
    message = message.trim();

    sendExtensionEvent('modal_clicked', {
      provider: 'claude',
      source: 'OPENMEMORY_CHROME_EXTENSION',
      browser: getBrowser(),
    });

    const authHeader = accessToken ? `Bearer ${accessToken}` : `Token ${apiKey}`;

    const messages = getConversationContext(false); // Use sliding window context
    messages.push({ role: MessageRole.User, content: message });

    // If clickSendButton is true, click the send button
    if (clickSendButton) {
      const sendButton =
        (document.querySelector('button[aria-label="Send Message"]') as HTMLElement) ||
        (document.querySelector('button[aria-label="Send message"]') as HTMLElement);

      if (sendButton) {
        setTimeout(() => {
          (sendButton as HTMLElement).click();
        }, 100);
      }
    }

    const optionalParams: OptionalApiParams = {};
    if (data.selected_org) {
      optionalParams.org_id = data.selected_org;
    }
    if (data.selected_project) {
      optionalParams.project_id = data.selected_project;
    }

    currentModalSourceButtonId = sourceButtonId;
    claudeSearch.runImmediate(message);

    // New add memory API call (non-blocking)
    fetch('https://api.mem0.ai/v1/memories/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        messages: messages,
        user_id: userId,
        infer: true,
        metadata: {
          provider: 'Claude',
        },
        source: 'OPENMEMORY_CHROME_EXTENSION',
        ...optionalParams,
      }),
    })
      .then(response => {
        if (!response.ok) {
          // Silent failure for background memory addition
        }
      })
      .catch(() => {
        // Silent failure for background memory addition
      });
  } catch {
    if (popup) {
      showPopup(popup, 'Failed to send message to Mem0');
    }
  } finally {
    isProcessingMem0 = false;
    setButtonLoadingState(false);
  }
}

function setButtonLoadingState(isLoading: boolean): void {
  const mem0Button = document.querySelector('#mem0-button');
  if (mem0Button) {
    if (isLoading) {
      (mem0Button as HTMLButtonElement).disabled = true;
      document.body.style.cursor = 'wait';
      (mem0Button as HTMLButtonElement).style.cursor = 'wait';
      (mem0Button as HTMLButtonElement).style.opacity = '0.7';
    } else {
      (mem0Button as HTMLButtonElement).disabled = false;
      document.body.style.cursor = 'default';
      (mem0Button as HTMLButtonElement).style.cursor = 'pointer';
      (mem0Button as HTMLButtonElement).style.opacity = '1';
    }
  }
}

function showPopup(popup: HTMLElement, message: string): void {
  // First hide all tooltips and popups
  const tooltip = document.querySelector('#mem0-tooltip');
  if (tooltip) {
    tooltip.style.display = 'none';
  }

  // Also hide any other mem0-popup that might be visible
  const visiblePopups = document.querySelectorAll('.mem0-popup[style*="display: block"]');
  visiblePopups.forEach(p => {
    if (p !== popup) {
      p.style.display = 'none';
    }
  });

  // Create and add the (i) icon
  const infoIcon = document.createElement('span');
  infoIcon.textContent = 'ⓘ ';
  infoIcon.style.marginRight = '3px';

  popup.innerHTML = '';
  popup.appendChild(infoIcon);
  popup.appendChild(document.createTextNode(message));

  popup.style.display = 'block';
  setTimeout(() => {
    popup.style.display = 'none';
  }, 2000);
}

function getInputValue(): string | null {
  const inputElement =
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector('textarea') ||
    document.querySelector('p[data-placeholder="How can I help you today?"]') ||
    document.querySelector('p[data-placeholder="Reply to Claude..."]');

  if (!inputElement) {
    return null;
  }

  // For the p element placeholders specifically
  if (
    inputElement.tagName.toLowerCase() === 'p' &&
    (inputElement.getAttribute('data-placeholder') === 'How can I help you today?' ||
      inputElement.getAttribute('data-placeholder') === 'Reply to Claude...')
  ) {
    return inputElement.textContent || '';
  }

  return inputElement.textContent || (inputElement as HTMLTextAreaElement)?.value || null;
}

let claudeBackgroundSearchHandler: (() => void) | null = null;

function hookClaudeBackgroundSearchTyping() {
  const inputElement =
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector('textarea') ||
    document.querySelector('p[data-placeholder="How can I help you today?"]') ||
    document.querySelector('p[data-placeholder="Reply to Claude..."]');
  if (!inputElement) {
    return;
  }

  if (!claudeBackgroundSearchHandler) {
    claudeBackgroundSearchHandler = function () {
      let text = getInputValue() || '';
      try {
        const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
        text = text.replace(MEM0_PLAIN, '').trim();
      } catch {
        // Ignore errors during updateNotificationDot
      }
      claudeSearch.setText(text);
    };
  }
  inputElement.addEventListener('input', claudeBackgroundSearchHandler);
  inputElement.addEventListener('keyup', claudeBackgroundSearchHandler);
}

// Auto-inject support: simple debounce and config
async function updateMemoryEnabled() {
  memoryEnabled = Boolean(await getMemoryEnabledState());

  // If memory is disabled, remove the button completely
  if (memoryEnabled === false) {
    removeMemButton();
  } else {
    // If memory is enabled, ensure the button is added
    addMem0Button();
  }
}

function initializeMem0Integration(): void {
  updateMemoryEnabled();
  addMem0Button();

  // Prime the cache so the very first send is captured
  const _initVal = getInputValue();
  if (_initVal && _initVal.trim()) {
    lastTyped = _initVal;
  }

  // Ensure send button listeners are attached early and repeatedly
  const ensureSendButtonListeners = () => {
    const allSendButtons = [
      document.querySelector('button[aria-label="Send Message"]'),
      document.querySelector('button[aria-label="Send message"]'),
    ].filter(Boolean);

    allSendButtons.forEach(sendBtn => {
      if (sendBtn && !sendBtn.dataset.mem0Listener) {
        sendBtn.dataset.mem0Listener = 'true';

        // Snapshot current input as early as possible (before Claude clears it)
        sendBtn.addEventListener(
          'pointerdown',
          function () {
            const current = getInputValue();
            if (current && current.trim() !== '') {
              lastTyped = current;
            }
            lastSendInitiatedAt = Date.now();
          },
          true
        );

        // Use capture-phase click so we run before Claude's handler
        sendBtn.addEventListener(
          'click',
          function () {
            // Capture and save memory with snapshot fallback
            captureAndStoreMemory(lastTyped);

            // Clear all memories after sending
            setTimeout(() => {
              allMemories = [];
              allMemoriesById.clear();
            }, 100);
          },
          true
        );
      }
    });
  };

  // Attach listeners immediately
  ensureSendButtonListeners();

  // Also attach them repeatedly during early page load
  const earlyAttachInterval = setInterval(() => {
    ensureSendButtonListeners();
  }, 100);

  // Stop the aggressive checking after page is more stable
  setTimeout(() => {
    clearInterval(earlyAttachInterval);
  }, 5000);

  // Refresh cache whenever the editor gains focus
  if (!(document as ExtendedDocument).__mem0FocusPrimed) {
    (document as ExtendedDocument).__mem0FocusPrimed = true;
    document.addEventListener(
      'focusin',
      e => {
        const target = e.target as Element | null;
        const el =
          target &&
          (target as ExtendedElement).closest &&
          (target as ExtendedElement).closest(
            'div[contenteditable="true"], textarea, p[data-placeholder="How can I help you today?"], p[data-placeholder="Reply to Claude..."]'
          );
        if (el) {
          const v = getInputValue();
          if (v && v.trim()) {
            lastTyped = v;
          }
        }
      },
      true
    );
  }

  document.addEventListener('keydown', function (event) {
    if (event.ctrlKey && event.key === 'm') {
      event.preventDefault();
      if (memoryEnabled) {
        const popup = document.querySelector('.mem0-popup');
        if (popup) {
          (async () => {
            await handleMem0Modal(popup as HTMLElement, false);
          })();
        } else {
          // If no popup is available, use the mem0-icon-button as source
          (async () => {
            await handleMem0Modal(null, false, 'mem0-icon-button');
          })();
        }
      }
    }
  });

  // Global early keydown capture for Enter to snapshot the very first send
  if (!(document as ExtendedDocument).__mem0EnterCapture) {
    (document as ExtendedDocument).__mem0EnterCapture = true;
    document.addEventListener(
      'keydown',
      e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          const v = getInputValue();
          if (v && v.trim()) {
            lastTyped = v;
            lastSendInitiatedAt = Date.now();
          }
        }
      },
      true
    );
  }

  // Global submit capture to catch earliest send even if buttons/forms change
  if (!(document as ExtendedDocument).__mem0SubmitCapture) {
    (document as ExtendedDocument).__mem0SubmitCapture = true;
    document.addEventListener(
      'submit',
      () => {
        const v = getInputValue();
        if (v && v.trim()) {
          lastTyped = v;
        }
        lastSendInitiatedAt = Date.now();
        captureAndStoreMemory(lastTyped);
      },
      true
    );
  }

  // Observer for main structure changes
  observer = new MutationObserver(() => {
    // Use debounce to avoid excessive calls to addMem0Button
    if (debounceTimer) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      // Check memory enabled state before adding button
      getMemoryEnabledState().then(enabled => {
        if (enabled) {
          addMem0Button();
          updateNotificationDot();
          hookClaudeBackgroundSearchTyping();
        } else {
          removeMemButton();
        }
      });
    }, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Add an additional observer specifically for the input elements
  const inputObserver = new MutationObserver(() => {
    // Check if memory is enabled before adding button
    getMemoryEnabledState().then(enabled => {
      if (enabled) {
        // Check if we need to add the icon button
        if (!document.querySelector('#mem0-icon-button')) {
          addMem0Button();
        }

        // Update notification dot on input changes
        updateNotificationDot();
        hookClaudeBackgroundSearchTyping();
      } else {
        removeMemButton();
      }
    });
  });

  // Find the input element and observe it
  function observeInput() {
    const inputElement =
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea') ||
      document.querySelector('p[data-placeholder="How can I help you today?"]') ||
      document.querySelector('p[data-placeholder="Reply to Claude..."]');

    if (inputElement) {
      inputObserver.observe(inputElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    } else {
      // If no input element found, try again later
      setTimeout(observeInput, 1000);
    }
  }

  observeInput();

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.memory_enabled) {
      updateMemoryEnabled();
    }
  });

  // Recheck for elements after page loads
  window.addEventListener('load', () => {
    getMemoryEnabledState().then(enabled => {
      if (enabled) {
        addMem0Button();
        updateNotificationDot();
        hookClaudeBackgroundSearchTyping();
      } else {
        removeMemButton();
      }
    });
  });

  // Also check periodically
  setInterval(() => {
    getMemoryEnabledState().then(enabled => {
      if (enabled) {
        if (!document.querySelector('#mem0-icon-button')) {
          addMem0Button();
        }
      } else {
        removeMemButton();
      }
    });
  }, 5000);
  // Fallback: observe chat thread for newly added user bubbles and post if we missed send
  const ensureThreadObserver = () => {
    const thread = document.querySelector(
      '.flex-1.flex.flex-col.gap-3.px-4.max-w-3xl.mx-auto.w-full'
    );
    if (!thread) {
      setTimeout(ensureThreadObserver, 1000);
      return;
    }
    if ((thread as ExtendedElement).__mem0Observed) {
      return;
    }
    (thread as ExtendedElement).__mem0Observed = true;

    // Track processed messages to avoid duplicates
    const processedMessages = new Set();

    const observer = new MutationObserver(mutations => {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (!m) {
          continue;
        }
        const added = m.addedNodes;
        for (let j = 0; j < added.length; j++) {
          const n = added[j];
          if (!n) {
            continue;
          }
          const node = (n as ExtendedElement).nodeType === 1 ? (n as Element) : null;
          if (!node) {
            continue;
          }
          const userEl = (node as ExtendedElement).matches?.('.font-user-message')
            ? node
            : (node as ExtendedElement).querySelector?.('.font-user-message');
          if (userEl) {
            const text = (userEl.textContent || '').trim();
            if (text) {
              // Create a simple hash of the message to avoid duplicates
              const messageHash = text.length + '_' + text.substring(0, 50);

              // Skip if we've already processed this exact message recently
              if (processedMessages.has(messageHash)) {
                return;
              }

              // Add to processed set and clean up old entries periodically
              processedMessages.add(messageHash);
              if (processedMessages.size > 10) {
                const entries = Array.from(processedMessages);
                processedMessages.clear();
                // Keep the last 5 entries
                entries.slice(-5).forEach(entry => processedMessages.add(entry));
              }

              // If we just initiated a send, give primary handlers a brief head start
              const justInitiated = Date.now() - lastSendInitiatedAt < 500; // Reduced from 1200ms to 500ms

              if (justInitiated) {
                // For very recent sends, delay slightly to let primary handlers run first
                setTimeout(() => {
                  // Double-check if we still need to process this message
                  if (!processedMessages.has(messageHash + '_processed')) {
                    processedMessages.add(messageHash + '_processed');
                    captureAndStoreMemory(text);
                  }
                }, 200);
              } else {
                // For older messages or when no recent send detected, process immediately
                processedMessages.add(messageHash + '_processed');
                captureAndStoreMemory(text);
              }

              // Update lastSendInitiatedAt to help coordinate with other handlers
              lastSendInitiatedAt = Date.now();
              return;
            }
          }
        }
      }
    });
    observer.observe(thread, { childList: true, subtree: true });
  };
  ensureThreadObserver();
}

// Function to show login popup
function showLoginPopup() {
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
    window.open('https://app.mem0.ai/login', '_blank');
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

// Function to capture and store memory asynchronously
async function captureAndStoreMemory(snapshot: string) {
  // Check if extension context is valid
  if (!chrome || !chrome.storage) {
    return;
  }

  try {
    // Check if memory is enabled
    const memoryEnabled = await getMemoryEnabledState();
    if (memoryEnabled === false) {
      return; // Don't process memories if disabled
    }
  } catch {
    return;
  }

  // Use the provided snapshot directly if available, otherwise try to get from input
  let message = typeof snapshot === 'string' && snapshot.trim() !== '' ? snapshot : '';

  if (!message) {
    // Find the input element (prioritizing the ProseMirror div with contenteditable="true")
    let inputElement = document.querySelector('div[contenteditable="true"].ProseMirror');

    // If ProseMirror not found, try other input elements
    if (!inputElement) {
      inputElement =
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector('textarea') ||
        document.querySelector('p[data-placeholder="How can I help you today?"]') ||
        document.querySelector('p[data-placeholder="Reply to Claude..."]');
    }

    if (!inputElement) {
      return;
    }

    if (inputElement.classList.contains('ProseMirror')) {
      // For ProseMirror, get the textContent for plain text
      message = inputElement.textContent || '';
    } else if (inputElement.tagName.toLowerCase() === 'div') {
      message = inputElement.textContent || '';
    } else if (inputElement.tagName.toLowerCase() === 'p') {
      message = inputElement.textContent || '';
    } else {
      message = inputElement.value || '';
    }
  }

  if (!message || message.trim() === '') {
    return;
  }

  // For ProseMirror, the getContentWithoutMemories returns HTML, so we need to extract text
  if (typeof snapshot !== 'string' || !snapshot.trim()) {
    message = getContentWithoutMemories(message);
  }

  // Skip if message is empty after processing
  if (!message || message.trim() === '') {
    return;
  }

  // Asynchronously store the memory

  try {
    // Check extension context again before storage access
    if (!chrome || !chrome.storage || !chrome.storage.sync) {
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
        // Check for chrome.runtime.lastError which indicates extension context issues
        try {
          // @ts-ignore
          if (chrome.runtime && chrome.runtime.lastError) {
            return;
          }
        } catch {
          // Ignore errors when checking chrome.runtime.lastError
        }
        // Skip if memory is disabled or no credentials
        if (items.memory_enabled === false || (!items.apiKey && !items.access_token)) {
          return;
        }

        const authHeader = items.access_token
          ? `Bearer ${items.access_token}`
          : `Token ${items.apiKey}`;

        const userId = items.userId || items.user_id || 'chrome-extension-user';

        // Get recent messages for context using sliding window
        const contextMessages = getConversationContext(false); // Don't include current message yet
        contextMessages.push({ role: MessageRole.User, content: message }); // Add current message

        const optionalParams: OptionalApiParams = {};

        if (items.selected_org) {
          optionalParams.org_id = items.selected_org;
        }
        if (items.selected_project) {
          optionalParams.project_id = items.selected_project;
        }

        // Send memory to mem0 API asynchronously without waiting for response
        fetch('https://api.mem0.ai/v1/memories/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify({
            messages: contextMessages,
            user_id: userId,
            infer: true,
            metadata: {
              provider: 'Claude',
            },
            source: 'OPENMEMORY_CHROME_EXTENSION',
            ...optionalParams,
          }),
        })
          .then(response => {
            if (!response.ok) {
              // Silent failure for background memory addition
            }
          })
          .catch(() => {
            // Silent failure for background memory addition
          });
      }
    );
  } catch {
    // Silent failure for background memory addition
  }
}

// Function to update the notification dot
function updateNotificationDot() {
  // Find all Mem0 notification dots
  const notificationDots = document.querySelectorAll('#mem0-notification-dot');
  if (!notificationDots.length) {
    return;
  }

  // Find the input element (prioritizing the ProseMirror div with contenteditable="true")
  let inputElement = document.querySelector('div[contenteditable="true"].ProseMirror');

  // If ProseMirror not found, try other input elements
  if (!inputElement) {
    inputElement =
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea') ||
      document.querySelector('p[data-placeholder="How can I help you today?"]') ||
      document.querySelector('p[data-placeholder="Reply to Claude..."]');
  }

  if (!inputElement) {
    return;
  }

  // Function to check if input has text
  const checkForText = () => {
    let hasText = false;

    // Check for text based on the input type
    if (inputElement.classList.contains('ProseMirror')) {
      // For ProseMirror, check if it has any content other than just a placeholder <p>
      const paragraphs = inputElement.querySelectorAll('p');

      // Check if there's text content or if there are multiple paragraphs (not just empty placeholder)
      const textContent = (inputElement.textContent || '').trim();
      hasText =
        textContent !== '' ||
        paragraphs.length > 1 ||
        (paragraphs.length === 1 &&
          !(paragraphs[0] as HTMLElement | undefined)?.classList?.contains('is-empty'));
    } else if (inputElement.tagName.toLowerCase() === 'p') {
      // For p elements with placeholder
      hasText = (inputElement.textContent || '').trim() !== '';
    } else if (inputElement.tagName.toLowerCase() === 'div') {
      // For normal contenteditable divs
      hasText = (inputElement.textContent || '').trim() !== '';
    } else {
      // For textareas
      hasText = (inputElement.value || '').trim() !== '';
    }

    // Update all notification dots
    notificationDots.forEach(notificationDot => {
      if (hasText) {
        notificationDot.classList.add('active');
        notificationDot.style.display = 'block';
      } else {
        notificationDot.classList.remove('active');
        notificationDot.style.display = 'none';
      }
    });
  };

  // Setup mutation observer for the input element to detect changes
  const observer = new MutationObserver(checkForText);
  observer.observe(inputElement, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  // Also listen for direct input events
  inputElement.addEventListener('input', checkForText);
  inputElement.addEventListener('keyup', checkForText);
  inputElement.addEventListener('focus', checkForText);

  // Initial check
  checkForText();

  // Force another check after a small delay to ensure DOM is fully loaded
  setTimeout(checkForText, 500);
}

// Enhanced DOM-based message detection since CSP blocks network interception
let domMonitoringActive = false;

function setupEnhancedDOMMonitoring() {
  if (domMonitoringActive) {
    return;
  }

  domMonitoringActive = true;

  // Enhanced real-time message monitoring with multiple strategies
  function setupRealTimeMessageMonitoring() {
    const threadSelector = '.flex-1.flex.flex-col.gap-3.px-4.max-w-3xl.mx-auto.w-full';

    // Strategy 1: Monitor for new user message elements
    const messageObserver = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            const el = node as Element;
            // Look for user messages
            const userMessage = el.querySelector('.font-user-message');
            if (userMessage) {
              const text = (userMessage.textContent || '').trim();
              if (text) {
                // Add to conversation history
                addToConversationHistory(MessageRole.User, text);

                setTimeout(() => {
                  captureAndStoreMemory(text);
                  setTimeout(() => {
                    allMemories = [];
                    allMemoriesById.clear();
                  }, 100);
                }, 50);
              }
            }

            // Also check if the node itself is a user message
            if (
              (el as ExtendedElement).classList &&
              (el as ExtendedElement).classList.contains('font-user-message')
            ) {
              const text = (el.textContent || '').trim();
              if (text) {
                // Add to conversation history
                addToConversationHistory(MessageRole.User, text);

                setTimeout(() => {
                  captureAndStoreMemory(text);
                  setTimeout(() => {
                    allMemories = [];
                    allMemoriesById.clear();
                  }, 100);
                }, 50);
              }
            }

            // Also look for Claude's assistant messages
            const assistantMessage = el.querySelector('.font-claude-message');
            if (assistantMessage) {
              const text = (assistantMessage.textContent || '').trim();
              if (text) {
                // Add to conversation history
                addToConversationHistory(MessageRole.Assistant, text);
              }
            }

            // Check if the node itself is an assistant message
            if (
              (el as ExtendedElement).classList &&
              (el as ExtendedElement).classList.contains('font-claude-message')
            ) {
              const text = (el.textContent || '').trim();
              if (text) {
                // Add to conversation history
                addToConversationHistory(MessageRole.Assistant, text);
              }
            }
          }
        });
      });
    });

    // Find and observe the thread
    const thread = document.querySelector(threadSelector);
    if (thread) {
      messageObserver.observe(thread, {
        childList: true,
        subtree: true,
        attributes: false,
        characterData: false,
      });
    } else {
      // Retry finding the thread
      setTimeout(setupRealTimeMessageMonitoring, 1000);
    }
  }

  // Strategy 2: Monitor input clearing as a signal that message was sent
  function setupInputClearingMonitor() {
    const inputSelectors = [
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"]',
      'textarea',
      'p[data-placeholder="How can I help you today?"]',
      'p[data-placeholder="Reply to Claude..."]',
    ];

    let lastInputValue = '';
    let inputClearingObserver: MutationObserver | undefined;

    function findAndObserveInput() {
      for (const selector of inputSelectors) {
        const input = document.querySelector(selector);
        if (input) {
          // Disconnect any existing observer
          if (inputClearingObserver) {
            inputClearingObserver.disconnect();
          }

          inputClearingObserver = new MutationObserver(() => {
            const currentValue = getInputValue() || '';

            // Check if input was cleared (had content, now empty)
            if (lastInputValue.trim() && !currentValue.trim()) {
              // Add to conversation history
              addToConversationHistory(MessageRole.User, lastInputValue);

              setTimeout(() => {
                captureAndStoreMemory(lastInputValue);
                setTimeout(() => {
                  allMemories = [];
                  allMemoriesById.clear();
                }, 100);
              }, 50);
            }

            lastInputValue = currentValue;
          });

          inputClearingObserver.observe(input, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
          });

          // Also listen for input events
          input.addEventListener('input', () => {
            lastInputValue = getInputValue() || '';
          });

          break;
        }
      }
    }

    findAndObserveInput();

    // Re-find input periodically in case DOM changes
    setInterval(findAndObserveInput, 5000);
  }

  // Start all monitoring strategies
  setupRealTimeMessageMonitoring();
  setupInputClearingMonitor();
}

// CSP blocks script injection, so focus on content script level approaches

// Add extension context monitoring
let extensionContextValid = true;
let currentUrl = window.location.href;

function checkExtensionContext() {
  // @ts-ignore
  const isValid = !!(chrome && chrome.runtime);
  if (extensionContextValid && !isValid) {
    extensionContextValid = false;
  }
  return isValid;
}

// Function to detect URL changes (SPA navigation)
function detectNavigation() {
  const newUrl = window.location.href;
  if (newUrl !== currentUrl) {
    const wasNewChat = currentUrl.includes('/new') || currentUrl.includes('/chat/new');
    const isNewChat = newUrl.includes('/new') || newUrl.includes('/chat/new');
    const isDifferentChat =
      currentUrl.includes('/chat/') && newUrl.includes('/chat/') && currentUrl !== newUrl;

    // Clear conversation history when navigating to a new chat or different chat
    if (isNewChat || isDifferentChat || wasNewChat) {
      conversationHistory = [];
    }

    // Reset DOM monitoring flag so it can be re-setup for new page
    domMonitoringActive = false;

    currentUrl = newUrl;

    // Re-initialize everything after navigation
    setTimeout(() => {
      // Re-initialize conversation history from new DOM
      initializeConversationHistoryFromDOM();

      // Re-add buttons and listeners
      addMem0Button();

      // Re-setup enhanced DOM monitoring for new page
      setupEnhancedDOMMonitoring();

      // Update notification dot
      updateNotificationDot();
    }, 500); // Small delay to let DOM update
  }
}

// Check for navigation every 1 second (more frequent than context check)
setInterval(() => {
  checkExtensionContext();
  detectNavigation();
}, 1000);

// Also listen for browser navigation events for faster detection
window.addEventListener('popstate', () => {
  setTimeout(detectNavigation, 100);
});

// Override pushState to catch programmatic navigation
const originalPushState = history.pushState;
history.pushState = function (data: HistoryStateData, unused: string, url?: string | URL | null) {
  originalPushState.call(history, data, unused, url);
  setTimeout(detectNavigation, 100);
};

// Override replaceState to catch programmatic navigation
const originalReplaceState = history.replaceState;
history.replaceState = function (
  data: HistoryStateData,
  unused: string,
  url?: string | URL | null
) {
  originalReplaceState.call(history, data, unused, url);
  setTimeout(detectNavigation, 100);
};

// Initialize conversation history from existing messages
initializeConversationHistoryFromDOM();

// Set up enhanced DOM monitoring
setupEnhancedDOMMonitoring();

// Main initialization
initializeMem0Integration();
