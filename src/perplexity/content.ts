/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { MessageRole } from '../types/api';
import type { MemoryItem, MemorySearchItem, OptionalApiParams } from '../types/memory';
import { SidebarAction } from '../types/messages';
import { type StorageItems, StorageKey } from '../types/storage';
import { createOrchestrator, type SearchStorage } from '../utils/background_search';
import { OPENMEMORY_PROMPTS } from '../utils/llm_prompts';
import { getBrowser, sendExtensionEvent } from '../utils/util_functions';

export {};

// Add global variables for memory modal
let memoryModalShown: boolean = false;
let allMemories: string[] = [];
// Track added memories by ID
const allMemoriesById: Set<string> = new Set<string>();
// Reference to the modal overlay for updates
let currentModalOverlay: HTMLDivElement | null = null;
// Add a variable to track the submit button observer
let submitButtonObserver: MutationObserver | null = null;
// Add variable to track if mem0 processing is happening
let isProcessingMem0: boolean = false;
// Track modal position for dragging
let modalPosition: { top: number | null; left: number | null } = { top: null, left: null };
let isDragging: boolean = false;

const perplexitySearch = createOrchestrator({
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

let perplexityBackgroundSearchHandler: (() => void) | null = null;
function hookPerplexityBackgroundSearchTyping() {
  const textarea = getTextarea();
  if (!textarea) {
    return;
  }
  if (!perplexityBackgroundSearchHandler) {
    perplexityBackgroundSearchHandler = function () {
      const text = getInputText(textarea).trim();
      (perplexitySearch as { setText: (text: string) => void }).setText(text);
    };
  }
  textarea.addEventListener('input', perplexityBackgroundSearchHandler);
  textarea.addEventListener('keyup', perplexityBackgroundSearchHandler);
}

function getTextarea(): HTMLElement | null {
  return (
    document.querySelector('textarea[id="ask-input"]') || // Follow-up screen textarea
    document.querySelector('textarea[placeholder="Ask a follow-up…"]') || // Follow-up screen textarea
    document.querySelector('div[contenteditable="true"][id="ask-input"]') || // Main screen Lexical editor
    document.querySelector('div[contenteditable="true"][aria-placeholder="Ask anything…"]') || // Main screen Lexical editor
    document.querySelector('textarea[placeholder="Ask anything…"]') // Fallback for older versions
  );
}

// Helper function to get text content from either textarea or contenteditable div
function getInputText(inputElement: HTMLElement | null): string {
  if (!inputElement) {
    return '';
  }

  if (inputElement.tagName === 'TEXTAREA') {
    return (inputElement as HTMLTextAreaElement).value || '';
  } else if (inputElement.contentEditable === 'true') {
    // For Lexical editor, properly handle the structure
    const paragraph = inputElement.querySelector('p[dir="ltr"]') as HTMLElement | null;
    if (paragraph) {
      let text = '';
      const childNodes = paragraph.childNodes;

      for (let i = 0; i < childNodes.length; i++) {
        const node = childNodes[i] as HTMLElement | Node;
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent || '';
        } else if (
          (node as HTMLElement).tagName === 'SPAN' &&
          (node as HTMLElement).getAttribute('data-lexical-text') === 'true'
        ) {
          text += (node as HTMLElement).textContent || '';
        } else if ((node as HTMLElement).tagName === 'BR') {
          text += '\n';
        }
      }

      return text;
    }

    // Fallback to textContent if structure is different
    return inputElement.textContent || '';
  }

  return '';
}

// Helper function to set text content for either textarea or contenteditable div
function setInputText(inputElement: HTMLElement | null, text: string): void {
  console.log('setInputText called with text:', text);
  console.log('inputElement:', inputElement);

  if (!inputElement) {
    console.log('No input element, returning');
    return;
  }

  if (inputElement.tagName === 'TEXTAREA') {
    console.log('Using textarea approach');
    (inputElement as HTMLTextAreaElement).value = text;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (inputElement.contentEditable === 'true') {
    console.log('Using contenteditable approach for Lexical editor');

    // New approach: Use clipboard with actual paste event
    console.log('Attempting clipboard-based approach');

    // Focus the input first
    inputElement.focus();

    // Select all existing content
    document.execCommand('selectAll', false, '');

    // Try to write to clipboard and then trigger paste
    if (navigator.clipboard && navigator.clipboard.writeText) {
      console.log('Using modern Clipboard API');
      navigator.clipboard
        .writeText(text)
        .then(() => {
          console.log('Text written to clipboard successfully');

          // Wait a bit then trigger paste
          setTimeout(() => {
            // Create and dispatch a paste event
            const pasteEvent = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData: new DataTransfer(),
            });

            // Add the text to clipboard data
            if (pasteEvent.clipboardData) {
              pasteEvent.clipboardData.setData('text/plain', text);
            }

            console.log('Dispatching paste event');
            const pasteResult = inputElement.dispatchEvent(pasteEvent);
            console.log('Paste event result:', pasteResult);

            // Check if it worked
            setTimeout(() => {
              console.log('Content after paste event:', getInputText(inputElement));

              // If paste event didn't work, try execCommand paste
              if (!getInputText(inputElement).includes(text.substring(0, 10))) {
                console.log('Paste event failed, trying execCommand paste');
                const execPasteResult = document.execCommand('paste');
                console.log('execCommand paste result:', execPasteResult);

                setTimeout(() => {
                  console.log('Content after execCommand paste:', getInputText(inputElement));

                  // If still not working, try the typing simulation
                  if (!getInputText(inputElement).includes(text.substring(0, 10))) {
                    console.log('All clipboard approaches failed, trying typing simulation');
                    simulateTyping(inputElement, text);
                  }
                }, 100);
              }
            }, 100);
          }, 100);
        })
        .catch(error => {
          console.log('Clipboard write failed:', error);
          // Fallback to typing simulation
          simulateTyping(inputElement, text);
        });
    } else {
      console.log('Clipboard API not available, falling back to typing simulation');
      simulateTyping(inputElement, text);
    }
  }
}

// Helper function to simulate typing using Selection API
function simulateTyping(inputElement: HTMLElement, text: string): void {
  console.log('simulateTyping called with text:', text);
  console.log('inputElement:', inputElement);

  inputElement.focus();
  console.log('Input element focused');

  // Try using Selection API with Range to insert text
  const selection = window.getSelection();

  // Clear existing content by selecting all
  if (!selection) {
    return;
  }
  selection.selectAllChildren(inputElement);
  console.log('Selected all children');

  // Try to delete existing content first
  selection.deleteFromDocument();
  console.log('Deleted existing content');

  // Now try to insert the new text using different methods

  // Method 1: Try using insertText with Selection API
  console.log('Attempting Method 1: Selection API insertText');
  try {
    if (!selection) {
      throw new Error('No selection');
    }
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    console.log('Method 1 succeeded - inserted text node');
    console.log('Content after Method 1:', getInputText(inputElement));

    // If this worked, we're done
    if (getInputText(inputElement).includes(text.substring(0, 10))) {
      console.log('Method 1 worked! Content updated successfully');
      return;
    }
  } catch (error) {
    console.log('Method 1 failed:', error);
  }

  // Method 2: Try using execCommand with composition events
  console.log('Attempting Method 2: execCommand with composition');
  try {
    // Start composition
    const compositionStart = new CompositionEvent('compositionstart', {
      bubbles: true,
      cancelable: true,
      data: '',
    });
    inputElement.dispatchEvent(compositionStart);

    // Update composition
    const compositionUpdate = new CompositionEvent('compositionupdate', {
      bubbles: true,
      cancelable: true,
      data: text,
    });
    inputElement.dispatchEvent(compositionUpdate);

    // End composition
    const compositionEnd = new CompositionEvent('compositionend', {
      bubbles: true,
      cancelable: true,
      data: text,
    });
    inputElement.dispatchEvent(compositionEnd);

    console.log('Method 2 composition events dispatched');
    console.log('Content after Method 2:', getInputText(inputElement));

    // If this worked, we're done
    if (getInputText(inputElement).includes(text.substring(0, 10))) {
      console.log('Method 2 worked! Content updated successfully');
      return;
    }
  } catch (error) {
    console.log('Method 2 failed:', error);
  }

  // Method 3: Try direct DOM manipulation with mutation observer disabled
  console.log('Attempting Method 3: Direct DOM manipulation');
  try {
    // Find or create the paragraph structure
    let paragraph = inputElement.querySelector('p[dir="ltr"]');
    if (!paragraph) {
      paragraph = document.createElement('p');
      paragraph.setAttribute('dir', 'ltr');
      inputElement.appendChild(paragraph);
    }

    // Create a span with the text
    const span = document.createElement('span');
    span.setAttribute('data-lexical-text', 'true');
    span.textContent = text;

    // Clear existing content and add new span
    paragraph.innerHTML = '';
    paragraph.appendChild(span);

    console.log('Method 3 DOM manipulation completed');
    console.log('Content after Method 3:', getInputText(inputElement));

    // Dispatch events to notify Lexical
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));

    // If this worked, we're done
    if (getInputText(inputElement).includes(text.substring(0, 10))) {
      console.log('Method 3 worked! Content updated successfully');
      return;
    }
  } catch (error) {
    console.log('Method 3 failed:', error);
  }

  // Method 4: Try using keyboard simulation
  console.log('Attempting Method 4: Keyboard simulation');
  try {
    // Clear content with Ctrl+A and Delete
    inputElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })
    );
    inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

    // Type each character with keyboard events
    for (let i = 0; i < text.length; i++) {
      const char = text.charAt(i);
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    }

    console.log('Method 4 keyboard simulation completed');
    console.log('Content after Method 4:', getInputText(inputElement));
  } catch (error) {
    console.log('Method 4 failed:', error);
  }

  console.log('All methods attempted. Final content:', getInputText(inputElement));
}

// Function to add the mem0 button to the UI
async function addMem0Button() {
  // First check if memory is enabled
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    // If memory is disabled, remove the button if it exists
    const existingButton = document.querySelector('.mem0-button-wrapper');
    if (existingButton) {
      existingButton.remove();
    }
    return;
  }

  // Find the input element first
  const inputEl = getTextarea();
  if (!inputEl) {
    setTimeout(addMem0Button, 500);
    return;
  }

  // Check if our button already exists to avoid duplicates
  if (document.querySelector('.mem0-claude-btn')) {
    return;
  }

  // Create a wrapper for the button and tooltip
  const mem0ButtonWrapper = document.createElement('div');
  mem0ButtonWrapper.className = 'mem0-button-wrapper';
  mem0ButtonWrapper.style.cssText = `
    position: relative;
    display: inline-block;
  `;

  // Create tooltip element
  const tooltip = document.createElement('div');
  tooltip.className = 'mem0-tooltip';
  tooltip.style.cssText = `
    visibility: hidden;
    background-color: #27272A;
    color: #fff;
    text-align: center;
    border-radius: 6px;
    padding: 6px 10px;
    position: absolute;
    z-index: 10000;
    bottom: 125%;
    left: 50%;
    transform: translateX(-50%);
    opacity: 0;
    transition: opacity 0.3s;
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    border: 1px solid #3B3B3F;
  `;
  tooltip.textContent = 'Add memories to your prompt';

  // Add tooltip arrow
  const tooltipArrow = document.createElement('div');
  tooltipArrow.style.cssText = `
    content: "";
    position: absolute;
    top: 100%;
    left: 50%;
    margin-left: -5px;
    border-width: 5px;
    border-style: solid;
    border-color: #27272A transparent transparent transparent;
  `;

  tooltip.appendChild(tooltipArrow);
  mem0ButtonWrapper.appendChild(tooltip);

  // Create the mem0 button
  const mem0Button = document.createElement('button');
  mem0Button.className =
    'mem0-claude-btn focus-visible:bg-offsetPlus dark:focus-visible:bg-offsetPlusDark hover:bg-offsetPlus text-textOff dark:text-textOffDark hover:text-textMain dark:hover:bg-offsetPlusDark dark:hover:text-textMainDark font-sans focus:outline-none outline-none outline-transparent transition duration-300 ease-out font-sans select-none items-center relative group/button justify-center text-center items-center rounded-lg cursor-pointer active:scale-[0.97] active:duration-150 active:ease-outExpo origin-center whitespace-nowrap inline-flex text-sm h-8 aspect-[9/8]';
  mem0Button.setAttribute('aria-label', 'Mem0 AI');
  mem0Button.setAttribute('type', 'button');
  mem0Button.style.position = 'relative';

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
    border: 2px solid #18181B;
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

  // Create inner structure similar to other buttons
  mem0Button.innerHTML = `
    <div class="flex items-center min-w-0 font-medium gap-1.5 justify-center">
      <div class="flex shrink-0 items-center justify-center size-4">
        <img src="${chrome.runtime.getURL('icons/mem0-claude-icon-p.png')}" alt="Mem0 AI" width="14" height="14" />
      </div>
    </div>
  `;

  // Add the notification dot to the button
  mem0Button.appendChild(notificationDot);

  // Add the button to the wrapper first
  mem0ButtonWrapper.appendChild(mem0Button);

  // Find the input container and insert the button to the LEFT of the input
  let inputContainer: HTMLElement | null = null;

  // Try to find the input container by looking for the parent that contains the input
  let currentElement: HTMLElement | null = inputEl as HTMLElement;
  while (currentElement && currentElement !== document.body) {
    // Look for a container that has flex layout and contains the input
    const computedStyle = window.getComputedStyle(currentElement);
    if (computedStyle.display === 'flex' && currentElement.contains(inputEl)) {
      inputContainer = currentElement;
      break;
    }
    currentElement = currentElement.parentElement;
  }

  // Fallback: use the direct parent of the input
  if (!inputContainer) {
    inputContainer = inputEl.parentElement;
  }

  if (!inputContainer) {
    setTimeout(addMem0Button, 500);
    return;
  }

  // Insert the button as the FIRST child of the input container (leftmost position)
  inputContainer.insertBefore(mem0ButtonWrapper, inputContainer.firstChild);

  // Style the button to match the input area
  mem0Button.style.width = '32px';
  mem0Button.style.height = '32px';
  mem0Button.style.borderRadius = '8px';
  mem0Button.style.background = 'transparent';
  mem0Button.style.display = 'inline-flex';
  mem0Button.style.alignItems = 'center';
  mem0Button.style.justifyContent = 'center';
  mem0Button.style.marginRight = '8px';
  mem0ButtonWrapper.style.display = 'inline-flex';
  mem0ButtonWrapper.style.alignItems = 'center';
  mem0ButtonWrapper.style.justifyContent = 'center';

  // Add hover effect for tooltip
  mem0ButtonWrapper.addEventListener('mouseenter', () => {
    tooltip.style.visibility = 'visible';
    tooltip.style.opacity = '1';
  });

  mem0ButtonWrapper.addEventListener('mouseleave', () => {
    tooltip.style.visibility = 'hidden';
    tooltip.style.opacity = '0';
  });

  // Add click event listener - modified to check login first and fix empty text case
  mem0Button.addEventListener('click', () => {
    // Get the current input text
    const textarea = getTextarea();

    if (textarea && getInputText(textarea).trim()) {
      // If there's text in the input, process memories
      handleMem0Processing(getInputText(textarea).trim(), false, 'mem0-icon-button');
    } else {
      // If no text, check login status first
      chrome.storage.sync.get(
        [StorageKey.API_KEY, StorageKey.USER_ID_CAMEL, StorageKey.ACCESS_TOKEN],
        function (items) {
          if (!items.apiKey && !items.access_token) {
            // Not logged in, show login popup
            showLoginPopup();
          } else {
            // Logged in but no text, show tooltip message
            const originalText = tooltip.textContent;
            tooltip.textContent = 'Add some text to find memories';
            tooltip.style.visibility = 'visible';
            tooltip.style.opacity = '1';

            // Reset the tooltip after a delay
            setTimeout(() => {
              tooltip.textContent = originalText;
              if (!mem0ButtonWrapper.matches(':hover')) {
                tooltip.style.visibility = 'hidden';
                tooltip.style.opacity = '0';
              }
            }, 1500);
          }
        }
      );
    }
  });

  // Setup the notification dot based on input content
  updateNotificationDot();
}

// Function to update the notification dot based on input content
function updateNotificationDot() {
  const textarea = getTextarea();
  const notificationDot = document.querySelector('#mem0-notification-dot');

  if (!textarea || !notificationDot) {
    // If elements aren't found yet, try again after a short delay
    setTimeout(updateNotificationDot, 500);
    return;
  }

  // Function to check if input has text
  const checkForText = () => {
    const inputText = getInputText(textarea);
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
  const inputChangeObserver = new MutationObserver(checkForText);

  // Start observing the input element
  inputChangeObserver.observe(textarea, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });

  // Also check on input and keyup events
  textarea.addEventListener('input', checkForText);
  textarea.addEventListener('keyup', checkForText);
  textarea.addEventListener('focus', checkForText);

  // Initial check
  checkForText();

  // Force check after a small delay
  setTimeout(checkForText, 500);
}

// Function to create memory modal
function createMemoryModal(
  memoryItems: MemoryItem[],
  isLoading: boolean = false,
  sourceButtonId: string | null = null
) {
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

  // Use saved position if available (for dragged modals)
  if (modalPosition.top !== null && modalPosition.left !== null) {
    topPosition = modalPosition.top;
    leftPosition = modalPosition.left;
  } else {
    // Different positioning based on which button triggered the modal
    if (sourceButtonId === 'mem0-icon-button') {
      // Position relative to the mem0 button (in the input area)
      const iconButton = document.querySelector('.mem0-claude-btn');
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
        // Fallback to default positioning
        positionDefault();
      }
    } else {
      // Default positioning
      positionDefault();
    }
  }

  // Helper function for default positioning
  function positionDefault() {
    // Find the mem0 button to position the modal relative to it
    const mem0Button = document.querySelector('.mem0-claude-btn');

    if (!mem0Button) {
      console.error('Mem0 button not found');
      return;
    }

    // Get the position and dimensions of the mem0 button
    const buttonRect = mem0Button.getBoundingClientRect();

    // Determine if there's enough space below the button
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - buttonRect.bottom;

    // Decide whether to place modal above or below based on available space
    // Prefer below if there's enough space
    const placeBelow = spaceBelow >= modalHeight;

    // Position the modal centered below the button
    leftPosition = buttonRect.left - modalWidth / 2 + buttonRect.width / 2;

    if (placeBelow) {
      // Place below the button
      topPosition = buttonRect.bottom + 10;
    } else {
      // Place above the button if not enough space below
      topPosition = buttonRect.top - modalHeight - 10;
    }

    // Ensure the modal stays on screen
    leftPosition = Math.max(Math.min(leftPosition, window.innerWidth - modalWidth - 10), 10);
  }

  // Create modal overlay
  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'mem0-modal-overlay';
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

  // Position the modal below or above the button
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
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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

  // Create header left section with logo and title
  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
  `;

  // Add Mem0 logo and title to header
  const logoImg = document.createElement('img');
  logoImg.src = chrome.runtime.getURL('icons/mem0-claude-icon.png');
  logoImg.style.cssText = `
    width: 26px;
    height: 26px;
    border-radius: 50%;
  `;

  // Create title element
  const title = document.createElement('div');
  title.textContent = 'OpenMemory';
  title.style.cssText = `
    font-size: 16px;
    font-weight: 600;
    color: #FFFFFF;
    margin-left: 8px;
  `;

  // Create header right section with Add to Prompt button
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

  // Add click handler for the Add to Prompt button
  addToPromptBtn.addEventListener('click', () => {
    // Only add memories that are not already added
    const newMemories = memoryItems
      .filter(memory => !allMemoriesById.has(String(memory.id)))
      .map(memory => {
        allMemoriesById.add(String(memory.id));
        return String(memory.text || '');
      });

    sendExtensionEvent('memory_injection', {
      provider: 'perplexity',
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

  // Assemble header
  headerLeft.appendChild(logoImg);
  headerLeft.appendChild(title);

  headerRight.appendChild(addToPromptBtn);
  headerRight.appendChild(settingsBtn);

  modalHeader.appendChild(headerLeft);
  modalHeader.appendChild(headerRight);

  // Add drag functionality
  let startX = 0;
  let startY = 0;
  let initialX = 0;
  let initialY = 0;

  modalHeader.addEventListener('mousedown', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target === modalHeader || modalHeader.contains(target))) {
      // Don't start drag if clicking on buttons
      if (target.tagName === 'BUTTON' || target.closest('button')) {
        return;
      }

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      // Get current position
      const rect = modalContainer.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;

      modalContainer.style.transition = 'none';
      modalContainer.style.opacity = '1';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      e.preventDefault();
    }
  });

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) {
      return;
    }

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    let newX = initialX + deltaX;
    let newY = initialY + deltaY;

    // Keep modal within viewport bounds
    const maxX = window.innerWidth - modalWidth;
    const maxY = window.innerHeight - modalHeight;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    modalContainer.style.left = newX + 'px';
    modalContainer.style.top = newY + 'px';

    // Update stored position
    modalPosition.left = newX;
    modalPosition.top = newY;
  }

  function handleMouseUp() {
    if (isDragging) {
      isDragging = false;
      modalContainer.style.transition = '';
      modalContainer.style.opacity = '1';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
  }

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

  // Create category section
  const categorySection = document.createElement('div');
  categorySection.style.cssText = `
    display: flex;
    gap: 8px;
    padding: 0 8px;
  `;

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

    // Reset currentMemoryIndex if it's beyond the available memories
    if (currentMemoryIndex >= memoryItems.length) {
      currentMemoryIndex = 0;
    }

    // Update navigation buttons state
    updateNavigationState(currentPage, totalPages);

    // Count how many memories we've displayed
    let displayedCount = 0;

    // Start from the current index
    let index = currentMemoryIndex;

    while (displayedCount < memoriesToShow && index < memoryItems.length) {
      const memory = memoryItems[index]!;

      // Only display memories that haven't been added yet
      if (!allMemoriesById.has(String(memory.id))) {
        // Ensure memory has an ID
        if (!memory.id) {
          memory.id = `memory-${Date.now()}-${index}`;
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
        memoryText.textContent = String(memory.text || '');

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
            provider: 'perplexity',
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

        // Increment displayed count
        displayedCount++;
      }

      // Move to next memory
      index++;
    }

    // If we didn't display any memories but there are available ones,
    // reset the index and try again (this handles the case where all visible memories
    // have been filtered out)
    if (displayedCount === 0 && memoryItems.length > 0) {
      currentMemoryIndex = 0;
      showMemories();
    } else if (displayedCount === 0) {
      // If truly no memories available, show empty state
      showEmptyState();
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

    if (isLoading || currentPage <= 1) {
      prevButton.disabled = true;
      prevButton.style.opacity = '0.5';
      prevButton.style.cursor = 'not-allowed';
    } else {
      prevButton.disabled = false;
      prevButton.style.opacity = '1';
      prevButton.style.cursor = 'pointer';
    }

    if (isLoading || currentPage >= totalPages) {
      nextButton.disabled = true;
      nextButton.style.opacity = '0.5';
      nextButton.style.cursor = 'not-allowed';
    } else {
      nextButton.disabled = false;
      nextButton.style.opacity = '1';
      nextButton.style.cursor = 'pointer';
    }
  }

  // Add navigation button handlers
  prevButton.addEventListener('click', () => {
    if (!isLoading && currentMemoryIndex > 0) {
      currentMemoryIndex -= memoriesPerPage;
      showMemories();
    }
  });

  nextButton.addEventListener('click', () => {
    if (!isLoading && currentMemoryIndex < memoryItems.length - memoriesPerPage) {
      currentMemoryIndex += memoriesPerPage;
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
  contentSection.appendChild(memoriesCounter);
  contentSection.appendChild(memoriesContent);

  modalContainer.appendChild(modalHeader);
  modalContainer.appendChild(contentSection);

  // Only add navigation when not in loading state
  if (!isLoading) {
    modalContainer.appendChild(navigationSection);
    navigationSection.appendChild(prevButton);
    navigationSection.appendChild(nextButton);
  }

  modalOverlay.appendChild(modalContainer);

  // Append to body
  document.body.appendChild(modalOverlay);

  // Show the first memory and update navigation
  showMemories();
  updateNavigationState(1, Math.ceil(memoryItems.length / memoriesPerPage));
}

// Shared function to update the input field with all collected memories
function updateInputWithMemories() {
  const inputElement = getTextarea();

  if (!inputElement || allMemories.length === 0) {
    return;
  }

  // First, remove any existing memory content from the input
  let currentContent = getInputText(inputElement);
  const memoryMarker = '\n\n' + OPENMEMORY_PROMPTS.memory_marker_prefix;

  if (currentContent.includes(memoryMarker)) {
    currentContent = currentContent.substring(0, currentContent.indexOf(memoryMarker)).trim();
  }

  // Create the memory content string
  let memoriesContent = '\n\n' + OPENMEMORY_PROMPTS.memory_header_text + '\n';

  // Add all memories to the content
  allMemories.forEach((mem, index) => {
    memoriesContent += `- ${mem}`;
    if (index < allMemories.length - 1) {
      memoriesContent += '\n';
    }
  });

  // Set the input value with the cleaned content + memories
  setInputValue(inputElement, currentContent + memoriesContent);
}

// Add a function to get the memory_enabled state
function getMemoryEnabledState(): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    chrome.storage.sync.get([StorageKey.MEMORY_ENABLED], function (result) {
      resolve(result.memory_enabled !== false); // Default to true if not set
    });
  });
}

// Function to capture and store the current message as a memory
function captureAndStoreMemory() {
  // Get the message content
  const textarea = getTextarea();
  if (!textarea) {
    return;
  }

  // Get raw content from the input element
  let message = getInputText(textarea);

  if (!message || message.trim() === '') {
    return;
  }

  // Skip if message contains the memory wrapper
  if ((message || '').includes('Here is some of my memories to help')) {
    // Extract only the user's original message
    const parts = (message || '').split('Here is some of my memories to help');
    message = (parts[0] || '').trim();
  }

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
      fetch('https://api.mem0.ai/v1/memories/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({
          messages: [{ role: MessageRole.User, content: message }],
          user_id: userId,
          infer: true,
          metadata: {
            provider: 'Perplexity',
          },
          source: 'OPENMEMORY_CHROME_EXTENSION',
          ...optionalParams,
        }),
      }).catch(error => {
        console.error('Error saving memory:', error);
      });
    }
  );
}

// Modify the setupSubmitButtonListener function to call captureAndStoreMemory
function setupSubmitButtonListener() {
  // Find the submit button
  const submitButton = document.querySelector('button[aria-label="Submit"]');
  if (!submitButton) {
    setTimeout(setupSubmitButtonListener, 500);
    return;
  }

  // Check if we already added a listener
  if (submitButton.dataset.mem0Listener) {
    return;
  }

  // Mark the button as having our listener
  submitButton.dataset.mem0Listener = 'true';

  // Add click event listener to the submit button
  submitButton.addEventListener('click', () => {
    // Capture and save memory before clearing
    captureAndStoreMemory();

    // Give a small delay to allow the submission to process
    setTimeout(() => {
      // Clear all memories
      allMemories = [];
      console.log('Message sent, memories cleared');
    }, 100);
  });

  // Also monitor for Enter key submission
  const textarea = getTextarea();
  if (textarea && !textarea.dataset.mem0EnterListener) {
    textarea.dataset.mem0EnterListener = 'true';

    textarea.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        // Capture and save memory before clearing
        captureAndStoreMemory();

        // User pressed Enter to submit
        setTimeout(() => {
          // Clear all memories
          allMemories = [];
          console.log('Message sent via Enter key, memories cleared');
        }, 100);
      }
    });
  }

  // Set up a MutationObserver to monitor conversation flow and clear memories after answers appear
  setupConversationObserver();
}

// Monitor the conversation for new responses
function setupConversationObserver() {
  // If we already have an observer, disconnect it
  if (submitButtonObserver) {
    submitButtonObserver.disconnect();
  }

  // Find the conversation container
  const conversationContainer = document.querySelector('main');
  if (!conversationContainer) {
    setTimeout(setupConversationObserver, 1000);
    return;
  }

  // Create a new observer
  submitButtonObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Check if a new answer block has been added
        const answersAdded = Array.from(mutation.addedNodes).some(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            return el.classList.contains('answer-container');
          }
          return false;
        });

        if (answersAdded) {
          // New answer appeared, clear memories
          allMemories = [];
          console.log('New answer detected, memories cleared');
        }
      }
    }
  });

  // Start observing
  submitButtonObserver.observe(conversationContainer, {
    childList: true,
    subtree: true,
  });
}

function setupInputObserver() {
  const textarea = getTextarea();
  if (!textarea) {
    setTimeout(setupInputObserver, 500);
    return;
  }
  // Remove Enter key event listeners
}

async function handleMem0Processing(
  capturedText?: string,
  clickSendButton: boolean = false,
  sourceButtonId: string | null = null
) {
  const textarea = getTextarea();
  if (!textarea) {
    console.error('No input textarea found');
    return;
  }

  const message = capturedText || getInputText(textarea).trim();

  // Store the original message to preserve it
  const originalMessage = message;

  if (!message) {
    console.error('No input message found');
    return;
  }

  // If already processing, don't start another operation
  if (isProcessingMem0) {
    return;
  }

  isProcessingMem0 = true;

  try {
    const data = await new Promise<StorageItems>(resolve => {
      chrome.storage.sync.get(
        [
          StorageKey.API_KEY,
          StorageKey.USER_ID_CAMEL,
          StorageKey.ACCESS_TOKEN,
          StorageKey.MEMORY_ENABLED,
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
    const memoryEnabled = data[StorageKey.MEMORY_ENABLED] !== false; // Default to true if not set

    const optionalParams: OptionalApiParams = {};
    if (data[StorageKey.SELECTED_ORG]) {
      optionalParams.org_id = data[StorageKey.SELECTED_ORG];
    }
    if (data[StorageKey.SELECTED_PROJECT]) {
      optionalParams.project_id = data[StorageKey.SELECTED_PROJECT];
    }

    if (!apiKey && !accessToken) {
      console.error('No API Key or Access Token found');
      isProcessingMem0 = false;
      // Show login popup instead of just returning
      showLoginPopup();
      return;
    }

    if (!memoryEnabled) {
      console.log('Memory is disabled. Skipping API calls.');
      if (clickSendButton) {
        clickSendButtonWithDelay();
      }
      isProcessingMem0 = false;
      return;
    }

    // Show loading modal now that we've confirmed credentials and memory enabled
    createMemoryModal([], true, sourceButtonId);

    sendExtensionEvent('modal_clicked', {
      provider: 'perplexity',
      source: 'OPENMEMORY_CHROME_EXTENSION',
      browser: getBrowser(),
    });

    const authHeader = accessToken ? `Bearer ${accessToken}` : `Token ${apiKey}`;

    const messages = [{ role: MessageRole.User, content: message }];

    // Use orchestrator immediate run
    perplexitySearch.runImmediate(message);

    // If no memories found, the createMemoryModal function will show empty state

    // Only send the message if explicitly requested and modal isn't shown
    if (clickSendButton && !memoryModalShown) {
      clickSendButtonWithDelay();
    }

    // Preserve original text regardless
    setInputValue(textarea, originalMessage);

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
        source: 'OPENMEMORY_CHROME_EXTENSION',
        metadata: {
          provider: 'Perplexity',
        },
        ...optionalParams,
      }),
    })
      .then(response => {
        if (!response.ok) {
          console.error(`Failed to add memory: ${response.status}`);
        }
      })
      .catch(error => {
        console.error('Error adding memory:', error);
      });
  } catch (error) {
    console.error('Error:', error);
    // Ensure the original message is preserved even if there's an error
    const inputElement = getTextarea();
    if (inputElement && originalMessage) {
      setInputValue(inputElement, originalMessage);
    }
    // Close the modal if there was an error
    closeModal();
  } finally {
    isProcessingMem0 = false;
  }
}

function setInputValue(inputElement: HTMLElement | null, value: string) {
  if (inputElement) {
    setInputText(inputElement, value);
  }
}

function clickSendButtonWithDelay() {
  setTimeout(() => {
    const sendButton = document.querySelector(
      'button[aria-label="Submit"]'
    ) as HTMLButtonElement | null;
    if (sendButton) {
      sendButton.click();
      // Clear memories after clicking the send button
      setTimeout(() => {
        allMemories = [];
        console.log('Message sent via clickSendButtonWithDelay, memories cleared');
      }, 100);
    } else {
      console.error('Send button not found');
    }
  }, 0);
}

function initializeMem0Integration() {
  // First check if memory is enabled
  getMemoryEnabledState().then(memoryEnabled => {
    if (!memoryEnabled) {
      // If memory is disabled, remove any existing button
      const existingButton = document.querySelector('.mem0-button-wrapper');
      if (existingButton) {
        existingButton.remove();
      }
      return;
    }

    setupInputObserver();
    try {
      hookPerplexityBackgroundSearchTyping();
    } catch {
      // Ignore errors
    }

    // Add the Mem0 button to the UI
    addMem0Button();

    // Set up the submit button listener to clear memories
    setupSubmitButtonListener();

    // Add DOM mutation observer to monitor for UI changes
    const bodyObserver = new MutationObserver(() => {
      addMem0Button();
      setupSubmitButtonListener();
      updateNotificationDot();
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Re-check periodically in case of navigation or UI changes
    setInterval(() => {
      addMem0Button();
      setupSubmitButtonListener();
      updateNotificationDot();
    }, 3000);

    // Set up keyboard shortcut to trigger Mem0 (Ctrl+M)
    document.addEventListener('keydown', function (event: KeyboardEvent) {
      if (event.ctrlKey && event.key === 'm') {
        event.preventDefault();
        const textarea = getTextarea();
        if (textarea && getInputText(textarea).trim()) {
          handleMem0Processing(getInputText(textarea).trim(), false, 'mem0-icon-button');
        }
      }
    });
  });
}

initializeMem0Integration();

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
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    position: relative;
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
  popupContainer.appendChild(closeButton);
  popupContainer.appendChild(logoContainer);
  popupContainer.appendChild(message);
  popupContainer.appendChild(signInButton);

  popupOverlay.appendChild(popupContainer);

  // Add click event to close when clicking outside
  popupOverlay.addEventListener('click', e => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });

  // Add to body
  document.body.appendChild(popupOverlay);
}

// Global closeModal function to fix the reference error
function closeModal() {
  if (memoryModalShown && currentModalOverlay) {
    document.body.removeChild(currentModalOverlay);
    memoryModalShown = false;
    // Reset modal position when closing
    modalPosition = { top: null, left: null };
  }
}
