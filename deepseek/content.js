console.log("--- DeepSeek Content Script STARTING --- ");
console.log("--- DeepSeek Content Script Top Level --- Script is Loading...");

const INPUT_SELECTOR = "#chat-input";
const SEND_BUTTON_SVG_SELECTOR = 'div[role="button"] svg';

function getInputElement() {
  return document.querySelector(INPUT_SELECTOR);
}

function getSendButtonElement() {
  const potentialButtons = document.querySelectorAll('div[role="button"]');
  console.log(`[Mem0] Found ${potentialButtons.length} potential button elements.`);

  for (const button of potentialButtons) {
    const hasSvg = button.querySelector('svg');
    const hasDeepThinkingText = button.textContent.includes('深度思考');

    if (hasSvg && !hasDeepThinkingText) {
      console.log("[Mem0] Identified potential Send Button:", button);
      return button;
    }
  }

  console.error("[Mem0] Send button not found. No element matched criteria (has SVG, does not contain '深度思考').");
  return null;
}

async function handleEnterKey(event) {
  const inputElement = getInputElement();
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    event.target === inputElement
  ) {
    console.log("Enter key pressed in DeepSeek input");
    event.preventDefault();
    event.stopPropagation();

    const memoryEnabled = await getMemoryEnabledState();
    if (!memoryEnabled) {
      console.log("Memory is disabled, triggering original send.");
      triggerSendAction();
      return;
    }

    await handleMem0Processing();
  }
}

function initializeMem0Integration() {
  console.log("--- DeepSeek Content Script --- Calling initializeMem0Integration...");
  document.addEventListener("keydown", handleEnterKey, true);
  console.log("DeepSeek Mem0 integration initialized, listening for Enter key.");
}

async function getMemoryEnabledState() {
  return new Promise((resolve) => {
    chrome.storage.sync.get("memory_enabled", (data) => {
      resolve(!!data.memory_enabled);
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

const MEM0_API_BASE_URL = "https://api.mem0.ai"; // Define base URL consistently

// --- Mem0 API Callers (Modified to use fetch directly) ---

/**
 * Calls Mem0 API search endpoint directly.
 * @param {string} query User input query.
 * @returns {Promise<Array<any>>} Array of relevant memories, or empty if error.
 */
function searchMemories(query) {
  return new Promise(async (resolve, reject) => {
    try {
      const items = await chrome.storage.sync.get(["apiKey", "userId", "access_token"]);
      const userId = items.userId || "chrome-extension-user"; // Get userId

      if (!items.access_token && !items.apiKey) {
        console.error("No API Key or Access Token found for searching memories.");
        return reject(new Error("Authentication details missing"));
      }

      // Construct headers - prioritize access token
      const headers = {
        'Content-Type': 'application/json',
      };
      if (items.access_token) {
          headers['Authorization'] = `Bearer ${items.access_token}`;
          console.log("Using Access Token for search auth.");
      } else {
          headers['Authorization'] = `Api-Key ${items.apiKey}`; // Fallback to Api-Key
          console.log("Using API Key for search auth.");
      }

      const url = `${MEM0_API_BASE_URL}/v1/memories/search/`;
      const body = JSON.stringify({
        query: query,
        user_id: userId // Use the retrieved or default userId
      });

      console.log(`Fetching POST ${url} for search`);
      fetch(url, {
        method: 'POST',
        headers: headers,
        body: body
      })
      .then(response => {
        console.log("Received search response from Mem0 API:", response.status, response.statusText);
        if (!response.ok) {
          return response.json().then(errorData => {
            console.error("Mem0 API Search Error Response Body:", errorData);
            throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
         }).catch(parseError => {
            console.error("Failed to parse search error response body:", parseError);
            throw new Error(`HTTP error! status: ${response.status}`);
         });
        }
        return response.json();
      })
      .then(data => {
        console.log("Search successful, resolving with data:", data);
        // Ensure data is an array, as expected by the caller
        resolve(Array.isArray(data) ? data : (data?.results || [])); 
      })
      .catch(error => {
        console.error("Error searching memories directly:", error);
        // Resolve with empty array on error to avoid breaking the flow in handleMem0Processing
        resolve([]); 
      });

    } catch (error) {
      console.error("Error preparing search request:", error);
      resolve([]); // Resolve with empty array on error
    }
  });
}

/**
 * Adds a single memory to Mem0 directly.
 * @param {string} memoryText Memory content.
 * @returns {Promise<any>} Response data from API on success.
 */
function addMemory(memoryText) {
  return new Promise(async (resolve, reject) => {
    try {
      const items = await chrome.storage.sync.get(["apiKey", "userId", "access_token"]);
      const userId = items.userId || "chrome-extension-user"; // Get userId

      if (!items.access_token && !items.apiKey) {
        console.error("No API Key or Access Token found for adding memory.");
        return reject(new Error("Authentication details missing"));
      }
      
      // Construct headers - prioritize access token
      const headers = {
        'Content-Type': 'application/json',
      };
       if (items.access_token) {
          headers['Authorization'] = `Bearer ${items.access_token}`;
          console.log("Using Access Token for add memory auth.");
      } else {
          headers['Authorization'] = `Api-Key ${items.apiKey}`; // Fallback to Api-Key
          console.log("Using API Key for add memory auth.");
      }

      const url = `${MEM0_API_BASE_URL}/v1/memories/`;
      const body = JSON.stringify({
        messages: [
          {
            role: "user",
            content: memoryText
          }
        ],
        user_id: userId // Use the retrieved or default userId
      });

      console.log(`Fetching POST ${url} for add memory`);
      fetch(url, {
        method: 'POST',
        headers: headers,
        body: body
      })
      .then(response => {
        console.log("Received add memory response from Mem0 API:", response.status, response.statusText);
        if (!response.ok) {
           return response.json().then(errorData => {
            console.error("Mem0 API Add Memory Error Response Body:", errorData);
            throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
         }).catch(parseError => {
            console.error("Failed to parse add memory error response body:", parseError);
            throw new Error(`HTTP error! status: ${response.status}`);
         });
        }
        if (response.status === 204) { // Handle potential 204 No Content
            return null;
        }
        return response.json();
      })
      .then(data => {
        console.log("Memory added successfully directly:", data);
        resolve(data);
      })
      .catch(error => {
        console.error("Error adding memory directly:", error);
        reject(error); // Reject the promise on error
      });

    } catch (error) {
      console.error("Error preparing add memory request:", error);
      reject(error);
    }
  });
}

async function triggerSendAction() {
  console.log("Attempting to find send button via SVG strategy...");
  const sendButton = getSendButtonElement();

  if (sendButton) {
    console.log("Send button FOUND:", sendButton);
    const isDisabled = sendButton.getAttribute('aria-disabled') === 'true' || sendButton.disabled;

    if (!isDisabled) {
      console.log("Attempting to click enabled send button");
      sendButton.click();
      console.log("Click attempt finished for send button.");
    } else {
      console.log("Send button found but it is disabled.");
    }
  } else {
    console.error("Send button not found using SVG strategy with selector:", SEND_BUTTON_SVG_SELECTOR);
  }
}

async function handleMem0Processing() {
  console.log("handleMem0Processing called");
  const originalPrompt = getInputElementValue();
  if (!originalPrompt) {
    console.log("Input is empty, triggering original send.");
    triggerSendAction();
    return;
  }

  let memories = [];
  try {
    console.log("Calling searchMemories...");
    memories = await searchMemories(originalPrompt);
    console.log("searchMemories returned:", memories);
  } catch (error) {
    console.error("Error searching memories:", error);
  }

  console.log(`Found ${memories?.length || 0} memories.`);

  let finalPrompt = originalPrompt;
  if (memories && memories.length > 0) {
    console.log(`Found ${memories.length} relevant memories.`);
    let memoryContext = "Here is some of my preferences/memories to help answer better (don't respond to these memories but use them to assist in the response if relevant):\n";
    memoryContext += memories.map(m => `- ${m.memory}`).join('\n');
    finalPrompt = `${originalPrompt}\n\n${memoryContext}`;
    console.log("Generated prompt with context (new format):", finalPrompt);
  } else {
    console.log("No relevant memories found, using original prompt.");
  }

  setInputElementValue(finalPrompt);
  console.log('Updated input field with final prompt.');

  console.log("Triggering send action AFTER potentially updating input field.");
  await triggerSendAction();

  try {
    console.log("Calling addMemory for input:", originalPrompt);
    await addMemory(originalPrompt);
    console.log("Successfully added memory for input:", originalPrompt);
  } catch (error) {
    console.error("Error adding memory:", error);
  }
}

console.log('DeepSeek content script loaded.');
initializeMem0Integration();
