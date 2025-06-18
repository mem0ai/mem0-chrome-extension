const INPUT_SELECTOR = "#chat-input, textarea, [contenteditable='true']";
const SEND_BUTTON_SVG_SELECTOR = 'div[role="button"] svg';

// Initialize memory tracking variables
let isProcessingMem0 = false;
let observer;
let memoryModalShown = false;
let allMemories = [];
let allMemoriesById = new Set();
let currentModalOverlay = null;
let mem0ButtonCheckInterval = null; // Add interval variable for button checks
let modalDragPosition = null; // Store the dragged position of the modal

// Function to remove the Mem0 icon button when memory is disabled
function removeMem0IconButton() {
  const iconButton = document.querySelector('#mem0-icon-button');
  if (iconButton) {
    const buttonContainer = iconButton.closest('div');
    if (buttonContainer && buttonContainer.id !== 'mem0-custom-container') {
      // Only remove the button, not the container unless it's our custom one
      try {
        buttonContainer.removeChild(iconButton);
      } catch (e) {
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
    
    for (const textarea of textareas) {
      const rect = textarea.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0;
      const area = rect.width * rect.height;
      
      if (isVisible && area > largestArea) {
        largestArea = area;
        bestMatch = textarea;
      }
    }
    
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

function getSendButtonElement() {
  try {
    
    // Strategy 1: Look for buttons with send-like characteristics
    const buttons = document.querySelectorAll('div[role="button"]');
    
    if (buttons.length === 0) {
      return null;
    }
    
    // Get the input element to help with positioning-based detection
    const inputElement = getInputElement();
    const inputRect = inputElement ? inputElement.getBoundingClientRect() : null;
    
    // Find candidate buttons that might be send buttons
    let bestSendButton = null;
    let bestScore = 0;
    
    for (const button of buttons) {
      // Skip if button is not visible or has no size
      const buttonRect = button.getBoundingClientRect();
      if (buttonRect.width === 0 || buttonRect.height === 0) {
        continue;
      }
      
      let score = 0;
      
      // 1. Check if it has an SVG (likely an icon button)
      const svg = button.querySelector('svg');
      if (svg) score += 2;
      
      // 2. Check if it has no text content (icon-only buttons)
      const buttonText = button.textContent.trim();
      if (buttonText === '') score += 2;
      
      // 3. Check if it contains a paper airplane shape (common in send buttons)
      const paths = svg ? svg.querySelectorAll('path') : [];
      if (paths.length > 0) score += 1;
      
      // 4. Check positioning relative to input (send buttons are usually close to input)
      if (inputRect) {
        // Check if button is positioned to the right of input
        if (buttonRect.left > inputRect.left) score += 1;
        
        // Check if button is at similar height to input
        if (Math.abs(buttonRect.top - inputRect.top) < 100) score += 2;
        
        // Check if button is very close to input (right next to it)
        if (Math.abs(buttonRect.left - (inputRect.right + 20)) < 40) score += 3;
      }
      
      // 5. Check for DeepSeek specific classes
      if (button.classList.contains('ds-button--primary')) score += 2;
      
      // Update best match if this button has a higher score
      if (score > bestScore) {
        bestScore = score;
        bestSendButton = button;
      }
    }
    
    // Return best match if score is reasonable
    if (bestScore >= 4) {
      return bestSendButton;
    }
    
    // Strategy 2: Look for buttons positioned at the right of the input
    if (inputElement) {
      // Find buttons positioned to the right of the input
      const rightButtons = Array.from(buttons).filter(button => {
        const buttonRect = button.getBoundingClientRect();
        return buttonRect.left > inputRect.right - 50 && // To the right
               Math.abs(buttonRect.top - inputRect.top) < 50; // Similar height
      });
      
      // Sort by horizontal proximity to input
      rightButtons.sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return (aRect.left - inputRect.right) - (bRect.left - inputRect.right);
      });
      
      // Return the closest button
      if (rightButtons.length > 0) {
        return rightButtons[0];
      }
    }
    
    // Strategy 3: Last resort - take the last button with an SVG
    const svgButtons = Array.from(buttons).filter(button => button.querySelector('svg'));
    if (svgButtons.length > 0) {
      return svgButtons[svgButtons.length - 1];
    }
    
    return null;
  } catch (e) {
    return null; // Return null on error instead of failing
  }
}

async function handleEnterKey(event) {
  const inputElement = getInputElement();
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    event.target === inputElement
  ) {
    event.preventDefault();
    event.stopPropagation();

    const memoryEnabled = await getMemoryEnabledState();
    if (!memoryEnabled) {
      triggerSendAction();
      return;
    }

    await handleMem0Processing();
  }
}

// Updated handleEnterKey with additional safety checks
async function handleEnterKey(event) {
  try {
    // Safety check - only proceed if we can identify an input element
    const inputElement = getInputElement();
    if (!inputElement) {
      return; // Skip processing if no input found
    }
    
    // Only handle Enter without Shift and when target is the input element
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      event.target === inputElement
    ) {
      
      // Don't prevent default behavior yet until we've checked memory state
      
      // Check if memory is enabled
      let memoryEnabled = false;
      try {
        memoryEnabled = await getMemoryEnabledState();
      } catch (e) {
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
      } catch (e) {
        triggerSendAction();
      }
    }
  } catch (e) {
    // Don't interfere with normal behavior if something goes wrong
  }
}

function initializeMem0Integration() {
  
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
    window.addEventListener('load', function() {
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
        } catch (e) {
        }
      }, 2000);
      
      // Wait additional time for UI to stabilize
      setTimeout(stageUIInit, 1000); // Reduced time
    } catch (e) {
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
        } catch (e) {
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
        } catch (e) {
          // On error, don't do anything
        }
      }, 5000);
      
    } catch (e) {
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
      document.addEventListener("keydown", handleEnterKey, true);
      
      // Listen for Ctrl+M to open the modal directly
      document.addEventListener("keydown", function(event) {
        if (event.ctrlKey && event.key === "m") {
          event.preventDefault();
          (async () => {
            try {
              await handleMem0Modal('mem0-icon-button');
            } catch (e) {
            }
          })();
        }
      });
      
      window.mem0KeyboardListenersAdded = true;
    } catch (e) {
    }
  }
  
  // Set up mutation observer with throttling and filtering
  function setupObserver() {
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
        '#mem0-icon-button *' // Any children of the button
      ];
      
      observer = new MutationObserver((mutations) => {
        // Skip mutations on ignored elements
        const shouldIgnore = mutations.every(mutation => {
          // Check if the mutation target or parents match any ignored selectors
          const isIgnoredElement = isIgnoredNode(mutation.target);
          
          // Check added nodes for tooltip/button related elements
          if (mutation.type === 'childList') {
            const addedIgnored = Array.from(mutation.addedNodes).some(node => {
              return node.nodeType === Node.ELEMENT_NODE && isIgnoredNode(node);
            });
            if (addedIgnored) return true;
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
      function isIgnoredNode(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        
        // Check self
        for (const selector of ignoredSelectors) {
          if (node.matches && node.matches(selector)) return true;
        }
        
        // Check parents up to 3 levels
        let parent = node.parentElement;
        let level = 0;
        while (parent && level < 3) {
          for (const selector of ignoredSelectors) {
            if (parent.matches && parent.matches(selector)) return true;
          }
          parent = parent.parentElement;
          level++;
        }
        
        return false;
      }
      
      // Only observe high-level document changes to detect navigation
      observer.observe(document.body, { 
        childList: true,
        subtree: true,
        attributes: false,
        attributeFilter: ['class', 'style'] // Only observe class/style changes
      });
      
      
    } catch (e) {
    }
  }
}

async function getMemoryEnabledState() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["memory_enabled", "apiKey", "access_token"], (data) => {
      // Check if memory is enabled AND if we have auth credentials
      const hasAuth = !!data.apiKey || !!data.access_token;
      const memoryEnabled = !!data.memory_enabled;
      
      // Only consider logged in if both memory is enabled and auth credentials exist
      resolve(memoryEnabled && hasAuth);
    });
  });
}

function getInputElementValue() {
  const inputElement = getInputElement();
  return inputElement ? inputElement.value : null;
}

function setInputElementValue(value) {
  const inputElement = getInputElement();
  if (inputElement) {
    inputElement.value = value;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.focus();
  }
}

function getAuthDetails() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["apiKey", "access_token", "userId"], (items) => {
      resolve({
        apiKey: items.apiKey || null,
        accessToken: items.access_token || null,
        userId: items.userId || "chrome-extension-user",
      });
    });
  });
}

const MEM0_API_BASE_URL = "https://api.mem0.ai"; 

async function searchMemories(query) {
    try {
      const items = await chrome.storage.sync.get(["apiKey", "userId", "access_token"]);
      const userId = items.userId || "chrome-extension-user"; 

      if (!items.access_token && !items.apiKey) {
        return reject(new Error("Authentication details missing"));
      }

      const headers = {
        'Content-Type': 'application/json',
      };
      if (items.access_token) {
          headers['Authorization'] = `Bearer ${items.access_token}`;
      } else {
          headers['Authorization'] = `Api-Key ${items.apiKey}`; 
      }

      const url = `${MEM0_API_BASE_URL}/v2/memories/search/`;
      const body = JSON.stringify({
        query: query,
        filters: {
          user_id: userId,
        },
        rerank: false,
        threshold: 0.3,
        limit: 10,
        filter_memories: true,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: body
      });

      if (!response.ok) {
        return reject(new Error(`HTTP error! status: ${response.status}`));
      }

      const data = await response.json();

      const memoryItems = data.map(item => ({
        id: item.id,
        text: item.text,
        created_at: item.created_at,
        user_id: item.user_id,
        memory: item.memory,
      }));

      return memoryItems;
      
    } catch (error) {
      console.error("Error preparing search request:", error);
      return [];
    }
}


function addMemory(memoryText) {
  return new Promise(async (resolve, reject) => {
    try {
      const items = await chrome.storage.sync.get(["apiKey", "userId", "access_token"]);
      const userId = items.userId || "chrome-extension-user"; 

      if (!items.access_token && !items.apiKey) {
        console.error("No API Key or Access Token found for adding memory.");
        return reject(new Error("Authentication details missing"));
      }
      
      const headers = {
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
            role: "user",
            content: memoryText
          }
        ],
        user_id: userId 
      });

      fetch(url, {
        method: 'POST',
        headers: headers,
        body: body
      })
      .then(response => {
        if (!response.ok) {
           return response.json().then(errorData => {
            console.error("Mem0 API Add Memory Error Response Body:", errorData);
            throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
         }).catch(parseError => {
            console.error("Failed to parse add memory error response body:", parseError);
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
        console.error("Error adding memory directly:", error);
        reject(error); 
      });

    } catch (error) {
      console.error("Error preparing add memory request:", error);
      reject(error);
    }
  });
}

async function triggerSendAction() {
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
      const isDisabled = sendButton.getAttribute('aria-disabled') === 'true' || 
                         sendButton.classList.contains('disabled') || 
                         sendButton.classList.contains('ds-button--disabled') ||
                         sendButton.hasAttribute('disabled') || 
                         sendButton.disabled;

    if (!isDisabled) {
        
        // Try multiple click strategies
        try {
          // Strategy 1: Native click() method
      sendButton.click();
          
          // Strategy 2: After a short delay, try a MouseEvent if the first click didn't work
          setTimeout(() => {
            try {
              // Check if the input field is now empty (indicating message was sent)
              const inputElement = getInputElement();
              const inputValue = inputElement ? (inputElement.value || '').trim() : null;
              
              // If input is still not empty, try alternative click method
              if (inputValue && inputValue.length > 0) {
                const clickEvent = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window
                });
                sendButton.dispatchEvent(clickEvent);
              }
            } catch (e) {
            }
          }, 200);
          
          // Strategy 3: As a last resort, try to focus and press Enter
          setTimeout(() => {
            try {
              const inputElement = getInputElement();
              const inputValue = inputElement ? (inputElement.value || '').trim() : null;
              
              // If input is still not empty, try pressing Enter
              if (inputValue && inputValue.length > 0) {
                inputElement.focus();
                const enterEvent = new KeyboardEvent('keydown', {
                  key: 'Enter',
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                  bubbles: true,
                  cancelable: true
                });
                inputElement.dispatchEvent(enterEvent);
              }
            } catch (e) {
            }
          }, 500);
          
        } catch (error) {
    }
  } else {
      }
    } else {
    }
  } catch (e) {
  }
}

async function handleMem0Processing() {
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
      if (originalPrompt.trim().length > 5) { // Only add non-trivial prompts
        await addMemory(originalPrompt);
      }
  } catch (error) {
      // Continue regardless of error adding memory
    }
    
    // Reset state after a short delay
    setTimeout(() => {
      isProcessingMem0 = false;
      allMemories = []; // Clear loaded memories
      allMemoriesById = new Set();
    }, 1000);
    
  } catch (e) {
    // Reset processing state and trigger send as fallback
    isProcessingMem0 = false;
    triggerSendAction();
  }
}

// Function to create a memory modal
function createMemoryModal(memoryItems, isLoading = false, sourceButtonId = null) {
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
  
  let topPosition;
  let leftPosition;
  
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
  modalOverlay.addEventListener('click', (event) => {
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
  logoImg.src = chrome.runtime.getURL("icons/mem0-claude-icon.png");
  logoImg.style.cssText = `
    width: 26px;
    height: 26px;
    border-radius: 50%;
    margin-right: 10px;
  `;

  // OpenMemory titel
  const title = document.createElement('div');
  title.textContent = "OpenMemory";
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
    window.open('https://app.mem0.ai', '_blank');
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
  let currentlyExpandedMemory = null;

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
    const totalPages = Math.ceil(memoryItems.length / memoriesToShow);
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
  let dragOffset = { x: 0, y: 0 };
  
  modalHeader.addEventListener('mousedown', (e) => {
    isDragging = true;
    const containerRect = modalContainer.getBoundingClientRect();
    dragOffset.x = e.clientX - containerRect.left;
    dragOffset.y = e.clientY - containerRect.top;
    
    modalHeader.style.cursor = 'grabbing';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    e.preventDefault();
  });
  
  function handleMouseMove(e) {
    if (!isDragging) return;
    
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
      top: constrainedTop
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
      if (memoryIndex >= memoryItems.length) break;
      
      const memory = memoryItems[memoryIndex];
      
      // Skip memories that have been added already
      if (allMemoriesById.has(memory.id)) {
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
      memoryText.textContent = memory.memory || memory.text;

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
      addButton.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Add this memory
        allMemoriesById.add(memory.id);
        allMemories.push(memory.memory || memory.text);
        updateInputWithMemories();
        
        // Remove this memory from the list
        const index = memoryItems.findIndex(m => m.id === memory.id);
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
      function expandMemory() {
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
      }

      // Function to collapse memory
      function collapseMemory() {
        isExpanded = false;
        memoryText.style.webkitLineClamp = '2';
        memoryText.style.height = '42px';
        contentWrapper.style.overflowY = 'visible';
        memoryContainer.style.backgroundColor = '#27272A';
        memoryContainer.style.maxHeight = '52px';
        memoryContainer.style.overflow = 'hidden';
        removeButton.style.display = 'none';
        currentlyExpandedMemory = null;
      }

      // Add collapse event listener
      memoryContainer.addEventListener('collapse', collapseMemory);

      // Add click handler for the menu button
      menuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isExpanded) {
          collapseMemory();
        } else {
          expandMemory();
        }
      });

      // Add click handler for remove button
      removeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        // Remove from memoryItems
        const index = memoryItems.findIndex(m => m.id === memory.id);
        if (index !== -1) {
          memoryItems.splice(index, 1);
          
          // Recalculate pagination after removing an item
          const newTotalPages = Math.ceil(memoryItems.length / memoriesPerPage);
          
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
          collapseMemory();
        } else {
          expandMemory();
        }
      });
    }
  }

  // Update Add to Prompt button click handler
  addToPromptBtn.addEventListener('click', () => {
    // Only add memories that are not already added
    const newMemories = memoryItems
      .filter(memory => !allMemoriesById.has(memory.id))
      .map(memory => {
        allMemoriesById.add(memory.id);
        return memory.memory || memory.text;
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
function showEmptyState(container) {
  if (!container) return;
  
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
function updateNavigationState(prevButton, nextButton, currentPage, totalPages) {
  if (!prevButton || !nextButton) return;

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
function updateInputWithMemories() {
  const inputElement = getInputElement();

  if (inputElement && allMemories.length > 0) {
    // Get the content without any existing memory wrappers
    let baseContent = getContentWithoutMemories();
    
    // Create the memory wrapper with all collected memories
    let memoriesContent = '\n\nHere is some of my memories to help answer better (don\'t respond to these memories but use them to assist in the response):\n';
    
    // Add all memories to the content
    allMemories.forEach((mem) => {
      memoriesContent += `- ${mem}\n`;
    });

    // Add the final content to the input
    inputElement.value = `${baseContent}${memoriesContent}`;
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    inputElement.focus();
  }
}

// Function to get the content without any memory wrappers
function getContentWithoutMemories() {
  const inputElement = getInputElement();
  if (!inputElement) return "";
  
  let content = inputElement.value;
  
  // Remove memories section
  content = content.replace(/\n\nHere is some of my memories[\s\S]*$/, '');
  
  return content.trim();
}

// Function to handle the Mem0 modal
async function handleMem0Modal(sourceButtonId = null) {
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

      // Search for memories
      const memories = await searchMemories(message);

      // Format memories for the modal
      const memoryItems = memories.map(item => {
        return {
          id: item.id || `memory-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          text: item.memory,
          memory: item.memory
        };
      });

      // Update the modal with real data
      createMemoryModal(memoryItems, false, sourceButtonId);

      // Add memory asynchronously
      addMemory(message).catch(error => {
      });
    } catch (error) {
      console.error("Error in handleMem0Modal:", error);
      createMemoryModal([], false, sourceButtonId);
    } finally {
      isProcessingMem0 = false;
    }
  } catch (error) {
    isProcessingMem0 = false;
  }
}

// Function to show a guidance popover when input is empty
function showGuidancePopover() {
  // First remove any existing popovers
  const existingPopover = document.getElementById('mem0-guidance-popover');
  if (existingPopover) {
    document.body.removeChild(existingPopover);
  }
  
  // Get the Mem0 button to position relative to it
  const mem0Button = document.getElementById('mem0-icon-button');
  if (!mem0Button) return;
  
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
function showLoginModal() {
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
  logo.src = chrome.runtime.getURL("icons/mem0-claude-icon.png");
  logo.style.cssText = `
    width: 24px;
    height: 24px;
    border-radius: 50%;
    margin-right: 12px;
  `;

  const logoDark = document.createElement('img');
  logoDark.src = chrome.runtime.getURL("icons/mem0-icon-black.png");
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
  message.textContent = 'Please sign in to access your memories and personalize your conversations!';
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
    chrome.runtime.sendMessage({ action: "showLoginPopup" }, (response) => {
      if (chrome.runtime.lastError) {
        
        // Fallback: open the login page directly
        window.open('https://app.mem0.ai/login', '_blank');
      }
    });
    
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
  popupOverlay.addEventListener('click', (e) => {
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
    getMemoryEnabledState().then(memoryEnabled => {
      if (!memoryEnabled) {
        removeMem0IconButton();
        return;
      }
      
      // Continue with button creation if memory is enabled
      createAndAddButton();
    }).catch(e => {
      // If we can't check memory state, don't add the button
    });
    
    return { success: true, status: "checking_memory_state" };
  } catch (e) {
    return { success: false, status: "unexpected_error", error: e.message };
  }
  
  // Helper function to create and add the button
  function createAndAddButton() {
    // Check if the button already exists
    if (document.querySelector('#mem0-icon-button')) {
      return { success: true, status: "already_exists" };
    }
    
    // Wait for input element to be available before trying to add the button
    const inputElement = getInputElement();
    if (!inputElement) {
      // Retry in 1 second
      setTimeout(addMem0IconButton, 1000);
      return { success: false, status: "no_input_element" };
    }
    
    // Try multiple approaches to find placement locations
    let searchButton = null;
    let buttonContainer = null;
    let status = "searching";
    
    // Approach 1: Look for the search button by class and specific selectors
    searchButton = document.querySelector('div[role="button"] .ds-button__icon + span');
    if (searchButton && searchButton.textContent.trim().toLowerCase() === 'search') {
      buttonContainer = searchButton.closest('div[role="button"]').parentElement;
      if (buttonContainer) {
        status = "found_search_button";
      }
    } else {
      // Try alternative selector
      const allButtons = document.querySelectorAll('div[role="button"]');
      for (const btn of allButtons) {
        if (btn.textContent.trim().toLowerCase() === 'search') {
          searchButton = btn.querySelector('span');
          buttonContainer = btn.parentElement;
          status = "found_search_button_alt";
          break;
        }
      }
    }
    
    // Approach 2: Look for any toolbar or button container
    if (!buttonContainer) {
      const toolbars = document.querySelectorAll('.toolbar, .button-container, .controls');
      if (toolbars.length > 0) {
        buttonContainer = toolbars[0];
        status = "found_toolbar";
      }
    }
    
    // Approach 3: Try to find the input field and place it near there
    if (!buttonContainer) {
      if (inputElement && inputElement.parentElement) {
        // Try going up a few levels to find a good container
        let parent = inputElement.parentElement;
        let level = 0;
        while (parent && level < 3) {
          const buttons = parent.querySelectorAll('div[role="button"]');
          if (buttons.length > 0) {
            buttonContainer = parent;
            status = "found_input_parent_with_buttons";
            break;
          }
          parent = parent.parentElement;
          level++;
        }
        
        // If still not found, use direct parent
        if (!buttonContainer) {
          buttonContainer = inputElement.parentElement;
          status = "found_input_parent";
        }
      }
    }
    
    // Approach 4: Look for a div with role="toolbar" 
    if (!buttonContainer) {
      const toolbars = document.querySelectorAll('div[role="toolbar"]');
      if (toolbars.length > 0) {
        buttonContainer = toolbars[0];
        status = "found_role_toolbar";
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
      status = "created_custom_container";
    }
    
    // If we couldn't find a suitable container, bail out
    if (!buttonContainer) {
      return { success: false, status: "no_container" };
    }
    
    // Remove existing button if any
    const existingButton = document.querySelector('#mem0-icon-button');
    if (existingButton) {
      try {
        existingButton.parentElement.removeChild(existingButton);
      } catch (e) {
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
      } catch (e) {
      }
    }
    
    // Create the button to match DeepSeek style
    const mem0Button = document.createElement('div');
    mem0Button.id = 'mem0-icon-button';
    mem0Button.setAttribute('role', 'button');
    mem0Button.className = 'ds-button ds-button--rect ds-button--m';
    mem0Button.tabIndex = '0';
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
      if (tooltipVisible) return;
      tooltipVisible = true;
      
      tooltip.style.display = 'block';
      requestAnimationFrame(() => {
        tooltip.style.opacity = '1';
        mem0Button.style.backgroundColor = '#424451';
      });
    });
    
    mem0Button.addEventListener('mouseleave', () => {
      if (!tooltipVisible) return;
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
      } catch (error) {
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
      if (status === "found_search_button" || status === "found_search_button_alt") {
        // Position after the search button (to the right)
        const searchButtonParent = searchButton.closest('div[role="button"]');
        if (searchButtonParent && searchButtonParent.nextSibling) {
          buttonContainer.insertBefore(mem0ButtonContainer, searchButtonParent.nextSibling);
        } else {
          buttonContainer.appendChild(mem0ButtonContainer);
        }
      } else if (status === "found_toolbar" || status === "found_role_toolbar") {
        // Find an appropriate position in the toolbar - prefer the right side
        const lastChild = buttonContainer.lastChild;
        if (lastChild) {
          buttonContainer.insertBefore(mem0ButtonContainer, null); // append to end
        } else {
          buttonContainer.appendChild(mem0ButtonContainer);
        }
      } else if (status === "created_custom_container") {
        // Custom container - just append
        buttonContainer.appendChild(mem0ButtonContainer);
      } else {
        // Other cases - try to position after any buttons in the container
        const buttons = buttonContainer.querySelectorAll('div[role="button"]');
        if (buttons.length > 0) {
          const lastButton = buttons[buttons.length - 1];
          buttonContainer.insertBefore(mem0ButtonContainer, lastButton.nextSibling);
        } else {
          buttonContainer.appendChild(mem0ButtonContainer);
        }
      }
      
      // Only log the first time, not on subsequent calls
      if (!window.mem0ButtonAdded) {
        window.mem0ButtonAdded = true;
      }
    } catch (e) {
      return { success: false, status: "insert_failed", error: e.message };
    }
    
    // Update notification dot based on input content
    try {
      updateNotificationDot();
    } catch (e) {
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
      attributeFilter: ['value'] 
    });
    
    // Also check on input events
    inputElement.addEventListener('input', checkForText);
    
    // Initial check
    checkForText();
  }
}

// Add a function to clear memories after sending a message
function addSendButtonListener() {
  
  // Get all potential buttons
  const allButtons = document.querySelectorAll('div[role="button"]');
  
  // Log details of each button for debugging
  allButtons.forEach((btn, index) => {
    const hasSvg = btn.querySelector('svg') ? 'Yes' : 'No';
    const text = btn.textContent.trim();
  });
  
  // Try to get the send button
  const sendButton = getSendButtonElement();
  
  if (sendButton) {
    
    if (!sendButton.dataset.mem0Listener) {
      sendButton.dataset.mem0Listener = 'true';
      sendButton.addEventListener('click', function() {
        // Clear all memories after sending
        setTimeout(() => {
          allMemories = [];
          allMemoriesById.clear();
        }, 100);
      });
    } else {
    }
  } else {
  }
}

// Call the initialization function
initializeMem0Integration();
