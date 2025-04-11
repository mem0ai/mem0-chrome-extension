const INPUT_SELECTOR = "#chat-input";
const SEND_BUTTON_SVG_SELECTOR = 'div[role="button"] svg';

function getInputElement() {
  return document.querySelector(INPUT_SELECTOR);
}

function getSendButtonElement() {
  const potentialButtons = document.querySelectorAll('div[role="button"]');

  for (const button of potentialButtons) {
    const hasSvg = button.querySelector('svg');
    const hasDeepThinkingText = button.textContent.includes('深度思考');

    if (hasSvg && !hasDeepThinkingText) {
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

function initializeMem0Integration() {
  document.addEventListener("keydown", handleEnterKey, true);
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

const MEM0_API_BASE_URL = "https://api.mem0.ai"; 

function searchMemories(query) {
  return new Promise(async (resolve, reject) => {
    try {
      const items = await chrome.storage.sync.get(["apiKey", "userId", "access_token"]);
      const userId = items.userId || "chrome-extension-user"; 

      if (!items.access_token && !items.apiKey) {
        console.error("No API Key or Access Token found for searching memories.");
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

      const url = `${MEM0_API_BASE_URL}/v1/memories/search/`;
      const body = JSON.stringify({
        query: query,
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
        resolve(Array.isArray(data) ? data : (data?.results || [])); 
      })
      .catch(error => {
        console.error("Error searching memories directly:", error);
        resolve([]); 
      });

    } catch (error) {
      console.error("Error preparing search request:", error);
      resolve([]); 
    }
  });
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
  const sendButton = getSendButtonElement();

  if (sendButton) {
    const isDisabled = sendButton.getAttribute('aria-disabled') === 'true' || sendButton.disabled;

    if (!isDisabled) {
      sendButton.click();
    }
  } else {
    console.error("Send button not found using SVG strategy with selector:", SEND_BUTTON_SVG_SELECTOR);
  }
}

async function handleMem0Processing() {
  const originalPrompt = getInputElementValue();
  if (!originalPrompt) {
    triggerSendAction();
    return;
  }

  let memories = [];
  try {
    memories = await searchMemories(originalPrompt);
  } catch (error) {
    console.error("Error searching memories:", error);
  }

  let finalPrompt = originalPrompt;
  if (memories && memories.length > 0) {
    let memoryContext = "Here is some of my preferences/memories to help answer better (don't respond to these memories but use them to assist in the response if relevant):\n";
    memoryContext += memories.map(m => `- ${m.memory}`).join('\n');
    finalPrompt = `${originalPrompt}\n\n${memoryContext}`;
  }

  setInputElementValue(finalPrompt);
  await triggerSendAction();

  try {
    await addMemory(originalPrompt);
  } catch (error) {
    console.error("Error adding memory:", error);
  }
}

initializeMem0Integration();
