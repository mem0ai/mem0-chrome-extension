// Global variables to store all memories
let allMemories = [];
let memoryModalShown = false;
let isProcessingMem0 = false;
let memoryEnabled = true;

function addMem0Button() {
  const sendButton = document.querySelector(
    'button[aria-label="Send Message"]'
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
    mem0Button.style.marginLeft = "8px";
    mem0Button.setAttribute("aria-label", "Add related memories");

    const mem0Icon = document.createElement("img");
    mem0Icon.src = chrome.runtime.getURL("icons/mem0-icon.png");
    mem0Icon.style.width = "16px";
    mem0Icon.style.height = "16px";

    const popup = createPopup(buttonContainer, "top");
    mem0Button.appendChild(mem0Icon);
    mem0Button.addEventListener("click", () => {
      if (memoryEnabled) {
        handleMem0Modal(popup);
      }
    });

    buttonContainer.appendChild(mem0Button);

    const tooltip = document.createElement("div");
    tooltip.id = "mem0-tooltip";
    tooltip.textContent = "Add related memories";
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
      const rect = mem0Button.getBoundingClientRect();
      const buttonCenterX = rect.left + rect.width / 2;
      tooltip.style.left = `${buttonCenterX}px`;
      tooltip.style.top = `${rect.bottom + 5}px`;
      tooltip.style.display = "block";
    });

    mem0Button.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });

    inputToolsMenuButton.parentNode.insertBefore(
      buttonContainer,
      inputToolsMenuButton.nextSibling
    );
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
    mem0Button.setAttribute("aria-label", "Add related memories");

    const mem0Icon = document.createElement("img");
    mem0Icon.src = chrome.runtime.getURL("icons/mem0-icon.png");
    mem0Icon.style.width = "16px";
    mem0Icon.style.height = "16px";

    const popup = createPopup(buttonContainer, "right");
    mem0Button.appendChild(mem0Icon);
    mem0Button.addEventListener("click", () => {
      if (memoryEnabled) {
        handleMem0Modal(popup);
      }
    });

    buttonContainer.appendChild(mem0Button);

    const tooltip = document.createElement("div");
    tooltip.id = "mem0-tooltip";
    tooltip.textContent = "Add related memories";
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
      const rect = mem0Button.getBoundingClientRect();
      const buttonCenterX = rect.left + rect.width / 2;
      tooltip.style.left = `${buttonCenterX}px`;
      tooltip.style.top = `${rect.bottom + 5}px`;
      tooltip.style.display = "block";
    });

    mem0Button.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });

    screenshotButton.parentNode.insertBefore(
      buttonContainer,
      screenshotButton.nextSibling
    );
  } else if (sendButton && !document.querySelector("#mem0-button")) {
    const buttonContainer = document.createElement("div");
    buttonContainer.style.position = "relative";
    buttonContainer.style.display = "inline-block";

    const mem0Button = document.createElement("img");
    mem0Button.id = "mem0-button";
    mem0Button.src = chrome.runtime.getURL("icons/mem0-icon.png");
    mem0Button.style.width = "16px";
    mem0Button.style.height = "16px";
    mem0Button.style.marginRight = "16px";
    mem0Button.style.cursor = "pointer";
    mem0Button.style.padding = "8px";
    mem0Button.style.borderRadius = "5px";
    mem0Button.style.transition = "background-color 0.3s ease";
    mem0Button.style.boxSizing = "content-box";
    mem0Button.addEventListener("click", () => {
      if (memoryEnabled) {
        handleMem0Modal(popup);
      }
    });

    const popup = createPopup(buttonContainer, "top");

    mem0Button.addEventListener("mouseenter", () => {
      mem0Button.style.backgroundColor = "rgba(0, 0, 0, 0.35)";
      tooltip.style.visibility = "visible";
      tooltip.style.opacity = "1";
    });
    mem0Button.addEventListener("mouseleave", () => {
      mem0Button.style.backgroundColor = "transparent";
      tooltip.style.visibility = "hidden";
      tooltip.style.opacity = "0";
    });

    const tooltip = document.createElement("div");
    tooltip.textContent = "Add related memories";
    tooltip.style.visibility = "hidden";
    tooltip.style.backgroundColor = "black";
    tooltip.style.color = "white";
    tooltip.style.textAlign = "center";
    tooltip.style.borderRadius = "6px";
    tooltip.style.padding = "2px 6px";
    tooltip.style.position = "absolute";
    tooltip.style.zIndex = "1";
    tooltip.style.top = "calc(100% + 5px)";
    tooltip.style.left = "50%";
    tooltip.style.transform = "translateX(-50%)";
    tooltip.style.whiteSpace = "nowrap";
    tooltip.style.opacity = "0";
    tooltip.style.transition = "opacity 0.3s";
    tooltip.style.fontSize = "12px";

    buttonContainer.appendChild(mem0Button);
    buttonContainer.appendChild(tooltip);

    const flexContainer = document.createElement("div");
    flexContainer.style.display = "flex";
    flexContainer.style.alignItems = "center";

    const screenshotButton = document.querySelector(
      'button[aria-label="Capture screenshot"]'
    );

    screenshotButton.parentNode.insertBefore(
      buttonContainer,
      screenshotButton.nextSibling
    );
  }

  // Add send button listener to clear memories after sending
  const sendBtn = document.querySelector('button[aria-label="Send Message"]');
  if (sendBtn && !sendBtn.dataset.mem0Listener) {
    sendBtn.dataset.mem0Listener = 'true';
    sendBtn.addEventListener('click', function() {
      // Clear all memories after sending
      setTimeout(() => {
        allMemories = [];
      }, 100);
    });
  }

  updateMem0ButtonState();
}

// Function to create a memory modal similar to the ChatGPT implementation
function createMemoryModal(memoryItems) {
  if (memoryModalShown) {
    return;
  }

  memoryModalShown = true;
  let currentMemoryIndex = 0;

  // Get the Mem0 button position instead of the input field
  const mem0Button = document.querySelector("#mem0-button");
  
  if (!mem0Button) {
    console.error("Mem0 button not found");
    return;
  }
  
  // Get the position and dimensions of the button
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
  
  // Calculate horizontal position (centered under the button)
  const buttonCenterX = buttonRect.left + buttonRect.width / 2;
  const leftPosition = Math.max(Math.min(buttonCenterX - (modalWidth / 2), window.innerWidth - modalWidth - 20), 20);
  
  // Calculate vertical position
  let topPosition;
  
  if (placeBelow) {
    // Place below the button with a small gap
    topPosition = buttonRect.bottom + 10;
  } else {
    // Place above the button with a small gap
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
  
  // Position the modal relative to the button
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
    padding: 12px 12px;
    background-color: #18181B;
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
    padding: 6px 8px;
    gap: 4px;
    height: 24px;
    border: 0.91358px solid #27272A;
    border-radius: 6px;
    text-decoration: none;
  `;

  const viewAllText = document.createElement('span');
  viewAllText.textContent = 'View all memories';
  viewAllText.style.cssText = `
    font-size: 11px;
    font-weight: 500;
    color: #71717A;
    letter-spacing: -0.03em;
  `;
  
  const viewAllIcon = document.createElement('span');
  viewAllIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 6H6C4.89543 6 4 6.89543 4 8V18C4 19.1046 4.89543 20 6 20H16C17.1046 20 18 19.1046 18 18V14M14 4H20M20 4V10M20 4L10 14" stroke="#71717A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  viewAllBtn.appendChild(viewAllText);
  viewAllBtn.appendChild(viewAllIcon);

  // Create button container for Skip and Add to Prompt
  const buttonsContainer = document.createElement('div');
  buttonsContainer.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
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
    transition: background-color 0.2s;
  `;
  
  skipBtn.addEventListener('mouseenter', () => {
    skipBtn.style.backgroundColor = '#27272A';
  });
  
  skipBtn.addEventListener('mouseleave', () => {
    skipBtn.style.backgroundColor = 'transparent';
  });
  
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
    justify-content: center;
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
    transition: opacity 0.2s;
  `;
  
  addToPromptBtn.addEventListener('mouseenter', () => {
    addToPromptBtn.style.opacity = '0.9';
  });
  
  addToPromptBtn.addEventListener('mouseleave', () => {
    addToPromptBtn.style.opacity = '1';
  });
  
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

  // Assemble footer with correct layout
  buttonsContainer.appendChild(skipBtn);
  buttonsContainer.appendChild(addToPromptBtn);
  
  modalFooter.appendChild(viewAllBtn);
  modalFooter.appendChild(buttonsContainer);

  // Assemble modal
  contentSection.appendChild(categorySection);
  contentSection.appendChild(memoriesContent);
  
  modalContainer.appendChild(modalHeader);
  modalContainer.appendChild(contentSection);
  modalContainer.appendChild(modalFooter);
  
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
    document.querySelector("textarea") ||
    document.querySelector('p[data-placeholder="How can I help you today?"]') ||
    document.querySelector('p[data-placeholder="Reply to Claude..."]');

  if (inputElement && allMemories.length > 0) {
    // Get the content without any existing memory wrappers
    let baseContent = getContentWithoutMemories();
    
    // Create the memory section
    let memoriesContent = "";
    
    memoriesContent += `<p><strong>Here is some of my preferences/memories to help answer better (don't respond to these memories but use them to assist in the response if relevant):</strong></p>`;
    
    // Add all memories to the content
    allMemories.forEach((mem) => {
      memoriesContent += `<p>- ${mem}</p>`;
    });

    // Add the final content to the input
    if (inputElement.tagName.toLowerCase() === "div") {
      inputElement.innerHTML = `${baseContent}<p><br></p>${memoriesContent}`;
    } else if (inputElement.tagName.toLowerCase() === "p" && 
               (inputElement.getAttribute('data-placeholder') === 'How can I help you today?' ||
               inputElement.getAttribute('data-placeholder') === 'Reply to Claude...')) {
      // For p element placeholders
      inputElement.textContent = `${baseContent}\n${memoriesContent}`;
    } else {
      // For textarea
      inputElement.value = `${baseContent}\n${memoriesContent}`;
    }
    
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    
    // For the p element, we might need to also dispatch these events
    if (inputElement.tagName.toLowerCase() === "p") {
      // Simulate user typing
      inputElement.dispatchEvent(new Event("focus", { bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      inputElement.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}

// Function to get the content without any memory wrappers
function getContentWithoutMemories() {
  const inputElement =
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector("textarea") ||
    document.querySelector('p[data-placeholder="How can I help you today?"]') ||
    document.querySelector('p[data-placeholder="Reply to Claude..."]');
    
  if (!inputElement) return "";
  
  let content = "";
  
  if (inputElement.tagName.toLowerCase() === "div") {
    content = inputElement.innerHTML;
  } else if (inputElement.tagName.toLowerCase() === "p" && 
            (inputElement.getAttribute('data-placeholder') === 'How can I help you today?' ||
            inputElement.getAttribute('data-placeholder') === 'Reply to Claude...')) {
    // For p element placeholders
    content = inputElement.textContent || '';
  } else {
    // For textarea
    content = inputElement.value;
  }
  
  // Remove any memory headers and content
  const memInfoRegex = /<p><strong>Here is some of my preferences\/memories to help answer better \(don't respond to these memories but use them to assist in the response if relevant\):<\/strong><\/p>([\s\S]*?)(?=<p><strong>|$)/;
  content = content.replace(memInfoRegex, "");
  
  return content.trim();
}

// New function to handle the memory modal
async function handleMem0Modal(popup, clickSendButton = false) {
  const inputElement =
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector("textarea") ||
    document.querySelector('p[data-placeholder="How can I help you today?"]') ||
    document.querySelector('p[data-placeholder="Reply to Claude..."]');
  let message = getInputValue();
  setButtonLoadingState(true);
  if (!message) {
    console.error("No input message found");
    showPopup(popup, "No input message found");
    setButtonLoadingState(false);
    return;
  }

  message = message.split(
    "Here is some of my preferences/memories to help answer better (don't respond to these memories but use them to assist in the response if relevant):"
  )[0];

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
      showPopup(popup, "No API Key or Access Token found");
      isProcessingMem0 = false;
      setButtonLoadingState(false);
      return;
    }

    const authHeader = accessToken
      ? `Bearer ${accessToken}`
      : `Token ${apiKey}`;

    const messages = getLastMessages(2);
    messages.push({ role: "user", content: message });

    // Search API call
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

    if (clickSendButton) {
      const sendButton = document.querySelector(
        'button[aria-label="Send Message"]'
      );
      if (sendButton) {
        setTimeout(() => {
          sendButton.click();
        }, 100);
      } else {
        console.error("Send button not found");
      }
    }

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
      showPopup(popup, "No memories found");
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
          provider: "Claude",
        },
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
    showPopup(popup, "Failed to send message to Mem0");
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
  memoryEnabled = await new Promise((resolve) => {
    chrome.storage.sync.get("memory_enabled", function (data) {
      resolve(data.memory_enabled);
    });
  });
  updateMem0ButtonState();
}

function updateMem0ButtonState() {
  const mem0Button = document.querySelector("#mem0-button");
  if (mem0Button) {
    mem0Button.disabled = !memoryEnabled;
    mem0Button.style.opacity = memoryEnabled ? "1" : "0.5";
    mem0Button.style.cursor = memoryEnabled ? "pointer" : "not-allowed";
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
            await handleMem0Modal(popup, true);
          })();
        } else {
          console.error("Mem0 popup not found");
        }
      }
    }
  });

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        addMem0Button();
      }
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "sync" && changes.memory_enabled) {
      updateMemoryEnabled();
    }
  });
}

initializeMem0Integration();
