let isProcessingMem0 = false;

// Initialize the MutationObserver variable
let observer;

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

async function handleMem0Click(clickSendButton = false) {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    // If memory is disabled, just click the send button if requested
    if (clickSendButton) {
      const sendButton = document.querySelector(
        'button[aria-label="Send prompt"]'
      );
      if (sendButton) {
        sendButton.click();
      } else {
        console.error("Send button not found");
      }
    }
    return;
  }

  // setButtonLoadingState(true);
  const inputElement =
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector("textarea");
  let message = getInputValue();
  if (!message) {
    console.error("No input message found");
    // showPopup(popup, "No input message found");
    // setButtonLoadingState(false);
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
      // showPopup(popup, "No API Key or Access Token found");
      isProcessingMem0 = false;
      // setButtonLoadingState(false);
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

    if (inputElement) {
      const memories = responseData.map((item) => item.memory);
      const providers = responseData.map((item) =>
        item.metadata && item.metadata.provider ? item.metadata.provider : ""
      );

      if (memories.length > 0) {
        let currentContent =
          inputElement.tagName.toLowerCase() === "div"
            ? inputElement.innerHTML
            : inputElement.value;

        const memInfoRegex =
          /\s*Here is some of my preferences\/memories to help answer better (don't respond to these memories but use them to assist in the response if relevant):[\s\S]*$/;
        currentContent = currentContent.replace(memInfoRegex, "").trim();
        const lastParagraphRegex =
          /<p><br class="ProseMirror-trailingBreak"><\/p><p>$/;
        currentContent = currentContent.replace(lastParagraphRegex, "").trim();

        let memoriesContent =
          '<div id="mem0-wrapper" style="background-color: rgb(220, 252, 231); padding: 8px; border-radius: 4px; margin-top: 8px; margin-bottom: 8px;">';
        memoriesContent +=
          "<strong>Here is some of my preferences/memories to help answer better (don't respond to these memories but use them to assist in the response if relevant):</strong>";
        memories.forEach((mem) => {
          memoriesContent += `<div>- ${mem}</div>`;
        });
        memoriesContent += "</div>";

        if (inputElement.tagName.toLowerCase() === "div") {
          inputElement.innerHTML = `${currentContent}<div><br></div>${memoriesContent}`;
        } else {
          inputElement.value = `${currentContent}\n${memoriesContent}`;
        }
        inputElement.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        if (inputElement.tagName.toLowerCase() === "div") {
          inputElement.innerHTML = message;
        } else {
          inputElement.value = message;
        }
        inputElement.dispatchEvent(new Event("input", { bubbles: true }));
        // showPopup(popup, "No memories found");
      }
    } else {
      // showPopup(popup, "No input field found to update");
    }

    // setButtonLoadingState(false);

    if (clickSendButton) {
      const sendButton = document.querySelector(
        'button[aria-label="Send prompt"]'
      );
      if (sendButton) {
        setTimeout(() => {
          sendButton.click();
        }, 100);
      } else {
        console.error("Send button not found");
      }
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
    // setButtonLoadingState(false);
    throw error; // Rethrow the error to be caught in the calling function
  } finally {
    isProcessingMem0 = false;
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

function initializeMem0Integration() {
  document.addEventListener("DOMContentLoaded", () => {
    // addMem0Button();
    addSyncButton();
    addEnterKeyInterception();
  });

  document.addEventListener("keydown", function (event) {
    if (event.ctrlKey && event.key === "m") {
      event.preventDefault();
      (async () => {
        await handleMem0Click(true);
      })();
    }
  });

  observer = new MutationObserver(() => {
    // addMem0Button();
    addSyncButton();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Add a MutationObserver to watch for changes in the DOM
  const observerForEnterKey = new MutationObserver(() => {
    addEnterKeyInterception();
  });

  observerForEnterKey.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function addEnterKeyInterception() {
  const inputElement =
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector("textarea");

  if (inputElement && !inputElement.dataset.enterKeyIntercepted) {
    inputElement.dataset.enterKeyIntercepted = "true";

    inputElement.addEventListener(
      "keydown",
      async function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();

          const memoryEnabled = await getMemoryEnabledState();
          if (memoryEnabled) {
            // Call handleMem0Click
            handleMem0Click(true)
              .then(() => {
                // If you want to submit the message after Mem0 processing:
                // const sendButton = document.querySelector('button[aria-label="Send prompt"]');
                // if (sendButton) sendButton.click();
              })
              .catch((error) => {
                console.error("Error in Mem0 processing:", error);
              });
          } else {
            // If memory is disabled, just click the send button
            const sendButton = document.querySelector(
              'button[aria-label="Send prompt"]'
            );
            if (sendButton) {
              sendButton.click();
            } else {
              console.error("Send button not found");
            }
          }
        }
      },
      true
    );
  }
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
