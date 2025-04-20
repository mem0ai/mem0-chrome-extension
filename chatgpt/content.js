let isProcessingMem0 = false;

// Initialize the MutationObserver variable
let observer;
let memoryModalShown = false;

// Global variable to store all memories
let allMemories = [];

// function createPopup(container) {
//   const popup = document.createElement("div");
//   popup.className = "mem0-popup";
//   popup.style.cssText = `
//         display: none;
//         position: absolute;
//         background-color: #171717;
//         color: white;
//         padding: 6px 8px;
//         border-radius: 6px;
//         font-size: 12px;
//         z-index: 10000;
//         bottom: 100%;
//         left: 50%;
//         transform: translateX(-50%);
//         margin-bottom: 11px;
//         white-space: nowrap;
//         box-shadow: 0 2px 5px rgba(0,0,0,0.2);
//     `;
//   container.appendChild(popup);
//   return popup;
// }

// function addMem0Button() {
//   const sendButton = document.querySelector('button[aria-label="Send prompt"]');

//   if (sendButton && !document.querySelector("#mem0-button")) {
//     const sendButtonContainer = sendButton.parentElement.parentElement;

//     const mem0ButtonContainer = document.createElement("div");
//     mem0ButtonContainer.style.position = "relative";
//     mem0ButtonContainer.style.display = "inline-block";

//     const mem0Button = document.createElement("img");
//     mem0Button.id = "mem0-button";
//     mem0Button.src = chrome.runtime.getURL("icons/mem0-claude-icon-purple.png");
//     mem0Button.style.width = "20px";
//     mem0Button.style.height = "20px";
//     mem0Button.style.cursor = "pointer";
//     mem0Button.style.padding = "8px";
//     mem0Button.style.borderRadius = "5px";
//     mem0Button.style.transition = "filter 0.3s ease, opacity 0.3s ease";
//     mem0Button.style.boxSizing = "content-box";
//     mem0Button.style.marginBottom = "1px";

//     const popup = createPopup(mem0ButtonContainer);

//     mem0Button.addEventListener("click", () => handleMem0Click(popup));

//     mem0Button.addEventListener("mouseenter", () => {
//       if (!mem0Button.disabled) {
//         mem0Button.style.filter = "brightness(70%)";
//         tooltip.style.visibility = "visible";
//         tooltip.style.opacity = "1";
//       }
//     });
//     mem0Button.addEventListener("mouseleave", () => {
//       mem0Button.style.filter = "none";
//       tooltip.style.visibility = "hidden";
//       tooltip.style.opacity = "0";
//     });

//     const tooltip = document.createElement("div");
//     tooltip.textContent = "Add related memories";
//     tooltip.style.visibility = "hidden";
//     tooltip.style.backgroundColor = "black";
//     tooltip.style.color = "white";
//     tooltip.style.textAlign = "center";
//     tooltip.style.borderRadius = "4px";
//     tooltip.style.padding = "3px 6px";
//     tooltip.style.position = "absolute";
//     tooltip.style.zIndex = "1";
//     tooltip.style.top = "calc(100% + 5px)";
//     tooltip.style.left = "50%";
//     tooltip.style.transform = "translateX(-50%)";
//     tooltip.style.whiteSpace = "nowrap";
//     tooltip.style.opacity = "0";
//     tooltip.style.transition = "opacity 0.3s";
//     tooltip.style.fontSize = "12px";

//     mem0ButtonContainer.appendChild(mem0Button);
//     mem0ButtonContainer.appendChild(tooltip);

//     // Insert the mem0Button before the sendButton
//     sendButtonContainer.insertBefore(
//       mem0ButtonContainer,
//       sendButtonContainer.children[1]
//     );

//     // Function to update button states
//     function updateButtonStates() {
//       const inputElement =
//         document.querySelector('div[contenteditable="true"]') ||
//         document.querySelector("textarea");
//       const hasText =
//         inputElement && inputElement.textContent.trim().length > 0;

//       mem0Button.disabled = !hasText;

//       if (hasText) {
//         mem0Button.style.opacity = "1";
//         mem0Button.style.pointerEvents = "auto";
//       } else {
//         mem0Button.style.opacity = "0.5";
//         mem0Button.style.pointerEvents = "none";
//       }
//     }

//     // Initial update
//     updateButtonStates();

//     // Listen for input changes
//     const inputElement =
//       document.querySelector('div[contenteditable="true"]') ||
//       document.querySelector("textarea");
//     if (inputElement) {
//       inputElement.addEventListener("input", updateButtonStates);
//     }
//   }
// }

// Add a new function to create a memory modal similar to the screenshot
function createMemoryModal(memoryItems) {
  if (memoryModalShown) {
    return;
  }

  memoryModalShown = true;
  let currentMemoryIndex = 0;

  // Get the text input element position
  const inputElement = document.querySelector('div[contenteditable="true"]') || 
                       document.querySelector("textarea");
  
  if (!inputElement) {
    console.error("Input element not found");
    return;
  }
  
  // Get the position and dimensions of the input field
  const inputRect = inputElement.getBoundingClientRect();
  
  // Calculate modal dimensions (estimated)
  const modalWidth = 447;
  const modalHeight = 320;
  
  // Determine if there's enough space below the input field
  const viewportHeight = window.innerHeight;
  const spaceBelow = viewportHeight - inputRect.bottom;
  const spaceAbove = inputRect.top;
  
  // Decide whether to place modal above or below based on available space
  // Prefer below if there's enough space
  const placeBelow = spaceBelow >= modalHeight; 
  
  // Position the modal aligned to the right of the input
  const rightEdge = inputRect.right - 20; // 20px offset from right edge
  let topPosition;
  
  if (placeBelow) {
    // Place below the input
    topPosition = inputRect.bottom + 10;
      } else {
    // Place above the input if not enough space below
    topPosition = inputRect.top - modalHeight - 10;
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
  
  // Add event listener to close modal when clicking outside
  modalOverlay.addEventListener('click', (event) => {
    // Only close if clicking directly on the overlay, not its children
    if (event.target === modalOverlay) {
      closeModal();
    }
  });

  // Create modal container with positioning
  const modalContainer = document.createElement('div');
  
  // Position the modal aligned to the right of the input and either above or below
  modalContainer.style.cssText = `
    background-color: #18181B;
    border-radius: 12px;
    width: ${modalWidth}px;
    max-height: ${modalHeight}px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    color: white;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    position: absolute;
    top: ${topPosition}px;
    left: ${Math.max(rightEdge - modalWidth, 10)}px;
    pointer-events: auto;
    border: 1px solid #27272A;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Create modal header
  const modalHeader = document.createElement('div');
  modalHeader.style.cssText = `
    display: flex;
    align-items: center;
    padding: 12px 20px;
    position: relative;
    background-color: #27272A;
    border-bottom: 1px solid #27272A;
    justify-content: space-between;
  `;

  // Create header left section with logo and title
  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
  `;

  // Add Mem0 logo and title to header
  const logoImg = document.createElement('img');
  logoImg.src = chrome.runtime.getURL("icons/mem0-claude-icon.png");
  logoImg.style.cssText = `
    width: 14px;
    height: 14px;
    margin-right: -7px;
  `;

  const title = document.createElement('div');
  title.textContent = 'Openmemory';
  title.style.cssText = `
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.03em;
    color: #FFFFFF;
  `;

  // Create header right section with Add memories button
  const headerRight = document.createElement('div');
  headerRight.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 16px;
  `;
  
  const addMemoriesButton = document.createElement('div');
  addMemoriesButton.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 6px 8px 6px 6px;
    gap: 4px;
    border: 0.91358px solid #3B3B3F;
    border-radius: 6px;
    cursor: pointer;
  `;
  
  const addMemoriesText = document.createElement('div');
  addMemoriesText.textContent = `Add ${memoryItems.length} ${memoryItems.length === 1 ? 'memory' : 'memories'}`;
  addMemoriesText.style.cssText = `
    font-size: 11px;
    font-weight: 500;
    color: #A1A1AA;
    letter-spacing: -0.03em;
  `;
  
  const checkIcon = document.createElement('div');
  checkIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="#A1A1AA"/>
  </svg>`;
  checkIcon.style.cursor = "pointer";
  
  // Add click event listener to the entire addMemoriesButton
  addMemoriesButton.addEventListener('click', () => {
    // Add all memories to the input field
    applyMemoriesToInput(memoryItems.map(item => item.text));
    closeModal();
  });
  
  const closeIcon = document.createElement('div');
  closeIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="#8D8D8D"/>
  </svg>`;
  closeIcon.style.cursor = "pointer";
  
  closeIcon.addEventListener('click', () => {
    closeModal();
  });
  
  // Assemble header
  addMemoriesButton.appendChild(addMemoriesText);
  addMemoriesButton.appendChild(checkIcon);
  headerRight.appendChild(addMemoriesButton);
  headerRight.appendChild(closeIcon);
  
  headerLeft.appendChild(logoImg);
  headerLeft.appendChild(title);
  
  modalHeader.appendChild(headerLeft);
  modalHeader.appendChild(headerRight);

  // Content section
  const contentSection = document.createElement('div');
  contentSection.style.cssText = `
    display: flex;
    flex-direction: column;
    padding: 12px 12px 20px;
    border-bottom: 1px solid #27272A;
    gap: 10px;
  `;

  // Create category section - will be populated in updateCategorySection function
  const categorySection = document.createElement('div');
  categorySection.style.cssText = `
    display: flex;
    gap: 8px;
  `;

  // Helper function to update category section with categories of current memory
  function updateCategorySection(categories) {
    // Clear previous categories
    categorySection.innerHTML = '';
    
    // If no categories, show a default "Uncategorized" category
    if (!categories || categories.length === 0) {
      categories = ['Uncategorized'];
    }
    
    // Create category pills for the current memory - styled like the image
    categories.forEach(category => {
      const categoryPill = document.createElement('div');
      categoryPill.style.cssText = `
        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center;
        padding: 4px 8px;
        gap: 3px;
        background-color: #166534;
        color: #DCFCE7;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: -0.03em;
      `;
      
      categoryPill.textContent = category;
      categorySection.appendChild(categoryPill);
    });
  }
  
  // Create memories content container
  const memoriesContent = document.createElement('div');
  memoriesContent.style.cssText = `
    display: flex;
    flex-direction: row;
    padding: 0;
    flex-grow: 1;
  `;

  // Function to show the current memory
  function showCurrentMemory() {
    // Clear previous content
    memoriesContent.innerHTML = '';
    
    if (memoryItems.length === 0) return;
    
    const currentMemory = memoryItems[currentMemoryIndex];
    
    // Update category section with categories of the current memory
    updateCategorySection(currentMemory.categories);
    
    // Create memory container
    const memoryContainer = document.createElement('div');
    memoryContainer.style.cssText = `
      display: flex;
      flex-direction: row;
      justify-content: center;
      align-items: center;
      padding: 12px;
      gap: 12px;
      background-color: #27272A;
      border-radius: 9px;
      width: 100%;
    `;
    
    // Create blue vertical bar
    const blueBar = document.createElement('div');
    blueBar.style.cssText = `
      width: 2px;
      height: 60px;
      background-color: #1E40AF;
      box-shadow: 2px 0px 10px rgba(147, 51, 234, 0.32);
      border-radius: 23px;
    `;
    
    // Create memory text container
    const memoryTextContainer = document.createElement('div');
    memoryTextContainer.style.cssText = `
      font-size: 14px;
      line-height: 140%;
      font-weight: 500;
      letter-spacing: -0.03em;
      color: white;
      flex-grow: 1;
    `;

    const memoryText = document.createElement('div');
    memoryText.textContent = `"${currentMemory.text}"`;
    
    memoryTextContainer.appendChild(memoryText);
    memoryContainer.appendChild(blueBar);
    memoryContainer.appendChild(memoryTextContainer);
    memoriesContent.appendChild(memoryContainer);
  }

  // Create footer
  const modalFooter = document.createElement('div');
  modalFooter.style.cssText = `
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 20px 12px;
  `;

  // Create "View all memories" button
  const viewAllBtn = document.createElement('a');
  viewAllBtn.href = 'https://app.mem0.ai/dashboard/memories';
  viewAllBtn.target = '_blank';
  viewAllBtn.style.cssText = `
    box-sizing: border-box;
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 6px 8px 6px 6px;
    gap: 4px;
    width: 121px;
    height: 24px;
    border: 0.91358px solid #27272A;
    border-radius: 6px;
    text-decoration: none;
    margin: 0 auto;
  `;

  const viewAllIcon = document.createElement('span');
  viewAllIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 6H6C4.89543 6 4 6.89543 4 8V18C4 19.1046 4.89543 20 6 20H16C17.1046 20 18 19.1046 18 18V14M14 4H20M20 4V10M20 4L10 14" stroke="#71717A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  
  const viewAllText = document.createElement('span');
  viewAllText.textContent = 'View all memories';
  viewAllText.style.cssText = `
    font-size: 11px;
    font-weight: 500;
    color: #71717A;
    letter-spacing: -0.03em;
  `;

  viewAllBtn.appendChild(viewAllText);
  viewAllBtn.appendChild(viewAllIcon);

  // Create button container for Skip and Add to Prompt
  const buttonsContainer = document.createElement('div');
  buttonsContainer.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    margin: 0 auto;
  `;

  // Create "Skip" button
  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'Skip';
  skipBtn.style.cssText = `
    padding: 8px 16px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: -0.03em;
    color: #A1A1AA;
    background: none;
    border: none;
    cursor: pointer;
    border-radius: 8px;
  `;
  
  skipBtn.addEventListener('click', () => {
    // Changed skip behavior: move to next memory instead of closing
    if (memoryItems.length > 1) {
      currentMemoryIndex = (currentMemoryIndex + 1) % memoryItems.length;
      showCurrentMemory();
    } else {
      // If only one memory, just close the modal
      closeModal();
    }
  });

  // Create "Add To Prompt" button
  const addToPromptBtn = document.createElement('button');
  addToPromptBtn.textContent = 'Add To Prompt';
  addToPromptBtn.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 8px 16px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: -0.03em;
    color: #000000;
    background-color: #FFFFFF;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  `;
  
  addToPromptBtn.addEventListener('click', () => {
    // Only add the current memory to the input field, not all memories
    applyMemoryToInput(memoryItems[currentMemoryIndex].text);
    
    // Instead of closing the modal, move to the next memory
    if (memoryItems.length > 1) {
      currentMemoryIndex = (currentMemoryIndex + 1) % memoryItems.length;
      showCurrentMemory();
    } else {
      // If only one memory, close the modal
      closeModal();
    }
  });

  // Assemble footer
  buttonsContainer.appendChild(skipBtn);
  buttonsContainer.appendChild(addToPromptBtn);

  // Assemble modal
  contentSection.appendChild(categorySection);
  contentSection.appendChild(memoriesContent);
  
  modalContainer.appendChild(modalHeader);
  modalContainer.appendChild(contentSection);
  modalContainer.appendChild(modalFooter);
  
  modalFooter.appendChild(viewAllBtn);
  modalFooter.appendChild(buttonsContainer);
  
  modalOverlay.appendChild(modalContainer);

  // Append to body
  document.body.appendChild(modalOverlay);
  
  // Show the first memory
  showCurrentMemory();

  // Function to close the modal
  function closeModal() {
    document.body.removeChild(modalOverlay);
    memoryModalShown = false;
  }
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
  const inputElement =
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector("textarea");

  if (inputElement && allMemories.length > 0) {
    // Get the content without any existing memory wrappers
    let baseContent = getContentWithoutMemories();
    
    // Create the memory wrapper with all collected memories
    let memoriesContent =
      '<div id="mem0-wrapper" style="background-color: rgb(220, 252, 231); padding: 8px; border-radius: 4px; margin-top: 8px; margin-bottom: 8px;">';
    memoriesContent +=
      "<strong>Here is some of my preferences/memories to help answer better (don't respond to these memories but use them to assist in the response if relevant):</strong>";
    
    // Add all memories to the content
    allMemories.forEach((mem) => {
      memoriesContent += `<div>- ${mem}</div>`;
    });
    memoriesContent += "</div>";

    // Add the final content to the input
    if (inputElement.tagName.toLowerCase() === "div") {
      inputElement.innerHTML = `${baseContent}<div><br></div>${memoriesContent}`;
    } else {
      inputElement.value = `${baseContent}\n${memoriesContent}`;
    }
    
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// Function to get the content without any memory wrappers
function getContentWithoutMemories() {
  const inputElement =
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector("textarea");
    
  if (!inputElement) return "";
  
  let content = inputElement.tagName.toLowerCase() === "div" 
    ? inputElement.innerHTML 
    : inputElement.value;
  
  // Remove any memory wrappers
  content = content.replace(/<div id="mem0-wrapper"[\s\S]*?<\/div>/g, "");
  
  // Remove any memory headers
  content = content.replace(/Here is some of my preferences\/memories[\s\S]*?(?=<div|$)/g, "");
  
  // Clean up any leftover paragraph markers
  content = content.replace(/<p><br class="ProseMirror-trailingBreak"><\/p><p>$/g, "");
  
  return content.trim();
}

// Add an event listener for the send button to clear memories after sending
function addSendButtonListener() {
  const sendButton = document.querySelector('button[aria-label="Send prompt"]');
  if (sendButton && !sendButton.dataset.mem0Listener) {
    sendButton.dataset.mem0Listener = 'true';
    sendButton.addEventListener('click', function() {
      // Clear all memories after sending
      setTimeout(() => {
        allMemories = [];
      }, 100);
    });
    
    // Also handle Enter key press
    const inputElement = document.querySelector('div[contenteditable="true"]') || 
                         document.querySelector("textarea");
    if (inputElement && !inputElement.dataset.mem0KeyListener) {
      inputElement.dataset.mem0KeyListener = 'true';
      inputElement.addEventListener('keydown', function(event) {
        // Check if Enter was pressed without Shift (standard send behavior)
        if (event.key === 'Enter' && !event.shiftKey) {
          // Clear all memories after sending
          setTimeout(() => {
            allMemories = [];
          }, 100);
        }
      });
    }
  }
}

// Function to add the Mem0 button next to the mic icon
function addMem0IconButton() {
  // Fix the selector to find the mic container
  const micContainer = document.querySelector('div.absolute.end-3.bottom-0 div.ms-auto');
  
  if (micContainer && !document.querySelector('#mem0-icon-button')) {
    // Clone the mic button structure
    const micButton = micContainer.querySelector('button[aria-label="Dictate button"]');
    if (micButton) {
      const mem0ButtonContainer = document.createElement('span');
      mem0ButtonContainer.className = '';
      mem0ButtonContainer.dataset.state = 'closed';
      
      const mem0Button = document.createElement('button');
      mem0Button.id = 'mem0-icon-button';
      mem0Button.className = 'btn relative btn-primary btn-small flex items-center justify-center rounded-full border border-token-border-default p-1 text-token-text-secondary focus-visible:outline-black dark:text-token-text-secondary dark:focus-visible:outline-white bg-transparent dark:bg-transparent can-hover:hover:bg-token-main-surface-secondary dark:hover:bg-transparent dark:hover:opacity-100 h-9 min-h-9 w-9 min-w-9';
      mem0Button.setAttribute('aria-label', 'Mem0 button');
      mem0Button.type = 'button';
      
      const iconContainer = document.createElement('div');
      iconContainer.className = 'flex items-center justify-center';
      
      const icon = document.createElement('img');
      icon.src = chrome.runtime.getURL('icons/mem0-claude-icon-p.png');
      icon.className = 'h-[18px] w-[18px]';
      icon.style.borderRadius = '50%';
      
      iconContainer.appendChild(icon);
      mem0Button.appendChild(iconContainer);
      mem0ButtonContainer.appendChild(mem0Button);
      
      // Insert before the mic button
      micContainer.insertBefore(mem0ButtonContainer, micContainer.firstChild);
      
      // Add click event listener
      mem0Button.addEventListener('click', async () => {
        try {
          const memoryEnabled = await getMemoryEnabledState();
          if (memoryEnabled) {
            // Call handleMem0Modal
            await handleMem0Modal();
          }
        } catch (error) {
          console.error('Error handling Mem0 button click:', error);
        }
      });
    }
  }
  
  // Add send button listener
  addSendButtonListener();
}

// Modified function to handle Mem0 modal instead of direct injection
async function handleMem0Modal() {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    return;
  }

  const inputElement =
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector("textarea");
  let message = getInputValue();
  if (!message) {
    console.error("No input message found");
    return;
  }

  const memInfoRegex =
    /\s*Here is some of my preferences\/memories to help answer better (don't respond to these memories but use them to assist in the response if relevant):[\s\S]*$/;
  message = message.replace(memInfoRegex, "").trim();
  const endIndex = message.indexOf("</p>");
  if (endIndex !== -1) {
    message = message.slice(0, endIndex + 4);
  }

  if (isProcessingMem0) {
    return;
  }

  isProcessingMem0 = true;

  try {
    const data = await new Promise((resolve) => {
      chrome.storage.sync.get(
        ["apiKey", "userId", "access_token"],
        function (items) {
          resolve(items);
        }
      );
    });

    const apiKey = data.apiKey;
    const userId = data.userId || "chrome-extension-user";
    const accessToken = data.access_token;

    if (!apiKey && !accessToken) {
      isProcessingMem0 = false;
      return;
    }

    const authHeader = accessToken
      ? `Bearer ${accessToken}`
      : `Token ${apiKey}`;

    const messages = getLastMessages(2);
    messages.push({ role: "user", content: message });

    // Existing search API call
    const searchResponse = await fetch(
      "https://api.mem0.ai/v1/memories/search/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          query: message,
          user_id: userId,
          rerank: false,
          threshold: 0.3,
          limit: 10, // Show more memories instead of just 3
          filter_memories: true,
        }),
      }
    );

    if (!searchResponse.ok) {
      throw new Error(
        `API request failed with status ${searchResponse.status}`
      );
    }

    const responseData = await searchResponse.json();

    // Extract memories and their categories
    const memoryItems = responseData.map(item => {
      return {
        text: item.memory,
        categories: item.categories || []
      };
    });

    if (memoryItems.length > 0) {
      // Show the memory modal instead of directly injecting
      createMemoryModal(memoryItems);
        } else {
      // No memories found, display a message
      alert("No relevant memories found");
    }

    // Proceed with adding memory asynchronously without awaiting
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
          provider: "ChatGPT",
        },
      }),
    }).catch((error) => {
      console.error("Error adding memory:", error);
    });
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    isProcessingMem0 = false;
  }
}

// Update the initialization function to add the Mem0 icon button but not intercept Enter key
function initializeMem0Integration() {
  document.addEventListener("DOMContentLoaded", () => {
    addSyncButton();
    addMem0IconButton();
    addSendButtonListener();
  });

  document.addEventListener("keydown", function (event) {
    if (event.ctrlKey && event.key === "m") {
      event.preventDefault();
      (async () => {
        await handleMem0Modal();
      })();
    }
  });

  observer = new MutationObserver(() => {
    addSyncButton();
    addMem0IconButton();
    addSendButtonListener();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Add a MutationObserver to watch for changes in the DOM but don't intercept Enter key
  const observerForUI = new MutationObserver(() => {
    addMem0IconButton();
    addSendButtonListener();
  });

  observerForUI.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function getLastMessages(count) {
  const messageContainer = document.querySelector(
    ".flex.flex-col.text-sm.md\\:pb-9"
  );
  if (!messageContainer) return [];

  const messageElements = Array.from(messageContainer.children).reverse();
  const messages = [];

  for (const element of messageElements) {
    if (messages.length >= count) break;

    const userElement = element.querySelector(
      '[data-message-author-role="user"]'
    );
    const assistantElement = element.querySelector(
      '[data-message-author-role="assistant"]'
    );

    if (userElement) {
      const content = userElement
        .querySelector(".whitespace-pre-wrap")
        .textContent.trim();
      messages.unshift({ role: "user", content });
    } else if (assistantElement) {
      const content = assistantElement
        .querySelector(".markdown")
        .textContent.trim();
      messages.unshift({ role: "assistant", content });
    }
  }

  return messages;
}

function showPopup(popup, message) {
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

function getInputValue() {
  const inputElement =
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector("textarea");
  return inputElement ? inputElement.textContent || inputElement.value : null;
}

function addSyncButton() {
  const buttonContainer = document.querySelector("div.mt-5.flex.justify-end");
  if (buttonContainer) {
    let syncButton = document.querySelector("#sync-button");

    // If the syncButton does not exist, create it
    if (!syncButton) {
      syncButton = document.createElement("button");
      syncButton.id = "sync-button";
      syncButton.className = "btn relative btn-neutral mr-2";
      syncButton.style.color = "#b4844a";
      syncButton.style.backgroundColor = "transparent";
      syncButton.innerHTML =
        '<div id="sync-button-content" class="flex items-center justify-center font-normal">Sync</div>';
      syncButton.style.border = "1px solid #b4844a";

      const syncIcon = document.createElement("img");
      syncIcon.src = chrome.runtime.getURL("icons/mem0-icon.png");
      syncIcon.style.width = "16px";
      syncIcon.style.height = "16px";
      syncIcon.style.marginRight = "8px";

      syncButton.prepend(syncIcon);

      syncButton.addEventListener("click", handleSyncClick);

      syncButton.addEventListener("mouseenter", () => {
        if (!syncButton.disabled) {
          syncButton.style.filter = "opacity(0.7)";
        }
      });
      syncButton.addEventListener("mouseleave", () => {
        if (!syncButton.disabled) {
          syncButton.style.filter = "opacity(1)";
        }
      });
    }

    if (!buttonContainer.contains(syncButton)) {
      buttonContainer.insertBefore(syncButton, buttonContainer.firstChild);
    }

    // Optionally, handle the disabled state
    function updateSyncButtonState() {
      // Define when the sync button should be enabled or disabled
      syncButton.disabled = false; // For example, always enabled
      // Update opacity or pointer events if needed
      if (syncButton.disabled) {
        syncButton.style.opacity = "0.5";
        syncButton.style.pointerEvents = "none";
      } else {
        syncButton.style.opacity = "1";
        syncButton.style.pointerEvents = "auto";
      }
    }

    updateSyncButtonState();
  } else {
    // If resetMemoriesButton or specificTable is not found, remove syncButton from DOM
    const existingSyncButton = document.querySelector("#sync-button");
    if (existingSyncButton && existingSyncButton.parentNode) {
      existingSyncButton.parentNode.removeChild(existingSyncButton);
    }
  }
}

function handleSyncClick() {
  getMemoryEnabledState().then((memoryEnabled) => {
    if (!memoryEnabled) {
      showSyncPopup(
        document.querySelector("#sync-button"),
        "Memory is disabled"
      );
      return;
    }

    const table = document.querySelector(
      "table.w-full.border-separate.border-spacing-0"
    );
    const syncButton = document.querySelector("#sync-button");

    if (table && syncButton) {
      const rows = table.querySelectorAll("tbody tr");
      let memories = [];

      // Change sync button state to loading
      setSyncButtonLoadingState(true);

      let syncedCount = 0;
      const totalCount = rows.length;

      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 1) {
          const content = cells[0]
            .querySelector("div.whitespace-pre-wrap")
            .textContent.trim();

          const memory = {
            role: "user",
            content: `Remember this about me: ${content}`,
          };

          memories.push(memory);

          sendMemoryToMem0(memory)
            .then(() => {
              syncedCount++;
              if (syncedCount === totalCount) {
                showSyncPopup(syncButton, `${syncedCount} memories synced`);
                setSyncButtonLoadingState(false);
              }
            })
            .catch((error) => {
              if (syncedCount === totalCount) {
                showSyncPopup(
                  syncButton,
                  `${syncedCount}/${totalCount} memories synced`
                );
                setSyncButtonLoadingState(false);
              }
            });
        }
      });

      sendMemoriesToMem0(memories)
        .then(() => {
          showSyncPopup(syncButton, `${memories.length} memories synced`);
          setSyncButtonLoadingState(false);
        })
        .catch((error) => {
          console.error("Error syncing memories:", error);
          showSyncPopup(syncButton, "Error syncing memories");
          setSyncButtonLoadingState(false);
        });
    } else {
      console.error("Table or Sync button not found");
    }
  });
}

// New function to send memories in batch
function sendMemoriesToMem0(memories) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(
      ["apiKey", "userId", "access_token"],
      function (items) {
        if ((items.apiKey || items.access_token) && items.userId) {
          const authHeader = items.access_token
            ? `Bearer ${items.access_token}`
            : `Token ${items.apiKey}`;
          fetch("https://api.mem0.ai/v1/memories/", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: authHeader,
            },
            body: JSON.stringify({
              messages: memories,
              user_id: items.userId,
              infer: true,
              metadata: {
                provider: "ChatGPT",
              },
            }),
          })
            .then((response) => {
              if (!response.ok) {
                reject(`Failed to add memories: ${response.status}`);
              } else {
                resolve();
              }
            })
            .catch((error) =>
              reject(`Error sending memories to Mem0: ${error}`)
            );
        } else {
          reject("API Key/Access Token or User ID not set");
        }
      }
    );
  });
}

function setSyncButtonLoadingState(isLoading) {
  const syncButton = document.querySelector("#sync-button");
  const syncButtonContent = document.querySelector("#sync-button-content");
  if (syncButton) {
    if (isLoading) {
      syncButton.disabled = true;
      syncButton.style.cursor = "wait";
      document.body.style.cursor = "wait";
      syncButton.style.opacity = "0.7";
      syncButtonContent.textContent = "Syncing...";
    } else {
      syncButton.disabled = false;
      syncButton.style.cursor = "pointer";
      syncButton.style.opacity = "1";
      document.body.style.cursor = "default";
      syncButtonContent.textContent = "Sync";
    }
  }
}

function showSyncPopup(button, message) {
  const popup = document.createElement("div");

  // Create and add the (i) icon
  const infoIcon = document.createElement("span");
  infoIcon.textContent = "ⓘ ";
  infoIcon.style.marginRight = "3px";

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

  button.style.position = "relative";
  button.appendChild(popup);

  setTimeout(() => {
    popup.remove();
  }, 3000);
}

function sendMemoryToMem0(memory) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(
      ["apiKey", "userId", "access_token"],
      function (items) {
        if ((items.apiKey || items.access_token) && items.userId) {
          const authHeader = items.access_token
            ? `Bearer ${items.access_token}`
            : `Token ${items.apiKey}`;
          fetch("https://api.mem0.ai/v1/memories/", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: authHeader,
            },
            body: JSON.stringify({
              messages: [{ content: memory.content, role: "user" }],
              user_id: items.userId,
              infer: true,
              metadata: {
                provider: "ChatGPT",
              },
            }),
          })
            .then((response) => {
              if (!response.ok) {
                reject(`Failed to add memory: ${response.status}`);
              } else {
                resolve();
              }
            })
            .catch((error) => reject(`Error sending memory to Mem0: ${error}`));
        } else {
          reject("API Key/Access Token or User ID not set");
        }
      }
    );
  });
}

// Add this new function to get the memory_enabled state
function getMemoryEnabledState() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["memory_enabled"], function (result) {
      resolve(result.memory_enabled !== false); // Default to true if not set
    });
  });
}

initializeMem0Integration();
