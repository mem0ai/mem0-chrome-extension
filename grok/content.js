let lastInputValue = "";
let inputObserver = null;
let memoryModalShown = false;
let allMemories = [];
let isProcessingMem0 = false;

function getTextarea() {
  const selectors = [
    'textarea.w-full.px-2.\\@\\[480px\\]\\/input\\:px-3.bg-transparent.focus\\:outline-none.text-primary.align-bottom.min-h-14.pt-5.my-0.mb-5',
    'textarea.w-full.px-2.\\@\\[480px\\]\\/input\\:px-3.pt-5.mb-5.bg-transparent.focus\\:outline-none.text-primary.align-bottom',
    'textarea[dir="auto"][spellcheck="false"][placeholder="Ask anything"]',
    'textarea[dir="auto"][spellcheck="false"][placeholder="Ask follow-up"]',
    'textarea[dir="auto"][spellcheck="false"]'
  ];

  for (const selector of selectors) {
    const textarea = document.querySelector(selector);
    if (textarea) return textarea;
  }
  return null;
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
}

async function handleMem0Processing(capturedText, clickSendButton = false) {
  const textarea = getTextarea();
  console.log(textarea);
  let message = capturedText || textarea.value.trim();

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
          provider: "Grok",
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
    const selectors = [
      'button.group.flex.flex-col.justify-center.rounded-full[type="submit"]',
      'button.group.flex.flex-col.justify-center.rounded-full.focus\\:outline-none.focus-visible\\:outline-none[type="submit"]',
      'button[type="submit"]:not([aria-label="Submit attachment"])',
      'button[aria-label="Grok something"][role="button"]'
    ];

    let sendButton = null;
    for (const selector of selectors) {
      sendButton = document.querySelector(selector);
      if (sendButton) break;
    }

    if (sendButton) {
      sendButton.click();
    } else {
      console.error("Send button not found");
    }
  }, 0);
}

function initializeMem0Integration() {
  setupInputObserver();
  injectMem0Button();
}

function injectMem0Button() {
  // Function to periodically check and add the button if the parent element exists
  function tryAddButton() {
    const thinkButton = document.querySelector('button[aria-label="Think"]');
    if (!thinkButton) {
      setTimeout(tryAddButton, 1000);
      return;
    }
    
    // Check if our button already exists
    if (document.querySelector('button[aria-label="Mem0"]')) {
      return;
    }
    
    const parentDiv = thinkButton.parentElement;
    if (!parentDiv) {
      setTimeout(tryAddButton, 1000);
      return;
    }
    
    // Create mem0 button
    const mem0Button = document.createElement('button');
    mem0Button.className = thinkButton.className;
    mem0Button.setAttribute('type', 'button');
    mem0Button.setAttribute('tabindex', '0');
    mem0Button.setAttribute('aria-pressed', 'false');
    mem0Button.setAttribute('aria-label', 'Mem0');
    mem0Button.setAttribute('data-state', 'closed');
    
    // Create button content similar to Think button
    mem0Button.innerHTML = `
      <img src="${chrome.runtime.getURL('icons/mem0-claude-icon-p.png')}" 
           width="18" height="18" style="margin-right: 4px;">
      <span>Mem0</span>
    `;
    
    // Add click event to the mem0 button to show memory modal
    mem0Button.addEventListener('click', function() {
      // Check if the memories are enabled
      getMemoryEnabledState().then(memoryEnabled => {
        if (memoryEnabled) {
          handleMem0Modal();
        } else {
          // If memories are disabled, open options
          chrome.runtime.sendMessage({ action: 'openOptions' });
        }
      });
    });
    
    // Insert after the Think button
    parentDiv.insertBefore(mem0Button, thinkButton.nextSibling);
    
    // Add a small margin between buttons
    mem0Button.style.marginLeft = '8px';
  }
  
  // Start trying to add the button
  tryAddButton();
  
  // Also observe DOM changes to add button when needed
  const observer = new MutationObserver(() => {
    if (!document.querySelector('button[aria-label="Mem0"]')) {
      tryAddButton();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Function to create a memory modal similar to the ChatGPT implementation
function createMemoryModal(memoryItems) {
  if (memoryModalShown) {
    return;
  }

  memoryModalShown = true;
  let currentMemoryIndex = 0;

  // Get the position of the Mem0 button instead of the textarea
  const mem0Button = document.querySelector('button[aria-label="Mem0"]');
  
  if (!mem0Button) {
    console.error("Mem0 button not found");
    return;
  }
  
  // Get the position and dimensions of the Mem0 button
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
  
  // Position the modal centered under the button
  let topPosition;
  let leftPosition;
  
  leftPosition = Math.max(buttonRect.left + (buttonRect.width / 2) - (modalWidth / 2), 10);
  // Ensure the modal doesn't go off the right edge of the screen
  const rightEdgePosition = leftPosition + modalWidth;
  if (rightEdgePosition > window.innerWidth - 10) {
    leftPosition = window.innerWidth - modalWidth - 10;
  }
  
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
  
  // Position the modal aligned to the button and either above or below
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
    left: ${leftPosition}px;
    pointer-events: auto;
    border: 1px solid #27272A;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Create a triangle pointer to indicate the modal is related to the button
  const trianglePointer = document.createElement('div');
  trianglePointer.style.cssText = `
    position: absolute;
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    left: ${Math.min(Math.max(buttonRect.left + buttonRect.width/2 - leftPosition - 8, 20), modalWidth - 20)}px;
    ${placeBelow ? 
      'border-bottom: 8px solid #27272A; top: -8px;' : 
      'border-top: 8px solid #27272A; bottom: -8px;'}
  `;
  modalContainer.appendChild(trianglePointer);

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
  const inputElement = getTextarea();

  if (inputElement && allMemories.length > 0) {
    // Get the content without any existing memory wrappers
    let baseContent = getContentWithoutMemories();
    
    // Create the memory string with all collected memories
    let memoriesContent = "\n\nHere is some of my preferences/memories to help answer better (don't respond to these memories but use them to assist in the response if relevant):\n";
    
    // Add all memories to the content
    allMemories.forEach((mem, index) => {
      memoriesContent += `- ${mem}`;
      if (index < allMemories.length - 1) {
        memoriesContent += "\n";
      }
    });

    // Add the final content to the input
    setInputValue(inputElement, baseContent + memoriesContent);
  }
}

// Function to get the content without any memory wrappers
function getContentWithoutMemories() {
  const inputElement = getTextarea();
    
  if (!inputElement) return "";
  
  let content = inputElement.value;
  
  // Remove any memory headers and content
  const memoryPrefix = "Here is some of my preferences/memories to help answer better (don't respond to these memories but use them to assist in the response if relevant):";
  const prefixIndex = content.indexOf(memoryPrefix);
  if (prefixIndex !== -1) {
    content = content.substring(0, prefixIndex).trim();
  }
  
  // Also try with regex pattern
  const memInfoRegex = /\s*Here is some of my preferences\/memories to help answer better \(don't respond to these memories but use them to assist in the response if relevant\):[\s\S]*$/;
  content = content.replace(memInfoRegex, "").trim();
  
  return content;
}

// Function to check if memory is enabled
function getMemoryEnabledState() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["memory_enabled"], function (result) {
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

  const textarea = getTextarea();
  let message = textarea ? textarea.value.trim() : "";
  
  if (!message) {
    console.error("No input message found");
    return;
  }

  // Clean the message of any existing memory content
  message = getContentWithoutMemories();

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

    // Extract memories and their categories
    const memoryItems = responseData.map(item => {
      return {
        text: item.memory,
        categories: item.categories || []
      };
    });

    if (memoryItems.length > 0) {
      // Show the memory modal
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
          provider: "Grok",
        },
      }),
    }).catch((error) => {
      console.error("Error adding memory:", error);
    });
    
  } catch (error) {
    console.error("Error:", error);
  } finally {
    isProcessingMem0 = false;
  }
}

initializeMem0Integration();
