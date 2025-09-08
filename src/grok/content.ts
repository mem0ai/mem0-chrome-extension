/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { MessageRole } from '../types/api';
import type { MemoryItem, MemorySearchItem, OptionalApiParams } from '../types/memory';
import { SidebarAction } from '../types/messages';
import { type StorageItems, StorageKey } from '../types/storage';
import { createOrchestrator, type SearchStorage } from '../utils/background_search';
import { OPENMEMORY_PROMPTS } from '../utils/llm_prompts';
import { getBrowser, sendExtensionEvent } from '../utils/util_functions';

export {};

let isProcessingMem0 = false;

let memoryModalShown: boolean = false;

// Global variable to store all memories
let allMemories: string[] = [];

// Track added memories by ID
const allMemoriesById: Set<string> = new Set<string>();

// Reference to the modal overlay for updates
let currentModalOverlay: HTMLDivElement | null = null;

// Track modal position for drag functionality
const modalPosition: { x: number | null; y: number | null } = { x: null, y: null };

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
    createMemoryModal(memoryItems, false);
  },

  onError: function () {
    if (memoryModalShown) {
      createMemoryModal([], false);
    }
  },

  minLength: 3,
  debounceMs: 150,
  cacheTTL: 60000,
});

function getTextarea(): HTMLTextAreaElement | null {
  const selectors = [
    'textarea.w-full.px-2.\\@\\[480px\\]\\/input\\:px-3.bg-transparent.focus\\:outline-none.text-primary.align-bottom.min-h-14.pt-5.my-0.mb-5',
    'textarea.w-full.px-2.\\@\\[480px\\]\\/input\\:px-3.pt-5.mb-5.bg-transparent.focus\\:outline-none.text-primary.align-bottom',
    'textarea[dir="auto"][spellcheck="false"][placeholder="Ask anything"]',
    'textarea[dir="auto"][spellcheck="false"][placeholder="Ask follow-up"]',
    'textarea[dir="auto"][spellcheck="false"]',
    'textarea[aria-label="Ask Grok anything"]',
  ];

  for (const selector of selectors) {
    const textarea = document.querySelector(selector) as HTMLTextAreaElement | null;
    if (textarea) {
      return textarea;
    }
  }
  return null;
}

let grokBackgroundSearchHandler: (() => void) | null = null;

function hookGrokBackgroundSearchTyping() {
  const textarea = getTextarea();
  if (!textarea) {
    return;
  }

  if (!grokBackgroundSearchHandler) {
    grokBackgroundSearchHandler = function () {
      let text = textarea.value || '';
      try {
        const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
        text = text.replace(MEM0_PLAIN, '').trim();
      } catch {
        // Ignore regex errors
      }
      (grokSearch as { setText: (text: string) => void }).setText(text);
    };
  }
  textarea.addEventListener('input', grokBackgroundSearchHandler);
  textarea.addEventListener('keyup', grokBackgroundSearchHandler);
}

function setupInputObserver(): void {
  const textarea = getTextarea();
  if (!textarea) {
    setTimeout(setupInputObserver, 500);
    return;
  }
}

function setInputValue(inputElement: HTMLTextAreaElement | null, value: string): void {
  if (inputElement) {
    inputElement.value = value;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Add a function to handle send button actions and clear memories after sending
function addSendButtonListener(): void {
  const selectors = [
    'button.group.flex.flex-col.justify-center.rounded-full[type="submit"]',
    'button.group.flex.flex-col.justify-center.rounded-full.focus\\:outline-none.focus-visible\\:outline-none[type="submit"]',
    'button[type="submit"]:not([aria-label="Submit attachment"])',
    'button[aria-label="Grok something"][role="button"]',
    'button[aria-label="Submit"][type="submit"]',
    'button[type="submit"].group.flex.flex-col.justify-center.rounded-full',
  ];

  // Handle capturing and storing the current message
  function captureAndStoreMemory(): void {
    const textarea = getTextarea();
    if (!textarea) {
      return;
    }

    const message = (textarea.value || '').trim();
    if (!message) {
      return;
    }

    // Clean message from any existing memory content
    const cleanMessage = getContentWithoutMemories();

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
        if (items.memory_enabled === false || (!items.apiKey && !items.access_token)) {
          return;
        }

        const authHeader = items.access_token
          ? `Bearer ${items.access_token}`
          : `Token ${items.apiKey}`;

        const userId = items.userId || items.user_id || 'chrome-extension-user';

        const optionalParams: OptionalApiParams = {};
        if (items.selected_org) {
          optionalParams.org_id = items.selected_org;
        }
        if (items.selected_project) {
          optionalParams.project_id = items.selected_project;
        }

        // Send memory to mem0 API asynchronously without waiting for response
        const storagePayload = {
          messages: [{ role: MessageRole.User, content: cleanMessage }],
          user_id: userId,
          infer: true,
          metadata: {
            provider: 'Grok',
          },
          source: 'OPENMEMORY_CHROME_EXTENSION',
          ...optionalParams,
        };

        fetch('https://api.mem0.ai/v1/memories/', {
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

    // Clear all memories after sending
    setTimeout(() => {
      allMemories = [];
      allMemoriesById.clear();
    }, 100);
  }

  // Find and add listeners to the send button
  let sendButton = null;
  for (const selector of selectors) {
    sendButton = document.querySelector(selector);
    if (sendButton && !sendButton.dataset.mem0Listener) {
      sendButton.dataset.mem0Listener = 'true';
      sendButton.addEventListener('click', function () {
        captureAndStoreMemory();
      });

      // Also handle textarea for Enter key press
      const textarea = getTextarea();
      if (textarea && !textarea.dataset.mem0KeyListener) {
        textarea.dataset.mem0KeyListener = 'true';
        textarea.addEventListener('keydown', function (event: KeyboardEvent) {
          // Check if Enter was pressed without Shift (standard send behavior)
          if (event.key === 'Enter' && !event.shiftKey) {
            captureAndStoreMemory();
          }
        });
      }

      break;
    }
  }
}

function initializeMem0Integration(): void {
  setupInputObserver();
  injectMem0Button();
  addSendButtonListener();

  // Set up mutation observer to reinject elements when DOM changes
  const observer = new MutationObserver(async () => {
    // Check memory state first
    const memoryEnabled = await getMemoryEnabledState();

    // Only inject the button if memory is enabled
    if (memoryEnabled) {
      injectMem0Button();
      addSendButtonListener();
      updateNotificationDot();
      hookGrokBackgroundSearchTyping();
    } else {
      // Remove the button if memory is disabled
      const existingContainer = document.querySelector('#mem0-button-container');
      if (existingContainer) {
        existingContainer.remove();
      }
    }
  });

  document.addEventListener('keydown', function (event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'm') {
      event.preventDefault();
      (async () => {
        await handleMem0Modal();
      })();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Also check memory state periodically in case it changes
  setInterval(async () => {
    const memoryEnabled = await getMemoryEnabledState();
    if (!memoryEnabled) {
      const existingContainer = document.querySelector('#mem0-button-container');
      if (existingContainer) {
        existingContainer.remove();
      }
    } else if (!document.querySelector('#mem0-button-container')) {
      injectMem0Button();
    }
  }, 5000);
}

function injectMem0Button(): void {
  // Function to periodically check and add the button if the parent element exists
  async function tryAddButton() {
    // First check if memory is enabled
    const memoryEnabled = await getMemoryEnabledState();

    // Remove existing button if memory is disabled
    if (!memoryEnabled) {
      const existingContainer = document.querySelector('#mem0-button-container');
      if (existingContainer) {
        existingContainer.remove();
      }
      // Check again after some time in case the state changes
      setTimeout(tryAddButton, 5000);
      return;
    }

    // Check if our button already exists
    if (
      document.querySelector('button[aria-label="OpenMemory"]') ||
      document.querySelector('#mem0-button-container')
    ) {
      return;
    }

    // Look specifically for the Auto button to position next to it
    let referenceButton = null;
    const textarea = getTextarea();

    if (textarea) {
      // Find the Auto button by looking in the immediate parent container of the textarea
      // This is more specific and should avoid finding multiple buttons
      let container = textarea.parentElement;
      while (container && !referenceButton) {
        const buttons = container.querySelectorAll('button');
        for (let i = 0; i < buttons.length; i++) {
          const btn = buttons[i]!;
          // Check if this button contains "Auto" text and is visible
          if (btn.textContent && btn.textContent.trim() === 'Auto' && btn.offsetParent !== null) {
            referenceButton = btn;
            break;
          }
        }
        // Move to parent if we haven't found the Auto button yet
        container = container.parentElement;
        // Don't go too far up the DOM tree
        if (container === document.body) {
          break;
        }
      }
    }

    if (!referenceButton) {
      // If we can't find the Auto button, wait and try again
      setTimeout(tryAddButton, 1000);
      return;
    }

    const parentDiv = referenceButton.parentElement;
    if (!parentDiv) {
      setTimeout(tryAddButton, 1000);
      return;
    }

    // Create mem0 button container
    const mem0ButtonContainer = document.createElement('div');
    mem0ButtonContainer.id = 'mem0-button-container';
    mem0ButtonContainer.style.position = 'relative'; // For positioning popover
    mem0ButtonContainer.style.marginLeft = '4px'; // Smaller margin to be closer to Auto button
    mem0ButtonContainer.style.display = 'flex';
    mem0ButtonContainer.style.alignItems = 'center'; // Ensure vertical alignment

    // Create mem0 button
    const mem0Button = document.createElement('button');
    mem0Button.className = referenceButton.className;
    mem0Button.setAttribute('type', 'button');
    mem0Button.setAttribute('tabindex', '0');
    mem0Button.setAttribute('aria-pressed', 'false');
    mem0Button.setAttribute('aria-label', 'OpenMemory');
    mem0Button.setAttribute('data-state', 'closed');
    mem0Button.id = 'mem0-icon-button';

    // Add additional styling to match the Auto button better
    mem0Button.style.minWidth = 'auto';
    mem0Button.style.padding = '0';
    mem0Button.style.width = '32px';
    mem0Button.style.height = '32px';
    mem0Button.style.display = 'flex';
    mem0Button.style.alignItems = 'center';
    mem0Button.style.justifyContent = 'center';
    mem0Button.style.flexShrink = '0'; // Prevent shrinking
    mem0Button.style.margin = '0'; // Reset any inherited margins

    // Create notification dot
    const notificationDot = document.createElement('div');
    notificationDot.id = 'mem0-notification-dot';
    notificationDot.style.cssText = `
      position: absolute;
      top: -2px;
      right: -2px;
      width: 8px;
      height: 8px;
      background-color:rgb(128, 221, 162);
      border-radius: 50%;
      border: 1px solid #1C1C1E;
      display: none;
      z-index: 1001;
      pointer-events: none;
    `;

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

    // Create button content - icon only, similar to Claude style
    mem0Button.innerHTML = `
      <img src="${chrome.runtime.getURL('icons/mem0-claude-icon-p.png')}" 
      width="18" height="18" style="display: block;">
    `;

    // Create popover element (hidden by default)
    const popover = document.createElement('div');
    popover.className = 'mem0-button-popover';
    popover.style.cssText = `
      position: absolute;
      bottom: 48px;
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
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      display: none;
      transition: opacity 0.2s;
    `;
    popover.textContent = 'Add memories to your prompt';

    // Add arrow
    const arrow = document.createElement('div');
    arrow.style.cssText = `
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%) rotate(45deg);
      width: 10px;
      height: 10px;
      background-color: #1C1C1E;
      border-right: 1px solid #27272A;
      border-bottom: 1px solid #27272A;
    `;
    popover.appendChild(arrow);

    // Add hover event for popover
    mem0ButtonContainer.addEventListener('mouseenter', () => {
      popover.style.display = 'block';
      setTimeout(() => (popover.style.opacity = '1'), 10);
    });

    mem0ButtonContainer.addEventListener('mouseleave', () => {
      popover.style.opacity = '0';
      setTimeout(() => (popover.style.display = 'none'), 200);
    });

    // Add click event to the mem0 button to show memory modal
    mem0Button.addEventListener('click', function () {
      // Check if the memories are enabled
      getMemoryEnabledState().then(memoryEnabled => {
        if (memoryEnabled) {
          handleMem0Modal();
        } else {
          // If memories are disabled, open options
          chrome.runtime.sendMessage({ action: SidebarAction.OPEN_OPTIONS });
        }
      });
    });

    // Assemble button components
    mem0ButtonContainer.appendChild(mem0Button);
    mem0ButtonContainer.appendChild(notificationDot);
    mem0ButtonContainer.appendChild(popover);

    // Insert after the Auto button (or reference button if Auto not found)
    parentDiv.insertBefore(mem0ButtonContainer, referenceButton.nextSibling);

    // Update notification dot based on input content
    updateNotificationDot();

    // Ensure notification dot is updated after DOM is fully loaded
    setTimeout(updateNotificationDot, 500);
  }

  // Start trying to add the button
  tryAddButton();

  // Also observe DOM changes to add button when needed
  const observer = new MutationObserver(() => {
    if (!document.querySelector('#mem0-button-container')) {
      tryAddButton();
    }

    // Also update notification dot when DOM changes
    updateNotificationDot();
    hookGrokBackgroundSearchTyping();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Function to update notification dot visibility based on text in the input
function updateNotificationDot(): void {
  const textarea = getTextarea();
  const notificationDot = document.querySelector('#mem0-notification-dot') as HTMLElement | null;

  if (textarea && notificationDot) {
    // Function to check if input has text
    const checkForText = () => {
      const inputText = textarea.value || '';
      const hasText = inputText.trim() !== '';

      if (hasText) {
        notificationDot.classList.add('active');
        // Force display style
        notificationDot.style.display = 'block';
      } else {
        notificationDot.classList.remove('active');
        notificationDot.style.display = 'none';
      }
    };

    // Set up an observer to watch for changes to the input field
    const inputObserver = new MutationObserver(checkForText);

    // Start observing the input element
    inputObserver.observe(textarea, {
      characterData: true,
      subtree: true,
    });

    // Also check on input and keyup events
    textarea.addEventListener('input', checkForText);
    textarea.addEventListener('keyup', checkForText);
    textarea.addEventListener('focus', checkForText);

    // Initial check
    checkForText();

    // Force check after a small delay to ensure DOM is fully loaded
    setTimeout(checkForText, 500);
  } else {
    // If elements aren't found immediately, try again after a short delay
    setTimeout(updateNotificationDot, 1000);
  }
}

function createMemoryModal(memoryItems: MemoryItem[], isLoading: boolean = false) {
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

  let topPosition;
  let leftPosition;

  // Use stored position if available, otherwise calculate based on button position
  if (modalPosition.x !== null && modalPosition.y !== null) {
    leftPosition = modalPosition.x;
    topPosition = modalPosition.y;
  } else {
    // Position relative to the OpenMemory button
    const mem0Button = document.querySelector('button[aria-label="OpenMemory"]');

    if (mem0Button) {
      const buttonRect = mem0Button.getBoundingClientRect();

      // Determine if there's enough space below the button
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - buttonRect.bottom;

      // Position the modal centered under the button
      leftPosition = Math.max(buttonRect.left + buttonRect.width / 2 - modalWidth / 2, 10);
      // Ensure the modal doesn't go off the right edge of the screen
      const rightEdgePosition = leftPosition + modalWidth;
      if (rightEdgePosition > window.innerWidth - 10) {
        leftPosition = window.innerWidth - modalWidth - 10;
      }

      if (spaceBelow >= modalHeight) {
        // Place below the button
        topPosition = buttonRect.bottom + 10;
      } else {
        // Place above the button if not enough space below
        topPosition = buttonRect.top - modalHeight - 10;
        // Check if it's in the upper half of the screen
        if (buttonRect.top < viewportHeight / 2) {
          modalHeight = 300; // Reduced height
          memoriesPerPage = 2; // Show only 2 memories
        }
      }
    } else {
      // Fallback positioning
      topPosition = 100;
      leftPosition = window.innerWidth / 2 - modalWidth / 2;
    }

    // Store the initial position
    modalPosition.x = leftPosition;
    modalPosition.y = topPosition;
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

  // Add drag functionality
  let isDraggingModal: boolean = false;
  const modalDragOffset: { x: number; y: number } = { x: 0, y: 0 };

  function handleDragStart(e: MouseEvent) {
    // Don't start dragging if clicking on buttons or interactive elements
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'BUTTON' || target.closest('button'))) {
      return;
    }

    isDraggingModal = true;
    const rect = modalContainer.getBoundingClientRect();
    modalDragOffset.x = e.clientX - rect.left;
    modalDragOffset.y = e.clientY - rect.top;
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    modalContainer.style.transition = 'none';
  }

  function handleDragMove(e: MouseEvent) {
    if (!isDraggingModal) {
      return;
    }

    e.preventDefault();
    const newX = e.clientX - modalDragOffset.x;
    const newY = e.clientY - modalDragOffset.y;

    // Constrain to viewport
    const maxX = window.innerWidth - modalWidth;
    const maxY = window.innerHeight - modalHeight;

    const constrainedX = Math.max(0, Math.min(newX, maxX));
    const constrainedY = Math.max(0, Math.min(newY, maxY));

    modalContainer.style.left = constrainedX + 'px';
    modalContainer.style.top = constrainedY + 'px';

    // Update stored position
    modalPosition.x = constrainedX;
    modalPosition.y = constrainedY;
  }

  function handleDragEnd() {
    isDraggingModal = false;
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    modalContainer.style.transition = '';
  }

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

  // Add Mem0 logo (updated to SVG)
  const logoImg = document.createElement('img');
  logoImg.src = chrome.runtime.getURL('icons/mem0-claude-icon.png');
  logoImg.style.cssText = `
    width: 26px;
    height: 26px;
    border-radius: 50%;
  `;

  // Add "OpenMemory" title
  const title = document.createElement('div');
  title.textContent = 'OpenMemory';
  title.style.cssText = `
    font-size: 16px;
    font-weight: 600;
    color: white;
    margin-left: 8px;
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

  // Add drag event listener to header
  modalHeader.addEventListener('mousedown', handleDragStart);

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

  // Function to create skeleton loading items (adjusted for different heights)
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

      const memory = memoryItems[memoryIndex]!;

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
          provider: 'grok',
          source: 'OPENMEMORY_CHROME_EXTENSION',
          browser: getBrowser(),
          injected_all: false,
          memory_id: memory.id,
        });

        // Add this memory
        allMemoriesById.add(String(memory.id));
        allMemories.push(String(memory.text || ''));
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

      // Track expanded state
      let isExpanded = false;

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

      // Function to expand memory
      const expandMemory = () => {
        if (currentlyExpandedMemory && currentlyExpandedMemory !== memoryContainer) {
          currentlyExpandedMemory.dispatchEvent(new Event('collapse'));
        }

        isExpanded = true;
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
      };

      // Function to collapse memory
      const collapseMemory = () => {
        isExpanded = false;
        memoryText.style.webkitLineClamp = '2';
        memoryText.style.height = '42px';
        contentWrapper.style.overflowY = 'visible';
        memoryContainer.style.backgroundColor = '#27272A';
        memoryContainer.style.maxHeight = '72px';
        memoryContainer.style.overflow = 'hidden';
        removeButton.style.display = 'none';
        currentlyExpandedMemory = null;
      };

      memoryContainer.addEventListener('collapse', collapseMemory);

      menuButton.addEventListener('click', e => {
        e.stopPropagation();
        if (isExpanded) {
          collapseMemory();
        } else {
          expandMemory();
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
        memoryContainer.style.backgroundColor = isExpanded ? '#18181B' : '#323232';
      });
      memoryContainer.addEventListener('mouseleave', () => {
        memoryContainer.style.backgroundColor = isExpanded ? '#1C1C1E' : '#27272A';
      });
    }

    // If after filtering for already added memories, there are no items to show,
    // check if we need to go to previous page
    if (memoriesContent.children.length === 0 && memoryItems.length > 0) {
      if (currentMemoryIndex > 0) {
        currentMemoryIndex = Math.max(0, currentMemoryIndex - memoriesPerPage);
        showMemories();
      } else {
        showEmptyState();
      }
    }
  }

  // Function to show empty state
  function showEmptyState() {
    memoriesContent.innerHTML = '';

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
  }

  // Add content to modal
  contentSection.appendChild(memoriesCounter);
  contentSection.appendChild(memoriesContent);

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

  navigationSection.appendChild(prevButton);
  navigationSection.appendChild(nextButton);

  // Assemble modal
  headerLeft.appendChild(logoImg);
  headerLeft.appendChild(title);
  headerRight.appendChild(addToPromptBtn);
  headerRight.appendChild(settingsBtn);

  modalHeader.appendChild(headerLeft);
  modalHeader.appendChild(headerRight);

  modalContainer.appendChild(modalHeader);
  modalContainer.appendChild(contentSection);
  modalContainer.appendChild(navigationSection);

  modalOverlay.appendChild(modalContainer);

  // Append to body
  document.body.appendChild(modalOverlay);

  // Show initial memories
  showMemories();

  // Update navigation button states
  function updateNavigationState(currentPage: number, totalPages: number) {
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
      provider: 'grok',
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

    // Remove all added memories from the memoryItems list
    for (let i = memoryItems.length - 1; i >= 0; i--) {
      if (allMemoriesById.has(String(memoryItems[i]?.id))) {
        memoryItems.splice(i, 1);
      }
    }
  });

  // Function to close the modal
  function closeModal() {
    if (currentModalOverlay && document.body.contains(currentModalOverlay)) {
      document.body.removeChild(currentModalOverlay);
    }
    currentModalOverlay = null;
    memoryModalShown = false;
    // Reset modal position when closing completely
    modalPosition.x = null;
    modalPosition.y = null;
  }
}

// Shared function to update the input field with all collected memories
function updateInputWithMemories() {
  const inputElement = getTextarea();

  if (inputElement && allMemories.length > 0) {
    // Get the content without any existing memory wrappers
    const baseContent = getContentWithoutMemories();

    // Create the memory string with all collected memories
    let memoriesContent = '\n\n' + OPENMEMORY_PROMPTS.memory_header_text + '\n';
    // Add all memories to the content
    allMemories.forEach((mem, index) => {
      memoriesContent += `- ${mem}`;
      if (index < allMemories.length - 1) {
        memoriesContent += '\n';
      }
    });

    // Add the final content to the input
    setInputValue(inputElement, baseContent + memoriesContent);
  }
}

// Function to get the content without any memory wrappers
function getContentWithoutMemories(): string {
  const inputElement = getTextarea();

  if (!inputElement) {
    return '';
  }

  let content: string = inputElement.value || '';

  // Remove any memory headers and content
  const memoryPrefix = OPENMEMORY_PROMPTS.memory_header_text;
  const prefixIndex = content.indexOf(memoryPrefix);
  if (prefixIndex !== -1) {
    content = content.substring(0, prefixIndex).trim();
  }

  // Also try with regex pattern
  try {
    const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
    content = content.replace(MEM0_PLAIN, '').trim();
  } catch {
    // Ignore regex errors
  }

  return content;
}

// Function to check if memory is enabled
function getMemoryEnabledState(): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    chrome.storage.sync.get([StorageKey.MEMORY_ENABLED], function (result) {
      resolve(result.memory_enabled !== false); // Default to true if not set
    });
  });
}

// Handler for the modal approach
async function handleMem0Modal() {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    return;
  }

  // Check if user is logged in
  const loginData = await new Promise<StorageItems>(resolve => {
    chrome.storage.sync.get(
      [StorageKey.API_KEY, StorageKey.USER_ID_CAMEL, StorageKey.ACCESS_TOKEN],
      function (items) {
        resolve(items as StorageItems);
      }
    );
  });

  // If no API key and no access token, show login popup
  if (!loginData.apiKey && !loginData.access_token) {
    showLoginPopup();
    return;
  }

  const textarea = getTextarea();
  let message = textarea ? (textarea.value || '').trim() : '';

  // If no message, show a popup and return
  if (!message) {
    // Show message that requires input
    const mem0Button = document.querySelector(
      'button[aria-label="OpenMemory"]'
    ) as HTMLElement | null;
    if (mem0Button) {
      showButtonPopup(mem0Button, 'Please enter some text first');
    }
    return;
  }

  // Clean the message of any existing memory content
  message = getContentWithoutMemories();

  if (isProcessingMem0) {
    return;
  }

  isProcessingMem0 = true;

  // Show the loading modal immediately with the source button ID
  createMemoryModal([], true);

  try {
    const data = await new Promise<StorageItems>(resolve => {
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
          resolve(items as StorageItems);
        }
      );
    });

    const apiKey = data[StorageKey.API_KEY];
    const userId = (data[StorageKey.USER_ID_CAMEL] ||
      data[StorageKey.USER_ID] ||
      'chrome-extension-user') as string;
    const accessToken = data[StorageKey.ACCESS_TOKEN];
    if (!apiKey && !accessToken) {
      isProcessingMem0 = false;
      return;
    }

    sendExtensionEvent('modal_clicked', {
      provider: 'grok',
      source: 'OPENMEMORY_CHROME_EXTENSION',
      browser: getBrowser(),
    });

    const authHeader = accessToken ? `Bearer ${accessToken}` : `Token ${apiKey}`;

    const messages = [{ role: MessageRole.User, content: message }];

    const optionalParams: OptionalApiParams = {};
    if (data[StorageKey.SELECTED_ORG]) {
      optionalParams.org_id = data[StorageKey.SELECTED_ORG];
    }
    if (data[StorageKey.SELECTED_PROJECT]) {
      optionalParams.project_id = data[StorageKey.SELECTED_PROJECT];
    }

    (grokSearch as { runImmediate: (message: string) => void }).runImmediate(message);

    // Proceed with adding memory asynchronously without awaiting
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
          provider: 'Grok',
        },
        source: 'OPENMEMORY_CHROME_EXTENSION',
        ...optionalParams,
      }),
    }).catch(error => {
      console.error('Error adding memory:', error);
    });
  } catch (error) {
    console.error('Error:', error);
    // Still show the modal but with empty state if there was an error
    createMemoryModal([], false);
  } finally {
    isProcessingMem0 = false;
  }
}

// Function to show a small popup message near the button
function showButtonPopup(button: HTMLElement, message: string): void {
  // Remove any existing popups
  const existingPopup = document.querySelector('.mem0-button-popup');
  if (existingPopup) {
    existingPopup.remove();
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

  // Position relative to button
  button.style.position = 'relative';
  button.appendChild(popup);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (popup && popup.parentElement) {
      popup.remove();
    }
  }, 3000);
}

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
  message.textContent = 'Please sign in to access your memories and enhance your conversations!';
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

initializeMem0Integration();
