let isProcessingMem0 = false;

// Initialize the MutationObserver variable
let observer;

// Debounce utility function
function debounce(func, delay) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
}

function createPopup(container) {
  const popup = document.createElement("div");
  popup.className = "mem0-popup";
  popup.style.cssText = `
        display: none;
        position: absolute;
        background-color: #171717;
        color: white;
        padding: 6px 8px;
        border-radius: 6px;
        font-size: 12px;
        z-index: 10000;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 11px;
        white-space: nowrap;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    `;
  container.appendChild(popup);
  return popup;
}

function addMem0Button() {
  const textArea = document.querySelector("textarea#prompt-textarea");
  if (!textArea) return;

  const sendButton = textArea.parentElement.querySelector('button[data-testid="send-button"]');

  if (sendButton && !document.querySelector("#mem0-button")) {
    const mem0ButtonContainer = document.createElement("div");
    mem0ButtonContainer.style.position = "relative";
    mem0ButtonContainer.style.display = "flex";
    mem0ButtonContainer.style.alignItems = "center";
    mem0ButtonContainer.style.marginRight = "8px";

    const mem0Button = document.createElement("button");
    mem0Button.id = "mem0-button";
    mem0Button.type = "button";
    mem0Button.style.background = "none";
    mem0Button.style.border = "none";
    mem0Button.style.padding = "0";
    mem0Button.style.margin = "0";
    mem0Button.style.cursor = "pointer";
    mem0Button.style.display = "flex";
    mem0Button.style.alignItems = "center";
    mem0Button.style.justifyContent = "center";
    mem0Button.style.width = "38px";
    mem0Button.style.height = "38px";
    mem0Button.style.borderRadius = "5px";
    mem0Button.style.transition = "background-color 0.2s ease, opacity 0.3s ease";

    const icon = document.createElement("img");
    icon.src = chrome.runtime.getURL("icons/mem0-claude-icon-purple.png");
    icon.style.width = "20px";
    icon.style.height = "20px";
    icon.style.transition = "filter 0.3s ease";
    mem0Button.appendChild(icon);

    // const popup = createPopup(mem0ButtonContainer); // Kept if needed for specific messages for this button

    mem0Button.addEventListener("click", () => handleMem0Click(false)); // Don't auto-send on button click

    mem0Button.addEventListener("mouseenter", () => {
      if (!mem0Button.disabled) {
        mem0Button.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
        tooltip.style.visibility = "visible";
        tooltip.style.opacity = "1";
      }
    });
    mem0Button.addEventListener("mouseleave", () => {
      mem0Button.style.backgroundColor = "transparent";
      tooltip.style.visibility = "hidden";
      tooltip.style.opacity = "0";
    });

    const tooltip = document.createElement("div");
    tooltip.textContent = "Add related memories (Ctrl+M)";
    tooltip.style.visibility = "hidden";
    tooltip.style.backgroundColor = "black";
    tooltip.style.color = "white";
    tooltip.style.textAlign = "center";
    tooltip.style.borderRadius = "4px";
    tooltip.style.padding = "5px 8px";
    tooltip.style.position = "absolute";
    tooltip.style.zIndex = "10001";
    tooltip.style.bottom = "calc(100% + 8px)";
    tooltip.style.left = "50%";
    tooltip.style.transform = "translateX(-50%)";
    tooltip.style.whiteSpace = "nowrap";
    tooltip.style.opacity = "0";
    tooltip.style.transition = "opacity 0.2s ease, visibility 0.2s ease";
    tooltip.style.fontSize = "12px";

    mem0ButtonContainer.appendChild(mem0Button);
    mem0ButtonContainer.appendChild(tooltip);

    const sendButtonWrapper = sendButton.parentNode;
    if (sendButtonWrapper) {
      sendButtonWrapper.insertBefore(mem0ButtonContainer, sendButton);
    }

    function updateButtonStates() {
      const currentInputElement = document.querySelector("textarea#prompt-textarea");
      const hasText = currentInputElement && currentInputElement.value.trim().length > 0;
      mem0Button.disabled = !hasText;
      mem0Button.style.opacity = hasText ? "1" : "0.5";
      mem0Button.style.pointerEvents = hasText ? "auto" : "none";
    }

    updateButtonStates();
    const currentInputElement = document.querySelector("textarea#prompt-textarea");
    if (currentInputElement) {
      currentInputElement.addEventListener("input", updateButtonStates);
    }
  }
}

// New function for toast-like notifications
function showToastNotification(message, type = "info") {
  const toastId = "mem0-toast-notification";
  // Remove existing toast if any
  const existingToast = document.getElementById(toastId);
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement("div");
  toast.id = toastId;
  toast.className = `mem0-toast mem0-toast-${type}`;
  toast.textContent = message;

  toast.style.position = "fixed";
  toast.style.bottom = "20px";
  toast.style.left = "50%";
  toast.style.transform = "translateX(-50%)";
  toast.style.padding = "12px 20px";
  toast.style.borderRadius = "6px";
  toast.style.color = "white";
  toast.style.zIndex = "20000";
  toast.style.fontSize = "14px";
  toast.style.boxShadow = "0 4px 10px rgba(0,0,0,0.25)";
  toast.style.fontFamily = "Arial, sans-serif";
  toast.style.opacity = "0";
  toast.style.transition = "opacity 0.3s ease-in-out";


  if (type === "error") {
    toast.style.backgroundColor = "#E53935"; // Material Design Red
  } else if (type === "success") {
    toast.style.backgroundColor = "#43A047"; // Material Design Green
  } else { // info
    toast.style.backgroundColor = "#1E88E5"; // Material Design Blue
  }

  document.body.appendChild(toast);

  // Trigger fade in
  setTimeout(() => {
    toast.style.opacity = "1";
  }, 50);


  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => {
      if (toast.parentElement) { // Check if still in DOM
        toast.remove();
      }
    }, 300);
  }, 3000);
}


async function handleMem0Click(clickSendButton = false) {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    if (clickSendButton) {
      const sendButton = document.querySelector('button[data-testid="send-button"]');
      if (sendButton) {
        sendButton.click();
      } else {
        console.error("Send button not found");
      }
    }
    return;
  }

  setButtonLoadingState(true);
  const inputElement = document.querySelector("textarea#prompt-textarea");
  let message = getInputValue();

  if (!message || message.trim() === "") {
    showToastNotification("Mem0: No input message found", "error");
    setButtonLoadingState(false);
    return;
  }

  const memInfoRegex =
    /\s*Here is some of my preferences\/memories to help answer better \(don't respond to these memories but use them to assist in the response if relevant\):[\s\S]*$/;
  message = message.replace(memInfoRegex, "").trim();

  if (isProcessingMem0) {
    setButtonLoadingState(false); // Prevent button getting stuck in loading
    return;
  }

  isProcessingMem0 = true;

  try {
    const data = await new Promise((resolve) => {
      chrome.storage.sync.get(
        ["apiKey", "userId", "access_token"],
        (items) => resolve(items)
      );
    });

    const { apiKey, userId = "chrome-extension-user", access_token: accessToken } = data;

    if (!apiKey && !accessToken) {
      showToastNotification("Mem0: No API Key or Access Token found. Please set it in the extension popup.", "error");
      isProcessingMem0 = false;
      setButtonLoadingState(false);
      return;
    }

    const authHeader = accessToken ? `Bearer ${accessToken}` : `Token ${apiKey}`;
    const messages = getLastMessages(2);
    messages.push({ role: "user", content: message });

    const searchResponse = await fetch(
      "https://api.mem0.ai/v1/memories/search/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
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
      showToastNotification(`Mem0: Error processing memories (Code: ${searchResponse.status})`, "error");
      throw new Error(`API request failed with status ${searchResponse.status}`);
    }

    const responseData = await searchResponse.json();

    if (inputElement) {
      const memories = responseData.map((item) => item.memory);

      if (memories.length > 0) {
        let currentContent = inputElement.value;
        currentContent = currentContent.replace(memInfoRegex, "").trim();

        let memoriesText = "\n\nHere is some of my preferences/memories to help answer better (don't respond to these memories but use them to assist in the response if relevant):\n";
        memories.forEach((mem) => {
          memoriesText += `- ${mem}\n`;
        });

        inputElement.value = `${currentContent}${memoriesText}`;
        inputElement.dispatchEvent(new Event("input", { bubbles: true }));
        inputElement.style.height = 'auto';
        inputElement.style.height = (inputElement.scrollHeight) + 'px';
        showToastNotification("Mem0: Memories injected.", "success");
      } else {
        inputElement.value = message;
        inputElement.dispatchEvent(new Event("input", { bubbles: true }));
        showToastNotification("Mem0: No relevant memories found.");
      }
    } else {
      showToastNotification("Mem0: Input field not found.", "error");
    }

    if (clickSendButton) {
      const sendButton = document.querySelector('button[data-testid="send-button"]');
      if (sendButton) {
        setTimeout(() => {
          sendButton.click();
        }, 100);
      } else {
        console.error("Send button not found for auto-click");
      }
    }

    fetch("https://api.mem0.ai/v1/memories/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        messages,
        user_id: userId,
        infer: true,
        metadata: { provider: "ChatGPT" },
      }),
    }).catch((error) => console.error("Error adding memory:", error));

  } catch (error) {
    const currentMessage = getInputValue(); // Get current message at time of error
    console.error(
      "Error in handleMem0Click processing input (length " +
      (currentMessage ? currentMessage.length : 0) +
      "):",
      error
    );
    showToastNotification("Mem0: An unexpected error occurred.", "error");
  } finally {
    isProcessingMem0 = false;
    setButtonLoadingState(false); // Ensure loading state is always reset
  }
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
  const infoIcon = document.createElement("span");
  infoIcon.textContent = "ⓘ ";
  infoIcon.style.marginRight = "3px";

  popup.innerHTML = "";
  popup.appendChild(infoIcon);
  popup.appendChild(document.createTextNode(message));

  popup.style.display = "block";
  setTimeout(() => {
    popup.style.display = "none";
  }, 3000);
}

function setButtonLoadingState(isLoading) {
  const mem0Button = document.querySelector("#mem0-button");
  if (mem0Button) {
    const icon = mem0Button.querySelector("img");
    if (isLoading) {
      mem0Button.disabled = true;
      mem0Button.style.opacity = "0.7";
      if (icon) {
        icon.src = chrome.runtime.getURL("icons/loader.svg");
        icon.style.animation = "spin 1s linear infinite";
      }
    } else {
      mem0Button.disabled = false;
      mem0Button.style.opacity = "1";
      if (icon) {
        icon.src = chrome.runtime.getURL("icons/mem0-claude-icon-purple.png");
        icon.style.animation = "none";
      }
    }
  }
}

function ensureSpinAnimation() {
    if (!document.getElementById('mem0-spin-animation')) {
        const style = document.createElement('style');
        style.id = 'mem0-spin-animation';
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }
}
ensureSpinAnimation();


function getInputValue() {
  const inputElement = document.querySelector("textarea#prompt-textarea");
  return inputElement ? inputElement.value : null;
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

function observeDOMChanges() {
  if (observer) observer.disconnect();

  const debouncedHandler = debounce(function() {
    addMem0Button();
    addSyncButton();
    addEnterKeyInterception();
  }, 300);

  observer = new MutationObserver(debouncedHandler);
  observer.observe(document.body, { childList: true, subtree: true });
}

function initializeMem0Integration() {
  addMem0Button();
  addSyncButton();
  addEnterKeyInterception();

  document.addEventListener("keydown", async function (event) { // Added async here
    if ((event.ctrlKey || event.metaKey) && (event.key === "m" || event.key === "M")) {
      event.preventDefault();
      event.stopPropagation();
      const inputElement = document.getElementById("prompt-textarea"); // Use getElementById for speed

      if (document.activeElement === inputElement && inputElement && inputElement.value.trim() !== "") {
         await handleMem0Click(false); // false = don't click send button, allow review
      } else if (!inputElement || inputElement.value.trim() === "") {
         showToastNotification("Input is empty. Type a message to use Mem0 with Ctrl+M.", "info");
      }
      // If input has content but is not focused, consider if we should still trigger.
      // Current logic: only triggers if focused and has content.
    }
  });
  observeDOMChanges();
}

function addEnterKeyInterception() {
  const inputElement = document.getElementById("prompt-textarea"); // Use getElementById

  if (inputElement && !inputElement.dataset.enterKeyIntercepted) {
    chrome.storage.sync.get({ enterKeyInterceptionEnabled: true }, function (data) {
      if (data.enterKeyInterceptionEnabled) {
        inputElement.dataset.enterKeyIntercepted = "true";

        const handleEnterKey = async function (event) {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault(); // Always prevent default if we are handling it.
              event.stopPropagation();

              const memoryEnabled = await getMemoryEnabledState(); // Global toggle
              const currentInputValue = inputElement.value;

              if (memoryEnabled && currentInputValue.trim() !== "") {
                  await handleMem0Click(true); // true to click send button after processing
              } else {
                  // Memory is disabled OR input is empty. We should send the message directly.
                  if (currentInputValue.trim() !== "") {
                      const sendButton = document.querySelector('button[data-testid="send-button"]');
                      if (sendButton) {
                          sendButton.click();
                      } else {
                          console.error("Send button not found for Enter key press.");
                          // Fallback: try to submit the form if send button is not found
                          let form = inputElement.closest('form');
                          if (form) {
                              form.requestSubmit();
                          }
                      }
                  }
                  // If input is truly empty (not just whitespace), ChatGPT itself won't send.
                  // So, no action needed for an empty input here.
              }
            }
        };

        inputElement.addEventListener("keydown", handleEnterKey, true ); // Use capture phase
      } else {
        // If interception is disabled, ensure we remove our flag if it was previously set
        // Note: Properly removing the specific event listener added above would require storing
        // a reference to `handleEnterKey`. For now, the check `!inputElement.dataset.enterKeyIntercepted`
        // and `data.enterKeyInterceptionEnabled` prevents re-adding if already added for this state.
        // If the setting is toggled off, the listener might remain but won't execute its core logic
        // beyond the initial checks if the setting is re-read inside the handler (which it isn't currently).
        // This is a minor inefficiency but shouldn't break functionality.
        if (inputElement.dataset.enterKeyIntercepted) {
            delete inputElement.dataset.enterKeyIntercepted;
        }
      }
    });
  }
}

function getMemoryEnabledState() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ memory_enabled: true }, function (result) { // Default true
      resolve(result.memory_enabled);
    });
  });
}

// Initialize after DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeMem0Integration);
} else {
  initializeMem0Integration();
}
