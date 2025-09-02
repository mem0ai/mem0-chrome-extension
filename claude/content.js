// Global variables to store all memories
let allMemories = [];
let memoryModalShown = false;
let isProcessingMem0 = false;
let memoryEnabled = true;

// Initialize the MutationObserver variable
let observer;

// Track added memories by ID
let allMemoriesById = new Set();

// Reference to the modal overlay for updates
let currentModalOverlay = null;

// Added variable to track sync button status
let isSyncing = false;

// Variables to track modal position for draggable functionality
let modalPosition = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// Function to get memory enabled state from storage
async function getMemoryEnabledState() {
  return new Promise((resolve) => {
    chrome.storage.sync.get("memory_enabled", function (data) {
      resolve(data.memory_enabled);
    });
  });
}

// Function to remove mem0 button if it exists
function removeMemButton() {
  const mem0Button = document.querySelector("#mem0-button");
  if (mem0Button) {
    const buttonContainer = mem0Button.closest('div');
    if (buttonContainer) {
      buttonContainer.remove();
    } else {
      mem0Button.remove();
    }
  }
  
  // Also remove tooltip if it exists
  const tooltip = document.querySelector("#mem0-tooltip");
  if (tooltip) {
    tooltip.remove();
  }
}

function addMem0Button() {
  // Check if memory is enabled before adding the button
  getMemoryEnabledState().then(enabled => {
    memoryEnabled = enabled;
    
    // If memory is disabled, remove any existing button and return
    if (memoryEnabled === false) {
      removeMemButton();
      return;
    }
    
    const sendButton = document.querySelector(
      'button[aria-label="Send Message"]'
    );
    const sendUpButton = document.querySelector(
      'button[aria-label="Send message"]'
    );
    const screenshotButton = document.querySelector(
      'button[aria-label="Capture screenshot"]'
    );
    const inputToolsMenuButton = document.querySelector('#input-tools-menu-trigger');

    function createPopup(container, position = "top") {
      const popup = document.createElement("div");
      popup.className = "mem0-popup";
      let positionStyles = "";

      if (position === "top") {
        positionStyles = `
          bottom: 100%;
          left: 50%;
          transform: translateX(-40%);
          margin-bottom: 11px;
        `;
      } else if (position === "right") {
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

    if (inputToolsMenuButton && !document.querySelector("#mem0-button")) {
      const buttonContainer = document.createElement("div");
      buttonContainer.style.position = "relative";
      buttonContainer.style.display = "inline-block";

      const mem0Button = document.createElement("button");
      mem0Button.id = "mem0-button";
      mem0Button.className = inputToolsMenuButton.className;
      mem0Button.style.marginLeft = "0px";
      mem0Button.setAttribute("aria-label", "Add memories to your prompt");

      const mem0Icon = document.createElement("img");
      mem0Icon.src = chrome.runtime.getURL("icons/mem0-claude-icon-p.png");
      mem0Icon.style.width = "16px";
      mem0Icon.style.height = "16px";
      mem0Icon.style.borderRadius = "50%";

      const popup = createPopup(buttonContainer, "top");
      mem0Button.appendChild(mem0Icon);
      mem0Button.addEventListener("click", () => {
        if (memoryEnabled) {
          // Hide the tooltip if it's showing
          const tooltip = document.querySelector("#mem0-tooltip");
          if (tooltip) {
            tooltip.style.display = "none";
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

      const tooltip = document.createElement("div");
      tooltip.id = "mem0-tooltip";
      tooltip.textContent = "Add memories to your prompt";
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

      mem0Button.addEventListener("mouseenter", (event) => {
        // Hide any existing popup first
        const existingMem0Popup = document.querySelector('.mem0-popup[style*="display: block"]');
        if (existingMem0Popup && existingMem0Popup !== popup) {
          existingMem0Popup.style.display = "none";
        }
        
        const rect = mem0Button.getBoundingClientRect();
        const buttonCenterX = rect.left + rect.width / 2;
        
        // Set initial tooltip properties
        tooltip.style.display = "block";
        
        // Once displayed, we can get its height and set proper positioning
        const tooltipHeight = tooltip.offsetHeight || 24; // Default height if not yet rendered
        
        tooltip.style.left = `${buttonCenterX}px`;
        tooltip.style.top = `${rect.top - tooltipHeight - 10}px`; // Position 10px above button
      });

      mem0Button.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });

      // Find the parent container to place the button at the same level as input-tools-menu
      const parentContainer = inputToolsMenuButton.closest('.relative.flex-1.flex.items-center.gap-2') || 
                              inputToolsMenuButton.closest('.relative.flex-1') ||
                              inputToolsMenuButton.parentNode.parentNode.parentNode.parentNode.parentNode;
                              
      if (parentContainer) {
        // Find the third position in the container - after the first two divs
        // Looking for the flex-row div to insert before it
        const flexRowDiv = parentContainer.querySelector('.flex.flex-row.items-center.gap-2.min-w-0');
        
        // Find the tools div that we want to position after
        const toolsDiv = inputToolsMenuButton.closest('div > div > div > div').parentNode.parentNode;
        
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
        inputToolsMenuButton.parentNode.insertBefore(
          buttonContainer,
          inputToolsMenuButton.nextSibling
        );
      }
      
      // Update notification dot
      updateNotificationDot();
    } else if (
      window.location.href.includes("claude.ai/new") &&
      screenshotButton &&
      !document.querySelector("#mem0-button")
    ) {
      const buttonContainer = document.createElement("div");
      buttonContainer.style.position = "relative";
      buttonContainer.style.display = "inline-block";

      const mem0Button = document.createElement("button");
      mem0Button.id = "mem0-button";
      mem0Button.className = screenshotButton.className;
      mem0Button.style.marginLeft = "0px";
      mem0Button.setAttribute("aria-label", "Add memories to your prompt");

      const mem0Icon = document.createElement("img");
      mem0Icon.src = chrome.runtime.getURL("icons/mem0-claude-icon-p.png");
      mem0Icon.style.width = "16px";
      mem0Icon.style.height = "16px";
      mem0Icon.style.borderRadius = "50%";

      const popup = createPopup(buttonContainer, "right");
      mem0Button.appendChild(mem0Icon);
      mem0Button.addEventListener("click", () => {
        if (memoryEnabled) {
          // Hide the tooltip if it's showing
          const tooltip = document.querySelector("#mem0-tooltip");
          if (tooltip) {
            tooltip.style.display = "none";
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

      const tooltip = document.createElement("div");
      tooltip.id = "mem0-tooltip";
      tooltip.textContent = "Add memories to your prompt";
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

      mem0Button.addEventListener("mouseenter", (event) => {
        // Hide any existing popup first
        const existingMem0Popup = document.querySelector('.mem0-popup[style*="display: block"]');
        if (existingMem0Popup && existingMem0Popup !== popup) {
          existingMem0Popup.style.display = "none";
        }
        
        const rect = mem0Button.getBoundingClientRect();
        const buttonCenterX = rect.left + rect.width / 2;
        
        // Set initial tooltip properties
        tooltip.style.display = "block";
        
        // Once displayed, we can get its height and set proper positioning
        const tooltipHeight = tooltip.offsetHeight || 24; // Default height if not yet rendered
        
        tooltip.style.left = `${buttonCenterX}px`;
        tooltip.style.top = `${rect.top - tooltipHeight - 10}px`; // Position 10px above button
      });

      mem0Button.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });

      screenshotButton.parentNode.insertBefore(
        buttonContainer,
        screenshotButton.nextSibling
      );
      
      // Update notification dot
      updateNotificationDot();
    } else if ((sendButton || sendUpButton) && !document.querySelector("#mem0-button")) {
      const targetButton = sendButton || sendUpButton;
      if (!targetButton) return;
      
      // Find the parent container of the send button
      const buttonParent = targetButton.parentNode;
      if (!buttonParent) return;
      
      const buttonContainer = document.createElement("div");
      buttonContainer.style.position = "relative";
      buttonContainer.style.display = "inline-block";
      buttonContainer.style.marginRight = "12px";

      const mem0Button = document.createElement("button");
      mem0Button.id = "mem0-button";
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
      mem0Button.setAttribute("aria-label", "Add memories to your prompt");

      const mem0Icon = document.createElement("img");
      mem0Icon.src = chrome.runtime.getURL("icons/mem0-claude-icon-p.png");
      mem0Icon.style.width = "20px";
      mem0Icon.style.height = "20px";
      mem0Icon.style.borderRadius = "50%";

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

      const popup = createPopup(buttonContainer, "top");
      mem0Button.appendChild(mem0Icon);
      mem0Button.appendChild(notificationDot);
      mem0Button.addEventListener("click", () => {
        if (memoryEnabled) {
          // Hide the tooltip if it's showing
          const tooltip = document.querySelector("#mem0-tooltip");
          if (tooltip) {
            tooltip.style.display = "none";
          }
          
          handleMem0Modal(popup);
        }
      });

      mem0Button.addEventListener("mouseenter", () => {
        // Hide any existing popup first
        const existingMem0Popup = document.querySelector('.mem0-popup[style*="display: block"]');
        if (existingMem0Popup && existingMem0Popup !== popup) {
          existingMem0Popup.style.display = "none";
        }
        
        const rect = mem0Button.getBoundingClientRect();
        const buttonCenterX = rect.left + rect.width / 2;
        
        // Set initial tooltip properties
        tooltip.style.display = "block";
        
        // Once displayed, we can get its height and set proper positioning
        const tooltipHeight = tooltip.offsetHeight || 24; // Default height if not yet rendered
        
        tooltip.style.left = `${buttonCenterX}px`;
        tooltip.style.top = `${rect.top - tooltipHeight - 10}px`; // Position 10px above button
      });
      
      mem0Button.addEventListener("mouseleave", () => {
        mem0Button.style.backgroundColor = "transparent";
        popup.style.display = "none";
      });

      // Set popover text
      popup.textContent = "Add memories to your prompt";

      buttonContainer.appendChild(mem0Button);

      // Insert the button before the send button
      if (buttonParent.querySelector('button[aria-label="Send message"]')) {
        buttonParent.insertBefore(buttonContainer, buttonParent.querySelector('button[aria-label="Send message"]'));
      } else {
        buttonParent.insertBefore(buttonContainer, targetButton);
      }
      
      // Update notification dot
      updateNotificationDot();
    }

    // Add send button listener to capture memory and clear memories after sending
    const allSendButtons = [
      document.querySelector('button[aria-label="Send Message"]'),
      document.querySelector('button[aria-label="Send message"]')
    ].filter(Boolean);
    
    allSendButtons.forEach(sendBtn => {
      if (sendBtn && !sendBtn.dataset.mem0Listener) {
        sendBtn.dataset.mem0Listener = 'true';
        sendBtn.addEventListener('click', function() {
          // Capture and save memory asynchronously
          captureAndStoreMemory();
          
          // Clear all memories after sending
          setTimeout(() => {
            allMemories = [];
            allMemoriesById.clear();
          }, 100);
        });
      }
    });
      
    // Also handle Enter key press for sending messages
    const inputElement = document.querySelector('div[contenteditable="true"]') || 
                          document.querySelector("textarea") ||
                          document.querySelector('p[data-placeholder="How can I help you today?"]') ||
                          document.querySelector('p[data-placeholder="Reply to Claude..."]');
    
    if (inputElement && !inputElement.dataset.mem0KeyListener) {
      inputElement.dataset.mem0KeyListener = 'true';
      inputElement.addEventListener('keydown', function(event) {
        // Check if Enter was pressed without Shift (standard send behavior)
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          // Don't process for textarea which may want newlines
          if (inputElement.tagName.toLowerCase() !== 'textarea') {
            // Capture and save memory asynchronously
            captureAndStoreMemory();
            
            // Clear all memories after sending
            setTimeout(() => {
              allMemories = [];
              allMemoriesById.clear();
            }, 100);
          }
        }
      });
    }

    // Update notification dot state
    updateNotificationDot();
  });
}

function createMemoryModal(memoryItems, isLoading = false, sourceButtonId = null) {
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
  
  // Use stored position if available and modal is being recreated after loading
  if (modalPosition && currentModalOverlay) {
    topPosition = modalPosition.top;
    leftPosition = modalPosition.left;
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
      const mem0Button = document.querySelector("#mem0-button");
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
    const inputElement = document.querySelector('div[contenteditable="true"]') || 
                         document.querySelector("textarea") ||
                         document.querySelector('p[data-placeholder="How can I help you today?"]') ||
                         document.querySelector('p[data-placeholder="Reply to Claude..."]');
    
    if (!inputElement) {
      console.error("Input element not found");
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

  // Create header left section with just the logo
  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
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

  // Add "OpenMemory" title
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
      if (memoryIndex >= memoryItems.length) break; // Stop if we've reached the end
      
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
      memoryText.textContent = memory.text;

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
      addButton.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Mark this memory as added
        allMemoriesById.add(memory.id);
        
        // Add this memory to existing ones instead of replacing
        allMemories.push(memory.text);
        
        // Update the input with all memories
        updateInputWithMemories();
        
        // Remove this memory from the list
        const index = memoryItems.findIndex(m => m.id === memory.id);
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
        memoryContainer.style.maxHeight = '72px';
        memoryContainer.style.overflow = 'hidden';
        removeButton.style.display = 'none';
        currentlyExpandedMemory = null;
      }

      memoryContainer.addEventListener('collapse', collapseMemory);

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
  function updateNavigationState(currentPage, totalPages) {
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
  modalHeader.addEventListener('mousedown', (e) => {
    // Don't start dragging if clicking on a button or interactive element
    if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'SVG' || e.target.closest('svg')) {
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
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
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
    if (!isDragging) return;
    
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
  modalOverlay._cleanupDragEvents = () => {
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
  function closeModal() {
    if (currentModalOverlay && document.body.contains(currentModalOverlay)) {
      // Clean up drag event listeners
      if (currentModalOverlay._cleanupDragEvents) {
        currentModalOverlay._cleanupDragEvents();
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
      .filter(memory => !allMemoriesById.has(memory.id) && !memory.removed)
      .map(memory => {
        allMemoriesById.add(memory.id);
        return memory.text;
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
      if (allMemoriesById.has(memoryItems[i].id)) {
        memoryItems.splice(i, 1);
      }
    }
  });
}

// Add a function to apply just the current memory to the input
function applyMemoryToInput(memoryText) {
  // Add the new memory to our global collection
  if (!allMemories.includes(memoryText)) {
    allMemories.push(memoryText);
  }
  
  // Update the input field with all memories
  updateInputWithMemories();
}

// Function to apply multiple memories to the input field
function applyMemoriesToInput(memories) {
  // Add all new memories to our global collection
  memories.forEach((mem) => {
    if (!allMemories.includes(mem)) {
      allMemories.push(mem);
    }
  });
  
  // Update the input field with all memories
  updateInputWithMemories();
}

// Shared function to update the input field with all collected memories
function updateInputWithMemories() {
  // Find the input element (prioritizing the ProseMirror div with contenteditable="true")
  let inputElement = document.querySelector('div[contenteditable="true"].ProseMirror');
  
  // If ProseMirror not found, try other input elements
  if (!inputElement) {
    inputElement = document.querySelector('div[contenteditable="true"]') ||
                  document.querySelector("textarea") ||
                  document.querySelector('p[data-placeholder="How can I help you today?"]') ||
                  document.querySelector('p[data-placeholder="Reply to Claude..."]');
  }

  if (inputElement && allMemories.length > 0) {
    // Define the header text
    const headerText = "Here is some of my memories to help answer better (don't respond to these memories but use them to assist in the response):";
    
    // Check if ProseMirror editor
    if (inputElement.classList.contains('ProseMirror')) {
      // First check if the header already exists
      const headerExists = Array.from(inputElement.querySelectorAll('p strong')).some(el => 
        el.textContent.includes("Here is some of my memories")
      );
      
      if (headerExists) {
        // Get all existing memory paragraphs
        const paragraphs = Array.from(inputElement.querySelectorAll('p'));
        let headerIndex = -1;
        let existingMemories = [];
        
        // Find the index of the header paragraph
        for (let i = 0; i < paragraphs.length; i++) {
          const strongEl = paragraphs[i].querySelector('strong');
          if (strongEl && strongEl.textContent.includes("Here is some of my memories")) {
            headerIndex = i;
            break;
          }
        }
        
        // Collect all existing memories after the header
        if (headerIndex >= 0) {
          for (let i = headerIndex + 1; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const text = para.textContent.trim();
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
        let baseContent = getContentWithoutMemories();
        
        // Create the memory section
        let memoriesContent = `<p><strong>${headerText}</strong></p>`;
        
        // Add all memories to the content with proper paragraph tags
        memoriesContent += allMemories.map(mem => `<p>- ${mem}</p>`).join('');
        
        // If empty, replace the entire content
        if (!baseContent || baseContent.trim() === '' || 
           (inputElement.querySelectorAll('p').length === 1 && 
            inputElement.querySelector('p.is-empty') !== null)) {
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
        inputType: 'insertText'
      });
      inputElement.dispatchEvent(inputEvent);
      
      // Also dispatch a change event
      const changeEvent = new Event('change', { bubbles: true });
      inputElement.dispatchEvent(changeEvent);
    } else if (inputElement.tagName.toLowerCase() === "div") {
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
          tempDiv.innerHTML = afterHeader;
          const existingMemories = [];
          
          // Find all paragraphs that start with a dash
          Array.from(tempDiv.querySelectorAll('p')).forEach(p => {
            const text = p.textContent.trim();
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
        let baseContent = getContentWithoutMemories();
        let memoriesContent = `<p><strong>${headerText}</strong></p>`;
        
        allMemories.forEach(mem => {
          memoriesContent += `<p>- ${mem}</p>`;
        });
        
        inputElement.innerHTML = `${baseContent}${baseContent ? '<p><br></p>' : ''}${memoriesContent}`;
      }
      
      // Dispatch input event
      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (inputElement.tagName.toLowerCase() === "p" && 
               (inputElement.getAttribute('data-placeholder') === 'How can I help you today?' ||
               inputElement.getAttribute('data-placeholder') === 'Reply to Claude...')) {
      // For p element placeholders
      // Check if the header already exists
      if (inputElement.textContent.includes(headerText)) {
        // Find the header position and extract existing memories
        const textParts = inputElement.textContent.split(headerText);
        if (textParts.length > 1) {
          const beforeHeader = textParts[0];
          const afterHeader = textParts[1];
          
          // Extract existing memories
          const existingMemories = [];
          const memoryLines = afterHeader.split('\n');
          
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
          const newText = beforeHeader + 
                         headerText + "\n\n" + 
                         combinedMemories.map(mem => `- ${mem}`).join('\n');
          
          inputElement.textContent = newText;
        }
      } else {
        // Header doesn't exist
        let baseContent = getContentWithoutMemories();
        
        inputElement.textContent = `${baseContent}${baseContent ? '\n\n' : ''}${headerText}\n\n${allMemories.map(mem => `- ${mem}`).join('\n')}`;
      }
      
      // Dispatch various events
      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
      inputElement.dispatchEvent(new Event("focus", { bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      inputElement.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // For textarea
      // Check if the header already exists
      if (inputElement.value.includes(headerText)) {
        // Find the header position and extract existing memories
        const valueParts = inputElement.value.split(headerText);
        if (valueParts.length > 1) {
          const beforeHeader = valueParts[0];
          const afterHeader = valueParts[1];
          
          // Extract existing memories
          const existingMemories = [];
          const memoryLines = afterHeader.split('\n');
          
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
          const newValue = beforeHeader + 
                          headerText + "\n\n" + 
                          combinedMemories.map(mem => `- ${mem}`).join('\n');
          
          inputElement.value = newValue;
        }
      } else {
        // Header doesn't exist
        let baseContent = getContentWithoutMemories();
        
        inputElement.value = `${baseContent}${baseContent ? '\n\n' : ''}${headerText}\n\n${allMemories.map(mem => `- ${mem}`).join('\n')}`;
      }
      
      // Dispatch input event
      inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    }
    
    // Focus the input element to ensure the user can continue typing
    inputElement.focus();
  }
}

// Function to get the content without any memory wrappers
function getContentWithoutMemories() {
  // Find the input element (prioritizing the ProseMirror div with contenteditable="true")
  let inputElement = document.querySelector('div[contenteditable="true"].ProseMirror');
  
  // If ProseMirror not found, try other input elements
  if (!inputElement) {
    inputElement = document.querySelector('div[contenteditable="true"]') ||
                  document.querySelector("textarea") ||
                  document.querySelector('p[data-placeholder="How can I help you today?"]') ||
                  document.querySelector('p[data-placeholder="Reply to Claude..."]');
  }
    
  if (!inputElement) return "";
  
  let content = "";
  
  if (inputElement.classList.contains('ProseMirror')) {
    // For ProseMirror, get the innerHTML for proper structure handling
    content = inputElement.innerHTML;
  } else if (inputElement.tagName.toLowerCase() === "div") {
    // For normal contenteditable divs
    content = inputElement.innerHTML;
  } else if (inputElement.tagName.toLowerCase() === "p" && 
            (inputElement.getAttribute('data-placeholder') === 'How can I help you today?' ||
            inputElement.getAttribute('data-placeholder') === 'Reply to Claude...')) {
    // For p element placeholders
    content = inputElement.innerHTML || inputElement.textContent || '';
  } else {
    // For textarea
    content = inputElement.value;
  }
  
  // Remove any memory headers and content
  // Match both HTML and plain text variants
  
  // HTML variant
  const htmlMemInfoRegex = /<p><strong>Here is some of my memories to help answer better \(don't respond to these memories but use them to assist in the response\):<\/strong><\/p>([\s\S]*?)(?=<p>|$)/;
  content = content.replace(htmlMemInfoRegex, "");
  
  // Plain text variant
  const plainMemInfoRegex = /Here is some of my memories to help answer better \(don't respond to these memories but use them to assist in the response\):[\s\S]*?$/;
  content = content.replace(plainMemInfoRegex, "");
  
  // Also clean up any empty paragraphs at the end
  content = content.replace(/<p><br><\/p>$/g, "");
  content = content.replace(/<p class="is-empty"><br class="ProseMirror-trailingBreak"><\/p>$/g, "");
  
  return content.trim();
}

// New function to handle the memory modal
async function handleMem0Modal(popup, clickSendButton = false, sourceButtonId = null) {
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
  const tooltip = document.querySelector("#mem0-tooltip");
  if (tooltip) {
    tooltip.style.display = "none";
  }

  try {
    const data = await new Promise((resolve) => {
      chrome.storage.sync.get(
        ["apiKey", "userId", "access_token", "selected_org", "selected_project", "user_id", "similarity_threshold", "top_k"],
        function (items) {
          resolve(items);
        }
      );
    });

    const apiKey = data.apiKey;
    const userId = data.userId || data.user_id || "chrome-extension-user";
    const accessToken = data.access_token;
    const threshold = data.similarity_threshold !== undefined ? data.similarity_threshold : 0.3;
    const topK = data.top_k !== undefined ? data.top_k : 10;

    if (!apiKey && !accessToken) {
      // Show login popup instead of error message
      isProcessingMem0 = false;
      setButtonLoadingState(false);
      
      showLoginPopup();
      return;
    }

    // Now that we know the user is logged in, get the input
    const inputElement =
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector("textarea") ||
      document.querySelector('p[data-placeholder="How can I help you today?"]') ||
      document.querySelector('p[data-placeholder="Reply to Claude..."]');
    
    let message = getInputValue();
    
    if (!message || message.trim() === '') {
      console.error("No input message found");
      if (popup) {
        // Hide any existing tooltip first
        const tooltip = document.querySelector("#mem0-tooltip");
        if (tooltip) {
          tooltip.style.display = "none";
        }
        
        showPopup(popup, "Please enter some text first");
      }
      
      isProcessingMem0 = false;
      setButtonLoadingState(false);
      return;
    }

    // Now we can show the loading modal since we have text input
    createMemoryModal([], true, sourceButtonId);

    // Clean the message by removing any existing memory wrappers
    message = getContentWithoutMemories();

    const authHeader = accessToken
      ? `Bearer ${accessToken}`
      : `Token ${apiKey}`;

    const messages = getLastMessages(2);
    messages.push({ role: "user", content: message });

    // If clickSendButton is true, click the send button
    if (clickSendButton) {
      const sendButton = document.querySelector(
        'button[aria-label="Send Message"]'
      ) || document.querySelector(
        'button[aria-label="Send message"]'
      );
      
      if (sendButton) {
        setTimeout(() => {
          sendButton.click();
        }, 100);
      } else {
        console.error("Send button not found");
      }
    }

    const optionalParams = {}
    if(data.selected_org) {
      optionalParams.org_id = data.selected_org;
    }
    if(data.selected_project) {
      optionalParams.project_id = data.selected_project;
    }

    // Search API call
    const searchPayload = {
      query: message,
      filters: {
        user_id: userId,
      },
      rerank: true,
      threshold: threshold,
      top_k: topK,
      filter_memories: false,
      // llm_rerank: true,
      source: "OPENMEMORY_CHROME_EXTENSION",
      ...optionalParams,
    };
    
    const searchResponse = await fetch(
      "https://api.mem0.ai/v2/memories/search/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(searchPayload),
      }
    );

    if (!searchResponse.ok) {
      throw new Error(
        `API request failed with status ${searchResponse.status}`
      );
    }

    const responseData = await searchResponse.json();
    
    // Extract memories and their categories
    const memoryItems = responseData.map((item, index) => {
      return {
        id: `memory-${Date.now()}-${index}`,
        text: item.memory,
        categories: item.categories || []
      };
    });

    // Update the modal with the retrieved memories
    createMemoryModal(memoryItems, false, sourceButtonId);

    // New add memory API call (non-blocking)
    fetch("https://api.mem0.ai/v1/memories/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        messages: messages,
        user_id: userId,
        infer: true,
        metadata: {
          provider: "Claude",
        },
        source: "OPENMEMORY_CHROME_EXTENSION",
        ...optionalParams,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          console.error("Failed to add memory:", response.status);
        }
      })
      .catch((error) => {
        console.error("Error adding memory:", error);
      });
  } catch (error) {
    console.error("Error:", error);
    if (popup) showPopup(popup, "Failed to send message to Mem0");
  } finally {
    isProcessingMem0 = false;
    setButtonLoadingState(false);
  }
}

// Keep the original handleMem0Click function for backward compatibility
async function handleMem0Click(popup, clickSendButton = false) {
  // Call the new modal handling function
  await handleMem0Modal(popup, clickSendButton);
}

function getLastMessages(count) {
  const messageContainer = document.querySelector(
    ".flex-1.flex.flex-col.gap-3.px-4.max-w-3xl.mx-auto.w-full"
  );
  if (!messageContainer) return [];

  const messageElements = Array.from(messageContainer.children).reverse();
  const messages = [];

  for (const element of messageElements) {
    if (messages.length >= count) break;

    const userElement = element.querySelector(".font-user-message");
    const assistantElement = element.querySelector(".font-claude-message");

    if (userElement) {
      const content = userElement.textContent.trim();
      messages.unshift({ role: "user", content });
    } else if (assistantElement) {
      const content = assistantElement.textContent.trim();
      messages.unshift({ role: "assistant", content });
    }
  }

  return messages;
}

function setButtonLoadingState(isLoading) {
  const mem0Button = document.querySelector("#mem0-button");
  if (mem0Button) {
    if (isLoading) {
      mem0Button.disabled = true;
      document.body.style.cursor = "wait";
      mem0Button.style.cursor = "wait";
      mem0Button.style.opacity = "0.7";
    } else {
      mem0Button.disabled = false;
      document.body.style.cursor = "default";
      mem0Button.style.cursor = "pointer";
      mem0Button.style.opacity = "1";
    }
  }
}

function showPopup(popup, message) {
  // First hide all tooltips and popups
  const tooltip = document.querySelector("#mem0-tooltip");
  if (tooltip) {
    tooltip.style.display = "none";
  }
  
  // Also hide any other mem0-popup that might be visible
  const visiblePopups = document.querySelectorAll('.mem0-popup[style*="display: block"]');
  visiblePopups.forEach(p => {
    if (p !== popup) {
      p.style.display = "none";
    }
  });
  
  // Create and add the (i) icon
  const infoIcon = document.createElement("span");
  infoIcon.textContent = "ⓘ ";
  infoIcon.style.marginRight = "3px";

  popup.innerHTML = "";
  popup.appendChild(infoIcon);
  popup.appendChild(document.createTextNode(message));

  popup.style.display = "block";
  setTimeout(() => {
    popup.style.display = "none";
  }, 2000);
}

function getInputValue() {
  const inputElement =
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector("textarea") ||
    document.querySelector('p[data-placeholder="How can I help you today?"]') ||
    document.querySelector('p[data-placeholder="Reply to Claude..."]');
  
  if (!inputElement) return null;
  
  // For the p element placeholders specifically
  if (inputElement.tagName.toLowerCase() === 'p' && 
      (inputElement.getAttribute('data-placeholder') === 'How can I help you today?' ||
      inputElement.getAttribute('data-placeholder') === 'Reply to Claude...')) {
    return inputElement.textContent || '';
  }
  
  return inputElement.textContent || inputElement.value;
}

async function updateMemoryEnabled() {
  memoryEnabled = await getMemoryEnabledState();
  
  // If memory is disabled, remove the button completely
  if (memoryEnabled === false) {
    removeMemButton();
  } else {
    // If memory is enabled, ensure the button is added
    addMem0Button();
  }
}

function initializeMem0Integration() {
  updateMemoryEnabled();
  addMem0Button();

  document.addEventListener("keydown", function (event) {
    if (event.ctrlKey && event.key === "m") {
      event.preventDefault();
      if (memoryEnabled) {
        const popup = document.querySelector(".mem0-popup");
        if (popup) {
          (async () => {
            await handleMem0Modal(popup, false);
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

  // Observer for main structure changes
  observer = new MutationObserver((mutations) => {
    // Use debounce to avoid excessive calls to addMem0Button
    clearTimeout(observer.debounceTimeout);
    observer.debounceTimeout = setTimeout(() => {
      // Check memory enabled state before adding button
      getMemoryEnabledState().then(enabled => {
        if (enabled) {
          addMem0Button();
          updateNotificationDot();
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
      } else {
        removeMemButton();
      }
    });
  });
  
  // Find the input element and observe it
  function observeInput() {
    const inputElement = document.querySelector('div[contenteditable="true"]') || 
                        document.querySelector("textarea") ||
                        document.querySelector('p[data-placeholder="How can I help you today?"]') ||
                        document.querySelector('p[data-placeholder="Reply to Claude..."]');
    
    if (inputElement) {
      inputObserver.observe(inputElement, { 
        childList: true, 
        characterData: true, 
        subtree: true 
      });
    } else {
      // If no input element found, try again later
      setTimeout(observeInput, 1000);
    }
  }
  
  observeInput();

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "sync" && changes.memory_enabled) {
      updateMemoryEnabled();
    }
  });
  
  // Recheck for elements after page loads
  window.addEventListener('load', () => {
    getMemoryEnabledState().then(enabled => {
      if (enabled) {
        addMem0Button();
        updateNotificationDot();
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
    font-weight: 600;
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
  popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });
  
  // Add to body
  document.body.appendChild(popupOverlay);
}

// Function to capture and store memory asynchronously
async function captureAndStoreMemory() {
  // Check if memory is enabled
  const memoryEnabled = await getMemoryEnabledState();
  if (memoryEnabled === false) {
    return; // Don't process memories if disabled
  }

  // Find the input element (prioritizing the ProseMirror div with contenteditable="true")
  let inputElement = document.querySelector('div[contenteditable="true"].ProseMirror');
  
  // If ProseMirror not found, try other input elements
  if (!inputElement) {
    inputElement = document.querySelector('div[contenteditable="true"]') ||
                  document.querySelector("textarea") ||
                  document.querySelector('p[data-placeholder="How can I help you today?"]') ||
                  document.querySelector('p[data-placeholder="Reply to Claude..."]');
  }
  
  if (!inputElement) return;

  // Get raw content from the input element
  let message = '';
  if (inputElement.classList.contains('ProseMirror')) {
    // For ProseMirror, get the textContent for plain text
    message = inputElement.textContent || '';
  } else if (inputElement.tagName.toLowerCase() === "div") {
    message = inputElement.textContent || '';
  } else if (inputElement.tagName.toLowerCase() === "p") {
    message = inputElement.textContent || '';
  } else {
    message = inputElement.value || '';
  }

  if (!message || message.trim() === '') return;
  
  // Clean the message of any memory wrapper content
  message = getContentWithoutMemories();
  
  // For ProseMirror, the getContentWithoutMemories returns HTML, so we need to extract text
  if (inputElement.classList.contains('ProseMirror')) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = message;
    message = tempDiv.textContent || '';
  }
  
  // Skip if message is empty after cleaning
  if (!message || message.trim() === '') return;
  
  // Asynchronously store the memory
  chrome.storage.sync.get(
    ["apiKey", "userId", "access_token", "memory_enabled", "selected_org", "selected_project", "user_id"],
    function (items) {
      // Skip if memory is disabled or no credentials
      if (items.memory_enabled === false || (!items.apiKey && !items.access_token)) {
        return;
      }
      
      const authHeader = items.access_token
        ? `Bearer ${items.access_token}`
        : `Token ${items.apiKey}`;
      
      const userId = items.userId || items.user_id || "chrome-extension-user";
      
      // Get recent messages for context (if available)
      const messages = getLastMessages(2);
      messages.push({ role: "user", content: message });
      
      const optionalParams = {}

      if(items.selected_org) {
        optionalParams.org_id = items.selected_org;
      }
      if(items.selected_project) {
        optionalParams.project_id = items.selected_project;
      }

      // Send memory to mem0 API asynchronously without waiting for response
      fetch("https://api.mem0.ai/v1/memories/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          messages: messages,
          user_id: userId,
          infer: true,
          metadata: {
            provider: "Claude",
          },
          source: "OPENMEMORY_CHROME_EXTENSION",
          ...optionalParams,
        }),
      }).catch((error) => {
        console.error("Error saving memory:", error);
      });
    }
  );
}

// Function to update the notification dot
function updateNotificationDot() {
  // Find all Mem0 notification dots
  const notificationDots = document.querySelectorAll('#mem0-notification-dot');
  if (!notificationDots.length) return;
  
  // Find the input element (prioritizing the ProseMirror div with contenteditable="true")
  let inputElement = document.querySelector('div[contenteditable="true"].ProseMirror');
  
  // If ProseMirror not found, try other input elements
  if (!inputElement) {
    inputElement = document.querySelector('div[contenteditable="true"]') ||
                   document.querySelector("textarea") ||
                   document.querySelector('p[data-placeholder="How can I help you today?"]') ||
                   document.querySelector('p[data-placeholder="Reply to Claude..."]');
  }
  
  if (!inputElement) return;
  
  // Function to check if input has text
  const checkForText = () => {
    let hasText = false;
    
    // Check for text based on the input type
    if (inputElement.classList.contains('ProseMirror')) {
      // For ProseMirror, check if it has any content other than just a placeholder <p>
      const paragraphs = inputElement.querySelectorAll('p');
      
      // Check if there's text content or if there are multiple paragraphs (not just empty placeholder)
      const textContent = inputElement.textContent.trim();
      hasText = textContent !== '' || paragraphs.length > 1 || 
               (paragraphs.length === 1 && !paragraphs[0].classList.contains('is-empty'));
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
    attributeFilter: ['class'] 
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


function handleSyncClick() {
  if (isSyncing) return; // Prevent multiple clicks
  
  // First check if memory is enabled
  getMemoryEnabledState().then(enabled => {
    if (enabled === false) {
      return; // Don't show login popup if memory is disabled
    }
    
    // Get the sync button element
    const syncButton = document.querySelector("#sync-button");
    if (!syncButton) return;

    // Check if user is logged in
    chrome.storage.sync.get(["userLoggedIn", "access_token"], (data) => {
      if (!data.userLoggedIn || !data.access_token) {
        showLoginPopup();
        return;
      }

      // Show loading state and sync
      setSyncButtonLoadingState(true);
      
      // Get all messages for this conversation
      const messages = getLastMessages(999); // Get a large number to get all messages
      
      // Process messages and sync
      if (messages && messages.length > 0) {
        const memoriesToSync = [];
        
        // Process each message to extract memory content
        messages.forEach(message => {
          if (message.role === 'user' && message.content.trim()) {
            memoriesToSync.push({
              content: message.content,
              source: "Claude",
              timestamp: new Date().toISOString()
            });
          }
        });
        
        if (memoriesToSync.length > 0) {
          // Send memories to Mem0
          sendMemoriesToMem0(memoriesToSync)
            .then(result => {
              setSyncButtonLoadingState(false);
              if (result.success) {
                showSyncPopup(syncButton, `${memoriesToSync.length} memories synced`);
              } else {
                showSyncPopup(syncButton, "Sync failed");
              }
            })
            .catch(error => {
              console.error("Error syncing memories:", error);
              setSyncButtonLoadingState(false);
              showSyncPopup(syncButton, "Sync failed");
            });
        } else {
          setSyncButtonLoadingState(false);
          showSyncPopup(syncButton, "No memories to sync");
        }
      } else {
        setSyncButtonLoadingState(false);
        showSyncPopup(syncButton, "No messages found");
      }
    });
  });
}

function setSyncButtonLoadingState(isLoading) {
  isSyncing = isLoading;
  const syncButton = document.querySelector("#sync-button");
  const syncButtonContent = document.querySelector("#sync-button-content");
  
  if (!syncButton || !syncButtonContent) return;
  
  if (isLoading) {
    syncButton.style.opacity = "0.7";
    syncButton.style.cursor = "default";
    syncButtonContent.innerHTML = `
      <div class="sync-loading-spinner"></div>
      <span style="margin-left: 8px;">Syncing...</span>
    `;
    
    // Add the spinner animation styles if they don't exist
    if (!document.getElementById('sync-spinner-styles')) {
      const spinnerStyles = document.createElement('style');
      spinnerStyles.id = 'sync-spinner-styles';
      spinnerStyles.innerHTML = `
        .sync-loading-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(128, 221, 162, 0.3);
          border-radius: 50%;
          border-top-color: rgb(128, 221, 162);
          animation: sync-spinner 0.8s linear infinite;
        }
        
        @keyframes sync-spinner {
          to {
            transform: rotate(360deg);
          }
        }
      `;
      document.head.appendChild(spinnerStyles);
    }
  } else {
    syncButton.style.opacity = "1";
    syncButton.style.cursor = "pointer";
    syncButtonContent.innerHTML = "Sync";
  }
}

function showSyncPopup(button, message) {
  // Create popup if it doesn't exist
  let popup = document.getElementById("sync-status-popup");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "sync-status-popup";
    popup.style.cssText = `
      position: fixed;
      background-color: #21201C;
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      z-index: 10000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      display: none;
      transition: opacity 0.2s;
    `;
    document.body.appendChild(popup);
  }
  
  // Position the popup above the button
  const buttonRect = button.getBoundingClientRect();
  popup.style.left = `${buttonRect.left + buttonRect.width/2 - 75}px`; // 75px is half of estimated popup width
  popup.style.top = `${buttonRect.top - 40}px`;
  
  // Set message and show
  popup.textContent = message;
  popup.style.display = "block";
  popup.style.opacity = "1";
  
  // Hide after delay
  setTimeout(() => {
    popup.style.opacity = "0";
    setTimeout(() => {
      popup.style.display = "none";
    }, 200);
  }, 2000);
}

async function sendMemoriesToMem0(memories) {
  if (!memories || memories.length === 0) {
    return { success: false, message: "No memories to send" };
  }

  try {
    // Get user credentials from storage
    const data = await new Promise(resolve => {
      chrome.storage.sync.get(["access_token", "userId", "selected_org", "selected_project", "user_id"], resolve);
    });

    if (!data.access_token) {
      return { success: false, message: "Not authenticated" };
    }

    const userId = data.userId || data.user_id || "chrome-extension-user";

    const optionalParams = {}
    if(data.selected_org) {
      optionalParams.org_id = data.selected_org;
    }
    if(data.selected_project) {
      optionalParams.project_id = data.selected_project;
    }
    
    // Send all memories in one batch
    const response = await fetch("https://api.mem0.ai/memories/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.access_token}`,
      },
      body: JSON.stringify({
        userId: userId,
        memories: memories,
        source: "OPENMEMORY_CHROME_EXTENSION",
        ...optionalParams,
      }),
    });

    if (response.ok) {
      return { success: true, message: "Memories synced successfully" };
    } else {
      return { 
        success: false, 
        message: `Error: ${response.status} ${response.statusText}` 
      };
    }
  } catch (error) {
    console.error("Error sending memories to Mem0:", error);
    return { 
      success: false, 
      message: `Error: ${error.message}` 
    };
  }
}

initializeMem0Integration();
