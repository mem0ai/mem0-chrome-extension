let lastInputValue = "";
let inputObserver = null;
// Add global variables for memory modal
let memoryModalShown = false;
let allMemories = [];
// Add a variable to track the submit button observer
let submitButtonObserver = null;

function getTextarea() {
  return (
    document.querySelector('textarea[placeholder="Ask anything…"]')
  );
}

// Function to add the mem0 button to the UI
function addMem0Button() {
  // Check for the model selection button to find the right area
  const modelSelectionButton = document.querySelector('button[aria-label="Choose a model"]');
  
  if (!modelSelectionButton) {
    // If the button isn't found yet, retry after a short delay
    setTimeout(addMem0Button, 500);
    return;
  }
  
  // Find the container div that holds the buttons
  const buttonContainer = modelSelectionButton.closest('.bg-background.dark\\:bg-offsetDark.flex.items-center.justify-self-end.rounded-full');
  
  if (!buttonContainer) {
    setTimeout(addMem0Button, 500);
    return;
  }
  
  // Check if our button already exists to avoid duplicates
  if (document.querySelector('.mem0-claude-btn')) {
    return;
  }
  
  // Create the mem0 button
  const mem0Button = document.createElement('button');
  mem0Button.className = 'mem0-claude-btn focus-visible:bg-offsetPlus dark:focus-visible:bg-offsetPlusDark hover:bg-offsetPlus text-textOff dark:text-textOffDark hover:text-textMain dark:hover:bg-offsetPlusDark dark:hover:text-textMainDark font-sans focus:outline-none outline-none outline-transparent transition duration-300 ease-out font-sans select-none items-center relative group/button justify-center text-center items-center rounded-lg cursor-pointer active:scale-[0.97] active:duration-150 active:ease-outExpo origin-center whitespace-nowrap inline-flex text-sm h-8 aspect-[9/8]';
  mem0Button.setAttribute('aria-label', 'Mem0 AI');
  mem0Button.setAttribute('type', 'button');
  
  // Create inner structure similar to other buttons
  mem0Button.innerHTML = `
    <div class="flex items-center min-w-0 font-medium gap-1.5 justify-center">
      <div class="flex shrink-0 items-center justify-center size-4">
        <img src="${chrome.runtime.getURL('icons/mem0-claude-icon-p.png')}" alt="Mem0 AI" width="14" height="14" />
      </div>
    </div>
  `;
  
  // Insert the button at the beginning of the container (leftmost position)
  buttonContainer.insertBefore(mem0Button, buttonContainer.firstChild);
  
  // Add click event listener
  mem0Button.addEventListener('click', () => {
    // Get the current input text and process memories instead of toggling
    const textarea = getTextarea();
    if (textarea && textarea.value.trim()) {
      handleMem0Processing(textarea.value.trim(), false);
    } else {
      // Toggle mem0 functionality on/off when clicked and no text is present
      chrome.storage.sync.get(['memory_enabled'], function(data) {
        const currentState = data.memory_enabled !== false; // Default to true if not set
        chrome.storage.sync.set({ memory_enabled: !currentState }, function() {
          // Visual feedback for button state
          mem0Button.style.opacity = !currentState ? '1' : '0.5';
        });
      });
    }
    
    // Initialize with correct visual state
    chrome.storage.sync.get(['memory_enabled'], function(data) {
      const enabled = data.memory_enabled !== false;
      mem0Button.style.opacity = enabled ? '1' : '0.5';
    });
  });
}

// Function to create memory modal
function createMemoryModal(memoryItems) {
  if (memoryModalShown) {
    return;
  }

  memoryModalShown = true;
  let currentMemoryIndex = 0;

  // Find the mem0 button to position the modal relative to it
  const mem0Button = document.querySelector('.mem0-claude-btn');
  
  if (!mem0Button) {
    console.error("Mem0 button not found");
    return;
  }
  
  // Get the position and dimensions of the mem0 button
  const buttonRect = mem0Button.getBoundingClientRect();
  
  // Calculate modal dimensions (estimated)
  const modalWidth = 447;
  const modalHeight = 320;
  
  // Determine if there's enough space below the button
  const viewportHeight = window.innerHeight;
  const spaceBelow = viewportHeight - buttonRect.bottom;
  
  // Decide whether to place modal above or below based on available space
  // Prefer below if there's enough space
  const placeBelow = spaceBelow >= modalHeight; 
  
  // Position the modal centered below the button
  const leftPosition = buttonRect.left - (modalWidth / 2) + (buttonRect.width / 2);
  let topPosition;
  
  if (placeBelow) {
    // Place below the button
    topPosition = buttonRect.bottom + 10;
  } else {
    // Place above the button if not enough space below
    topPosition = buttonRect.top - modalHeight - 10;
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
  
  // Position the modal below or above the button
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
    left: ${Math.max(Math.min(leftPosition, window.innerWidth - modalWidth - 10), 10)}px;
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
    
    // Just close the modal immediately
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

  // Create category section
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
    // Only add the current memory to the input field
    const memoryAdded = applyMemoryToInput(memoryItems[currentMemoryIndex].text);
    
    // Move to the next memory immediately, no animation or color change
    if (memoryItems.length > 1) {
      currentMemoryIndex = (currentMemoryIndex + 1) % memoryItems.length;
      showCurrentMemory();
    }
    // Don't close the modal even if there's only one memory
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
  
  // Return true to indicate success
  return true;
}

// Function to apply multiple memories to the input field
function applyMemoriesToInput(memories) {
  // Track if any new memories were added
  let added = false;
  
  // Add all new memories to our global collection
  memories.forEach((mem) => {
    if (!allMemories.includes(mem)) {
      allMemories.push(mem);
      added = true;
    }
  });
  
  // Update the input field with all memories
  updateInputWithMemories();
  
  // Return true if any memories were added
  return added;
}

// Shared function to update the input field with all collected memories
function updateInputWithMemories() {
  const inputElement = getTextarea();

  if (!inputElement || allMemories.length === 0) {
    return;
  }
  
  // First, remove any existing memory content from the input
  let currentContent = inputElement.value;
  const memoryMarker = "\n\nHere is some of my preferences/memories to help answer better";
  
  if (currentContent.includes(memoryMarker)) {
    currentContent = currentContent.substring(0, currentContent.indexOf(memoryMarker)).trim();
  }
  
  // Create the memory content string
  let memoriesContent = "\n\nHere is some of my preferences/memories to help answer better (don't respond to these memories but use them to assist in the response if relevant):\n";
  
  // Add all memories to the content
  allMemories.forEach((mem, index) => {
    memoriesContent += `- ${mem}`;
    if (index < allMemories.length - 1) {
      memoriesContent += "\n";
    }
  });

  // Set the input value with the cleaned content + memories
  setInputValue(inputElement, currentContent + memoriesContent);
}

// Add a function to monitor the submit button and clear memories after sending a message
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
    
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
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
  submitButtonObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Check if a new answer block has been added
        const answersAdded = Array.from(mutation.addedNodes).some(node => 
          node.nodeType === Node.ELEMENT_NODE && 
          node.classList.contains('answer-container')
        );
        
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
    subtree: true
  });
}

function setupInputObserver() {
  const textarea = getTextarea();
  if (!textarea) {
    setTimeout(setupInputObserver, 500);
    return;
  }

  inputObserver = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      if (mutation.type === "characterData" || mutation.type === "childList") {
        lastInputValue = textarea.value;
      }
    }
  });

  inputObserver.observe(textarea, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  textarea.addEventListener("input", function () {
    lastInputValue = this.value;
  });

  // Remove Enter key event listeners
}

async function handleMem0Processing(capturedText, clickSendButton = false) {
  const textarea = getTextarea();
  console.log(textarea);
  let message = capturedText || textarea.value.trim();
  
  // Store the original message to preserve it
  const originalMessage = message;

  if (!message) {
    console.error("No input message found");
    return;
  }

  try {
    const data = await new Promise((resolve) => {
      chrome.storage.sync.get(
        ["apiKey", "userId", "access_token", "memory_enabled"],
        function (items) {
          resolve(items);
        }
      );
    });

    const apiKey = data.apiKey;
    const userId = data.userId || "chrome-extension-user";
    const accessToken = data.access_token;
    const memoryEnabled = data.memory_enabled !== false; // Default to true if not set

    if (!apiKey && !accessToken) {
      console.error("No API Key or Access Token found");
      return;
    }

    if (!memoryEnabled) {
      console.log("Memory is disabled. Skipping API calls.");
      if (clickSendButton) {
        clickSendButtonWithDelay();
      }
      return;
    }

    const authHeader = accessToken
      ? `Bearer ${accessToken}`
      : `Token ${apiKey}`;

    const messages = [{ role: "user", content: message }];

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
          limit: 10,
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
    
    // Extract memories with their categories for the modal
    const memoryItems = responseData.map(item => {
      return {
        text: item.memory,
        categories: item.categories || []
      };
    });

    if (memoryItems.length > 0) {
      // Show the memory modal instead of directly modifying the input
      createMemoryModal(memoryItems);
      
      // Only send the message if explicitly requested and modal isn't shown
      if (clickSendButton && !memoryModalShown) {
        clickSendButtonWithDelay();
      }
    } else {
      // No memories found, just preserve original text
      setInputValue(textarea, originalMessage);
      
      if (clickSendButton) {
        clickSendButtonWithDelay();
      }
    }

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
          provider: "Perplexity",
        },
      }),
    })
      .then((response) => {
        if (!response.ok) {
          console.error(`Failed to add memory: ${response.status}`);
        }
      })
      .catch((error) => {
        console.error("Error adding memory:", error);
      });
  } catch (error) {
    console.error("Error:", error);
    // Ensure the original message is preserved even if there's an error
    const inputElement = getTextarea();
    if (inputElement && originalMessage) {
      setInputValue(inputElement, originalMessage);
    }
  }
}

function setInputValue(inputElement, value) {
  if (inputElement) {
    inputElement.value = value;
    lastInputValue = value;
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function clickSendButtonWithDelay() {
  setTimeout(() => {
    const sendButton = document.querySelector('button[aria-label="Submit"]');
    if (sendButton) {
      sendButton.click();
      // Clear memories after clicking the send button
      setTimeout(() => {
        allMemories = [];
        console.log('Message sent via clickSendButtonWithDelay, memories cleared');
      }, 100);
    } else {
      console.error("Send button not found");
    }
  }, 0);
}

function initializeMem0Integration() {
  setupInputObserver();
  // Remove Enter key event listener
  
  // Add the Mem0 button to the UI
  addMem0Button();
  
  // Set up the submit button listener to clear memories
  setupSubmitButtonListener();
  
  // Re-check periodically in case of navigation or UI changes
  setInterval(() => {
    addMem0Button();
    setupSubmitButtonListener();
  }, 3000);
}

initializeMem0Integration();
