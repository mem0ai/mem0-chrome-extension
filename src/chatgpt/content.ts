import { StorageKey, type StorageData } from "../types/storage";
import type { OptionalApiParams, HistoryStateData } from "../types/memory";
import {
  type MemorySearchResponse,
  type LoginData,
  MessageRole,
  DEFAULT_USER_ID,
  Source,
} from "../types/api";
import { detectTheme, Theme, onThemeChange } from "../utils/theme";
import { Provider } from "../types/providers";
import { OPENMEMORY_PROMPTS } from "../utils/llm_prompts";
import { API_MEMORIES, API_SEARCH, APP_LOGIN } from "../consts/api";

export {};

// Colors for different themes
const THEME_COLORS = {
  [Theme.DARK]: {
    // Main button colors
    BUTTON_BG: "rgba(255, 255, 255, 0.12)",
    BUTTON_BG_HOVER: "rgba(255, 255, 255, 0.18)",
    BUTTON_BG_ACTIVE: "rgba(22, 101, 52, 1)",
    BUTTON_BG_ACTIVE_HOVER: "rgba(16, 85, 42, 1)",

    // Borders
    BUTTON_BORDER: "rgba(255, 255, 255, 0.2)",

    // Text
    TEXT_PRIMARY: "white",
    TEXT_SECONDARY: "rgba(255, 255, 255, 0.8)",

    // Notifications
    NOTIFICATION_DOT: "rgb(128, 221, 162)",
    NOTIFICATION_DOT_BORDER: "#1C1C1E",

    // Spinner
    SPINNER_BORDER: "rgba(255, 255, 255, 0.3)",
    SPINNER_ACTIVE: "white",

    // Shortcut
    SHORTCUT_BG: "rgba(255, 255, 255, 0.11)",
    SHORTCUT_TEXT: "white",

    // Popup
    POPUP_BG: "rgba(255, 255, 255, 0.12)",
    POPUP_BORDER: "rgba(255, 255, 255, 0.2)",
    POPUP_TEXT: "white",
    POPUP_SHADOW: "rgba(0, 0, 0, 0.3)",
  },

  [Theme.LIGHT]: {
    // Main button colors
    BUTTON_BG: "rgba(239, 239, 239, 1)",
    BUTTON_BG_HOVER: "rgba(0, 0, 0, 0.12)",
    BUTTON_BG_ACTIVE: "rgba(22, 101, 52, 1)",
    BUTTON_BG_ACTIVE_HOVER: "rgba(16, 85, 42, 1)",

    // Borders
    BUTTON_BORDER: "rgba(255, 255, 255, 0.2)",

    // Text
    TEXT_PRIMARY: "#1a1a1a",
    TEXT_SECONDARY: "rgba(0, 0, 0, 0.7)",

    // Notifications
    NOTIFICATION_DOT: "rgb(22, 163, 74)",
    NOTIFICATION_DOT_BORDER: "#ffffff",

    // Spinner
    SPINNER_BORDER: "rgba(0, 0, 0, 0.2)",
    SPINNER_ACTIVE: "#1a1a1a",

    // Shortcut
    SHORTCUT_BG: "rgba(255, 255, 255, 0.11)",
    SHORTCUT_TEXT: "white",

    // Popup
    POPUP_BG: "rgba(255, 255, 255, 0.95)",
    POPUP_BORDER: "rgba(0, 0, 0, 0.1)",
    POPUP_TEXT: "#1a1a1a",
    POPUP_SHADOW: "rgba(0, 0, 0, 0.15)",
  },
} as const;

// Function to get button styles depending on the theme
const getButtonStyles = (
  theme: Theme
): {
  BASE: string;
  NOTIFICATION_DOT: string;
  TEXT: string;
  CHECKMARK: string;
  SHORTCUT: string;
  SPINNER: string;
} => {
  const colors = THEME_COLORS[theme];

  return {
    BASE: `
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      background-color: ${colors.BUTTON_BG} !important;
      border: 1px solid ${colors.BUTTON_BORDER} !important;
      border-radius: 1200px !important;
      padding: 8px 12px !important;
      margin-left: 8px !important;
      color: ${colors.TEXT_PRIMARY} !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      transition: background-color 0.2s ease !important;
      position: relative !important;
      min-height: 34px !important;
      height: auto !important;
      width: auto !important;
      min-width: auto !important;
    `,
    NOTIFICATION_DOT: `
      position: absolute;
      top: -3px;
      right: -3px;
      width: 10px;
      height: 10px;
      background-color: ${colors.NOTIFICATION_DOT};
      border-radius: 50%;
      border: 2px solid ${colors.NOTIFICATION_DOT_BORDER};
      display: none !important;
      z-index: 1001;
      pointer-events: none;
    `,
    TEXT: `
      color: ${colors.TEXT_PRIMARY};
      font-size: 14px;
      font-weight: 500;
    `,
    CHECKMARK: `
      margin-left: 6px;
      display: none;
      font-size: 14px;
      color: ${colors.TEXT_PRIMARY};
      font-weight: bold;
    `,
    SHORTCUT: `
      background-color: ${colors.SHORTCUT_BG};
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
      font-weight: 500;
      margin-left: 8px;
      display: none;
      color: ${colors.SHORTCUT_TEXT};
    `,
    SPINNER: `
      width: 16px;
      height: 16px;
      border: 2px solid ${colors.SPINNER_BORDER};
      border-top: 2px solid ${colors.SPINNER_ACTIVE};
      border-radius: 50%;
      margin-right: 4px;
      display: none;
      animation: spin 1s linear infinite;
    `,
  };
};

// Get current button styles
let currentTheme = detectTheme();
let BUTTON_STYLES = getButtonStyles(currentTheme);

// Function to unsubscribe from theme changes
let unsubscribeThemeChange: (() => void) | null = null;

// Function to update button styles when theme changes
const updateButtonTheme = (newTheme: Theme): void => {
  currentTheme = newTheme;
  BUTTON_STYLES = getButtonStyles(currentTheme);

  // Update the existing button
  const mem0Button = document.querySelector("#mem0-icon-button") as HTMLElement;
  if (mem0Button) {
    // Update the base styles of the button
    mem0Button.style.cssText = BUTTON_STYLES.BASE;

    // Update the styles of the child elements
    const elements = {
      spinner: mem0Button.querySelector("span:nth-child(1)") as HTMLElement,
      text: mem0Button.querySelector("span:nth-child(2)") as HTMLElement,
      checkmark: mem0Button.querySelector("span:nth-child(3)") as HTMLElement,
      shortcut: mem0Button.querySelector("span:nth-child(4)") as HTMLElement,
      notificationDot: mem0Button.querySelector("div") as HTMLElement,
    };

    if (elements.spinner) elements.spinner.style.cssText = BUTTON_STYLES.SPINNER;
    if (elements.text) elements.text.style.cssText = BUTTON_STYLES.TEXT;
    if (elements.checkmark) elements.checkmark.style.cssText = BUTTON_STYLES.CHECKMARK;
    if (elements.shortcut) elements.shortcut.style.cssText = BUTTON_STYLES.SHORTCUT;
    if (elements.notificationDot) elements.notificationDot.style.cssText = BUTTON_STYLES.NOTIFICATION_DOT;

    // Update hover effects
    setupButtonHoverEffects(mem0Button);

    // Update the notification dot
    updateNotificationDot();
  }
};

let isProcessingMem0: boolean = false;
let isButtonLoading: boolean = false;
let isShowingAdded: boolean = false;

// Initialize the MutationObserver variable
let observer: MutationObserver;

// Global variable to store all memories
let allMemories: string[] = [];

// Track added memories by ID
const allMemoriesById: Set<string> = new Set<string>();

let inputValueCopy: string = "";

// Helper functions for DOM manipulation
function setElementDisplay(element: HTMLElement | null, display: string): void {
  if (element) {
    element.style.display = display;
  }
}

function setElementText(element: HTMLElement | null, text: string): void {
  if (element) {
    element.textContent = text;
  }
}

// Helper for creating styled elements
function createStyledElement(tag: string, styles: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  element.style.cssText = styles;
  if (text) {
    element.textContent = text;
  }
  return element;
}

// Helper for adding CSS animations
function addAnimationStyles(): void {
  if (!document.getElementById("notification-dot-animation")) {
    const style = document.createElement("style");
    style.id = "notification-dot-animation";
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

  if (!document.getElementById("spinner-animation")) {
    const style = document.createElement("style");
    style.id = "spinner-animation";
    style.innerHTML = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

// Helper for creating button elements
function createButtonElements(): {
  loadingSpinner: HTMLElement;
  textElement: HTMLElement;
  checkmarkIcon: HTMLElement;
  shortcutBlock: HTMLElement;
  notificationDot: HTMLElement;
} {
  return {
    loadingSpinner: createStyledElement("span", BUTTON_STYLES.SPINNER),
    textElement: createStyledElement("span", BUTTON_STYLES.TEXT, "Memories"),
    checkmarkIcon: createStyledElement("span", BUTTON_STYLES.CHECKMARK, "✓"),
    shortcutBlock: createStyledElement("span", BUTTON_STYLES.SHORTCUT, "Ctrl + M"),
    notificationDot: createStyledElement("div", BUTTON_STYLES.NOTIFICATION_DOT),
  };
}

// Helper for setting up hover effects
function setupButtonHoverEffects(button: HTMLElement): void {
  const colors = THEME_COLORS[currentTheme];

  button.addEventListener("mouseenter", () => {
    const currentBg = button.style.backgroundColor;
    if (currentBg.includes("22, 101, 52")) {
      button.style.backgroundColor = colors.BUTTON_BG_ACTIVE_HOVER;
    } else {
      button.style.backgroundColor = colors.BUTTON_BG_HOVER;
    }
  });

  button.addEventListener("mouseleave", () => {
    const currentBg = button.style.backgroundColor;
    if (currentBg.includes("16, 85, 42")) {
      button.style.backgroundColor = colors.BUTTON_BG_ACTIVE;
    } else {
      button.style.backgroundColor = colors.BUTTON_BG;
    }
  });
}

// Helper for setting up click handler
function setupButtonClickHandler(button: HTMLElement): void {
  button.addEventListener("click", async () => {
    try {
      const memoryEnabled = await getMemoryEnabledState();
      if (memoryEnabled) {
        await handleMem0Modal("mem0-icon-button");
      }
    } catch (error) {
      console.error("Error handling Mem0 button click:", error);
    }
  });
}

// Helper functions for main logic
function removeExistingButton(): void {
  const existingButton = document.querySelector("#mem0-icon-button") as HTMLElement;
  if (existingButton?.parentNode) {
    (existingButton.parentNode as HTMLElement).remove();
  }

  const floatingContainer = document.querySelector("#mem0-floating-container");
  if (floatingContainer) {
    floatingContainer.remove();
  }
}

function findOrCreateButtonContainer(): HTMLElement | null {
  const plusButton = document.querySelector('button[data-testid="composer-plus-btn"]');
  const leadingContainer = plusButton?.closest('div[class*="leading"]');

  if (plusButton && leadingContainer) {
    return leadingContainer as HTMLElement;
  }

  // Fallback: create floating container
  const inputElement =
    document.querySelector("#prompt-textarea") ||
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector("textarea");

  if (inputElement) {
    const container = document.createElement("div");
    container.id = "mem0-floating-container";
    container.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 1000;
      display: flex;
      gap: 4px;
    `;
    document.body.appendChild(container);
    return container;
  }

  return null;
}

function createButtonContainer(): HTMLElement {
  const container = document.createElement("span");
  container.className = "";
  container.dataset.state = "closed";
  container.style.position = "relative";
  return container;
}

function insertButtonIntoContainer(
  buttonContainer: HTMLElement,
  mem0ButtonContainer: HTMLElement
): void {
  const plusButton = document.querySelector('button[data-testid="composer-plus-btn"]');

  if (plusButton && buttonContainer.contains(plusButton)) {
    plusButton.parentElement?.insertBefore(mem0ButtonContainer, plusButton.nextSibling);
  } else {
    buttonContainer.appendChild(mem0ButtonContainer);
  }

  // Ensure horizontal layout
  buttonContainer.style.cssText += `
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    gap: 8px !important;
  `;
}

function createMem0Button(buttonContainer: HTMLElement): HTMLElement {
  const mem0ButtonContainer = createButtonContainer();
  const mem0Button = createStyledElement("button", BUTTON_STYLES.BASE);

  // Setup button properties
  mem0Button.id = "mem0-icon-button";
  mem0Button.setAttribute("aria-label", "OpenMemory button");
  (mem0Button as HTMLButtonElement).type = "button";

  // Add animations
  addAnimationStyles();

  // Create and append button elements
  const elements = createButtonElements();
  elements.notificationDot.id = "mem0-notification-dot";

  mem0Button.appendChild(elements.loadingSpinner);
  mem0Button.appendChild(elements.textElement);
  mem0Button.appendChild(elements.checkmarkIcon);
  mem0Button.appendChild(elements.shortcutBlock);
  mem0Button.appendChild(elements.notificationDot);

  mem0ButtonContainer.appendChild(mem0Button);
  insertButtonIntoContainer(buttonContainer, mem0ButtonContainer);

  return mem0Button;
}

function setupButtonInteractions(button: HTMLElement): void {
  setupButtonHoverEffects(button);
  setupButtonClickHandler(button);
  updateNotificationDot();
  setTimeout(updateNotificationDot, 500);
}

// Shared function to update the input field with all collected memories
function updateInputWithMemories(): void {
  const inputElement =
    document.querySelector("#prompt-textarea") ||
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector("textarea");

  if (inputElement && allMemories.length > 0) {
    // Get the content without any existing memory wrappers
    const baseContent = getContentWithoutMemories();

    // Create the memory wrapper with all collected memories
    let memoriesContent =
      '<div id="mem0-wrapper" contenteditable="false" style="background-color: rgb(220, 252, 231); padding: 8px; border-radius: 4px; margin-top: 8px; margin-bottom: 8px;">';
    memoriesContent += OPENMEMORY_PROMPTS.memory_header_html_strong;

    // Add all memories to the content
    allMemories.forEach((mem, idx) => {
      const safe = (mem || "").toString();
      memoriesContent += `<div data-mem0-idx="${idx}" style="user-select: text;">- ${safe}</div>`;
    });
    memoriesContent += "</div>";

    // Add the final content to the input
    if (inputElement.tagName.toLowerCase() === "div") {
      inputElement.innerHTML = `${baseContent}<div><br></div>${memoriesContent}`;
    } else {
      inputElement.value = `${baseContent}\n${memoriesContent}`;
    }

    // Make only the wrapper non-editable; allow user to select/copy text inside
    try {
      const wrapper = document.getElementById("mem0-wrapper");
      if (wrapper) {
        wrapper.setAttribute("contenteditable", "false");
        wrapper.style.userSelect = "text";
      }
    } catch (_e) {}

    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// Function to get the content without any memory wrappers
function getContentWithoutMemories(message?: string): string {
  if (typeof message === "string") {
    return message;
  }

  const inputElement =
    (document.querySelector("#prompt-textarea") as HTMLTextAreaElement | HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector("textarea") as HTMLTextAreaElement);

  if (!inputElement) {
    return "";
  }

  let content =
    (inputElement as HTMLTextAreaElement)?.value ||
    inputElement.textContent ||
    (inputElement as HTMLDivElement).innerHTML;

  if (
    message &&
    (!content ||
      content.trim() ===
        '<p data-placeholder="Ask anything" class="placeholder"><br class="ProseMirror-trailingBreak"></p>')
  ) {
    content = message;
  }

  // Remove any memory wrappers
  content = content.replace(/<div id="mem0-wrapper"[\s\S]*?<\/div>/g, "");

  // Remove any memory headers using shared prompts (HTML and plain variants)
  try {
    const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
    const MEM0_HTML = OPENMEMORY_PROMPTS.memory_header_html_regex;
    content = content.replace(MEM0_HTML, "");
    content = content.replace(MEM0_PLAIN, "");
  } catch (_e) {}

  // Clean up any leftover paragraph markers
  content = content.replace(/<p><br class="ProseMirror-trailingBreak"><\/p><p>$/g, "");

  // Replace <p> with nothing
  content = content.replace(/<p>[\s\S]*?<\/p>/g, "");

  return content.trim();
}

// Add an event listener for the send button to clear memories after sending
function addSendButtonListener(): void {
  const sendButton = document.querySelector("#composer-submit-button") as HTMLButtonElement;

  if (sendButton && !sendButton.dataset.mem0Listener) {
    sendButton.dataset.mem0Listener = "true";
    sendButton.addEventListener("click", function () {
      // Capture and save memory asynchronously
      captureAndStoreMemory();

      // Clear all memories after sending
      setTimeout(() => {
        allMemories = [];
        allMemoriesById.clear();
      }, 100);
    });

    // Also handle Enter key press
    const inputElement =
      (document.querySelector("#prompt-textarea") as HTMLTextAreaElement | HTMLDivElement) ||
      (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
      (document.querySelector("textarea") as HTMLTextAreaElement);

    if (inputElement && !inputElement.dataset.mem0KeyListener) {
      inputElement.dataset.mem0KeyListener = "true";
      (inputElement as HTMLElement).addEventListener("keydown", function (event: KeyboardEvent) {
        // Check if Enter was pressed without Shift (standard send behavior)

        inputValueCopy =
          (inputElement as HTMLTextAreaElement)?.value ||
          inputElement.textContent ||
          inputValueCopy;

        if (event.key === "Enter" && !event.shiftKey) {
          // Capture and save memory asynchronously
          captureAndStoreMemory();

          // Clear all memories after sending
          setTimeout(() => {
            allMemories = [];
            allMemoriesById.clear();
          }, 100);
        }
      });
    }
  }
}

// Function to capture and store memory asynchronously
function captureAndStoreMemory(): void {
  // Get the message content
  // id is prompt-textarea
  const inputElement =
    (document.querySelector("#prompt-textarea") as HTMLTextAreaElement | HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector("textarea") as HTMLTextAreaElement) ||
    (document.querySelector('textarea[data-virtualkeyboard="true"]') as HTMLTextAreaElement);

  if (!inputElement) {
    return;
  }

  // Get raw content from the input element
  let message = inputElement.textContent || (inputElement as HTMLTextAreaElement)?.value;

  if (!message || message.trim() === "") {
    message = inputValueCopy;
  }

  if (!message || message.trim() === "") {
    return;
  }

  // Clean the message of any memory wrapper content
  message = getContentWithoutMemories(message);

  // Skip if message is empty after cleaning
  if (!message || message.trim() === "") {
    return;
  }

  // Asynchronously store the memory
  chrome.storage.sync.get(
    [
      StorageKey.API_KEY,
      StorageKey.USER_ID_CAMEL,
      StorageKey.ACCESS_TOKEN,
      StorageKey.MEMORY_ENABLED,
      StorageKey.SELECTED_ORG,
      StorageKey.SELECTED_PROJECT,
      StorageKey.USER_ID,
    ],
    function (items) {
      // Skip if memory is disabled or no credentials
      if (
        items[StorageKey.MEMORY_ENABLED] === false ||
        (!items[StorageKey.API_KEY] && !items[StorageKey.ACCESS_TOKEN])
      ) {
        return;
      }

      const authHeader = items[StorageKey.ACCESS_TOKEN]
        ? `Bearer ${items[StorageKey.ACCESS_TOKEN]}`
        : `Token ${items[StorageKey.API_KEY]}`;

      const userId =
        items[StorageKey.USER_ID_CAMEL] || items[StorageKey.USER_ID] || DEFAULT_USER_ID;

      // Get recent messages for context (if available)
      const messages = getLastMessages(2);
      messages.push({ role: MessageRole.User, content: message });

      const optionalParams: OptionalApiParams = {};
      if (items[StorageKey.SELECTED_ORG]) {
        optionalParams.org_id = items[StorageKey.SELECTED_ORG];
      }
      if (items[StorageKey.SELECTED_PROJECT]) {
        optionalParams.project_id = items[StorageKey.SELECTED_PROJECT];
      }

      // Send memory to mem0 API asynchronously without waiting for response
      const storagePayload = {
        messages: messages,
        user_id: userId,
        infer: true,
        metadata: {
          provider: Provider.ChatGPT,
        },
        source: Source.OPENMEMORY_CHROME_EXTENSION,
        ...optionalParams,
      };

      fetch(API_MEMORIES, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(storagePayload),
      }).catch(error => {
        console.error("Error saving memory:", error);
      });
    }
  );
}

// Function to add the Mem0 button next to the plus icon
async function addMem0IconButton(): Promise<void> {
  // Check if memory is enabled
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    removeExistingButton();
    return;
  }

  const buttonContainer = findOrCreateButtonContainer();
  if (!buttonContainer || document.querySelector("#mem0-icon-button")) {
    return;
  }

  const mem0Button = createMem0Button(buttonContainer);
  setupButtonInteractions(mem0Button);

  // Add send button listener
  addSendButtonListener();
}

// Helper function to update text color based on button state
function updateButtonTextColor(button: HTMLElement, isActive: boolean): void {
  const textElement = button.querySelector("span:nth-child(2)") as HTMLElement;
  const checkmarkElement = button.querySelector("span:nth-child(3)") as HTMLElement;

  if (currentTheme === Theme.LIGHT) {
    // In light theme: black text for inactive (gray), white text for active (green)
    const textColor = isActive ? "white" : "#1a1a1a";

    if (textElement) textElement.style.color = textColor;
    if (checkmarkElement) checkmarkElement.style.color = textColor;
  }
}

async function updateNotificationDot(): Promise<void> {
  // Check if memory is enabled
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    return; // Don't update notification dot if memory is disabled
  }

  const inputElement =
    (document.querySelector("#prompt-textarea") as HTMLTextAreaElement | HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector("textarea") as HTMLTextAreaElement);

  const mem0Button = document.querySelector("#mem0-icon-button") as HTMLElement;
  const notificationDot = document.querySelector("#mem0-notification-dot") as HTMLElement;

  if (inputElement && mem0Button && notificationDot) {
    // Function to check if input has text and update button state
    const checkForText = () => {
      // Don't update button state if loading or showing "Added"
      if (isButtonLoading || isShowingAdded) {
        return;
      }

      const hasText = (inputElement.textContent || inputElement.value || "").trim() !== "";

      // Find elements once
      const checkmarkIcon = mem0Button?.querySelector("span:nth-child(3)") as HTMLElement;
      const shortcutBlock = mem0Button?.querySelector("span:nth-child(4)") as HTMLElement;

      // Apply styles
      const colors = THEME_COLORS[currentTheme];
      mem0Button.style.backgroundColor = hasText ? colors.BUTTON_BG_ACTIVE : colors.BUTTON_BG;
      notificationDot.style.display = "none";

      const displayValue = hasText ? "inline-block" : "none";
      setElementDisplay(checkmarkIcon, displayValue);
      setElementDisplay(shortcutBlock, displayValue);

      // Update text color based on button state
      updateButtonTextColor(mem0Button, hasText);
    };

    // Set up an observer to watch for changes to the input field
    const inputObserver = new MutationObserver(checkForText);

    // Start observing the input element
    inputObserver.observe(inputElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    // Also check on input and keyup events
    inputElement.addEventListener("input", checkForText);
    inputElement.addEventListener("keyup", checkForText);
    inputElement.addEventListener("focus", checkForText);

    // Initial check
    checkForText();

    // Force check after a small delay to ensure DOM is fully loaded
    setTimeout(checkForText, 500);
  } else {
    // If elements aren't found immediately, try again after a short delay
    setTimeout(updateNotificationDot, 1000);
  }
}

// Modified function to handle Mem0 modal instead of direct injection
async function handleMem0Modal(sourceButtonId: string | null = null): Promise<void> {
  const memoryEnabled = await getMemoryEnabledState();
  if (!memoryEnabled) {
    return;
  }

  // Check if user is logged in
  const loginData = await new Promise<LoginData>(resolve => {
    chrome.storage.sync.get(
      [StorageKey.API_KEY, StorageKey.USER_ID_CAMEL, StorageKey.ACCESS_TOKEN],
      function (items) {
        resolve(items);
      }
    );
  });

  // If no API key and no access token, show login popup
  if (!loginData[StorageKey.API_KEY] && !loginData[StorageKey.ACCESS_TOKEN]) {
    showLoginPopup();
    return;
  }

  let message = getInputValue();
  // If no message, just return without showing popup
  if (!message || message.trim() === "") {
    return;
  }

  try {
    const MEM0_PLAIN = OPENMEMORY_PROMPTS.memory_header_plain_regex;
    message = message.replace(MEM0_PLAIN, "").trim();
  } catch (_e) {}
  const endIndex = message.indexOf("</p>");
  if (endIndex !== -1) {
    message = message.slice(0, endIndex + 4);
  }

  if (isProcessingMem0) {
    return;
  }

  isProcessingMem0 = true;

  // Show loading spinner
  updateButtonState("loading");

  try {
    const data = await new Promise<StorageData>(resolve => {
      chrome.storage.sync.get(
        [
          StorageKey.API_KEY,
          StorageKey.USER_ID_CAMEL,
          StorageKey.ACCESS_TOKEN,
          StorageKey.SELECTED_ORG,
          StorageKey.SELECTED_PROJECT,
          StorageKey.USER_ID,
          StorageKey.SIMILARITY_THRESHOLD,
          StorageKey.TOP_K,
        ],
        function (items) {
          resolve(items);
        }
      );
    });

    const apiKey = data[StorageKey.API_KEY];
    const userId = data[StorageKey.USER_ID_CAMEL] || data[StorageKey.USER_ID] || DEFAULT_USER_ID;
    const accessToken = data[StorageKey.ACCESS_TOKEN];
    const threshold =
      data[StorageKey.SIMILARITY_THRESHOLD] !== undefined
        ? data[StorageKey.SIMILARITY_THRESHOLD]
        : 0.1;
    const topK = data[StorageKey.TOP_K] !== undefined ? data[StorageKey.TOP_K] : 10;

    if (!apiKey && !accessToken) {
      isProcessingMem0 = false;
      return;
    }

    const authHeader = accessToken ? `Bearer ${accessToken}` : `Token ${apiKey}`;

    const messages = getLastMessages(2);
    messages.push({ role: MessageRole.User, content: message });

    const optionalParams: OptionalApiParams = {};
    if (data[StorageKey.SELECTED_ORG]) {
      optionalParams.org_id = data[StorageKey.SELECTED_ORG];
    }
    if (data[StorageKey.SELECTED_PROJECT]) {
      optionalParams.project_id = data[StorageKey.SELECTED_PROJECT];
    }

    // Existing search API call
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
      source: Source.OPENMEMORY_CHROME_EXTENSION,
      ...optionalParams,
    };

    const searchResponse = await fetch(API_SEARCH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(searchPayload),
    });

    if (!searchResponse.ok) {
      throw new Error(`API request failed with status ${searchResponse.status}`);
    }

    const responseData = await searchResponse.json();

    // Get memory items from search
    const memoryItems = ((responseData || []) as MemorySearchResponse).map(item => ({
      id: item.id,
      text: item.memory,
      categories: item.categories || [],
    }));

    // Instead of showing modal, directly add all memories to input
    if (memoryItems.length > 0) {
      // Clear existing memories
      allMemories = [];
      allMemoriesById.clear();

      // Add all found memories
      memoryItems.forEach(memory => {
        allMemoriesById.add(String(memory.id));
        allMemories.push(String(memory.text || ""));
      });

      // Update input with all memories
      updateInputWithMemories();
    }

    // Show memories popup
    if (memoryItems.length > 0) {
      showMemoriesPopup(true);
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
          provider: Provider.ChatGPT,
        },
        source: Source.OPENMEMORY_CHROME_EXTENSION,
        ...optionalParams,
      }),
    }).catch(error => {
      console.error("Error adding memory:", error);
    });
  } catch (error) {
    console.error("Error:", error);

    // Hide loading spinner and show error popup
    updateButtonState("error");

    // Show error popup
    showMemoriesPopup(false);

    throw error;
  } finally {
    setTimeout(() => updateButtonState("added"), 500);
    setTimeout(() => updateButtonState("success"), 1500);
    isProcessingMem0 = false;
  }
}

// Function to update button state (loading, success, error, added)
function updateButtonState(state: "loading" | "success" | "error" | "added"): void {
  const mem0Button = document.querySelector("#mem0-icon-button") as HTMLElement;
  if (!mem0Button) {
    return;
  }

  const elements = {
    spinner: mem0Button.querySelector("span:nth-child(1)") as HTMLElement,
    text: mem0Button.querySelector("span:nth-child(2)") as HTMLElement,
    checkmark: mem0Button.querySelector("span:nth-child(3)") as HTMLElement,
    shortcut: mem0Button.querySelector("span:nth-child(4)") as HTMLElement,
  };

  // Configuration for each state
  const colors = THEME_COLORS[currentTheme];
  const stateConfig = {
    loading: {
      spinner: true,
      text: "Memories",
      checkmark: false,
      shortcut: false,
      bgColor: colors.BUTTON_BG_ACTIVE,
      isLoading: true,
      isShowingAdded: false,
      isActive: true,
    },
    added: {
      spinner: false,
      text: "Added",
      checkmark: false,
      shortcut: false,
      bgColor: colors.BUTTON_BG_ACTIVE,
      isLoading: false,
      isShowingAdded: true,
      isActive: true,
    },
    success: {
      spinner: false,
      text: "Memories",
      checkmark: true,
      shortcut: true,
      bgColor: colors.BUTTON_BG_ACTIVE,
      isLoading: false,
      isShowingAdded: false,
      isActive: true,
    },
    error: {
      spinner: false,
      text: "Memories",
      checkmark: true,
      shortcut: true,
      bgColor: colors.BUTTON_BG,
      isLoading: false,
      isShowingAdded: false,
      isActive: false,
    },
  };

  const config = stateConfig[state];

  // Apply configuration
  isButtonLoading = config.isLoading;
  isShowingAdded = config.isShowingAdded;

  setElementDisplay(elements.spinner, config.spinner ? "inline-block" : "none");
  setElementText(elements.text, config.text);
  setElementDisplay(elements.text, "inline-block");
  setElementDisplay(elements.checkmark, config.checkmark ? "inline-block" : "none");
  setElementDisplay(elements.shortcut, config.shortcut ? "inline-block" : "none");

  mem0Button.style.backgroundColor = config.bgColor;

  // Override text color for loading state in light theme to ensure black text
  if (currentTheme === Theme.LIGHT && state === "loading") {
    if (elements.text) elements.text.style.color = "#1a1a1a";
    if (elements.checkmark) elements.checkmark.style.color = "#1a1a1a";
  } else {
    // Update text color based on button state, only if not light theme and loading
    updateButtonTextColor(mem0Button, config.isActive);
  }
}

// Function to show memories popup
function showMemoriesPopup(isSuccess: boolean): void {
  // Remove any existing popups
  const existingPopup = document.querySelector(".mem0-memories-popup") as HTMLElement;
  if (existingPopup) {
    existingPopup.remove();
  }

  const popup = document.createElement("div");
  popup.className = "mem0-memories-popup";

  const colors = THEME_COLORS[currentTheme];
  popup.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background-color: ${colors.POPUP_BG};
    border: 1px solid ${colors.POPUP_BORDER};
    border-radius: 12px;
    color: ${colors.POPUP_TEXT};
    padding: 16px;
    width: 300px;
    z-index: 10001;
    box-shadow: 0 4px 20px ${colors.POPUP_SHADOW};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Create content
  const content = document.createElement("div");
  content.style.cssText = `
    font-size: 14px;
    line-height: 1.4;
    color: ${colors.POPUP_TEXT};
    text-align: center;
  `;

  if (isSuccess) {
    content.textContent = "Memories added";
  } else {
    content.textContent = "Error while adding memories";
  }

  popup.appendChild(content);

  // Add to body
  document.body.appendChild(popup);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (document.body.contains(popup)) {
      popup.remove();
    }
  }, 3000);
}

// Safe no-op to prevent ReferenceError if auto-inject prefetch isn't defined elsewhere
function setupAutoInjectPrefetch(): void {
  try {
    // Intentionally left blank; legacy callers expect this to exist.
    // Inline hint handles lightweight suggestion awareness.
  } catch (_e) {}
}

function getLastMessages(count: number): Array<{ role: MessageRole; content: string }> {
  const messageContainer = document.querySelector(".flex.flex-col.text-sm.md\\:pb-9");
  if (!messageContainer) {
    return [];
  }

  const messageElements = Array.from(messageContainer.children).reverse();
  const messages: Array<{ role: MessageRole; content: string }> = [];

  for (const element of messageElements) {
    if (messages.length >= count) {
      break;
    }

    const userElement = element.querySelector('[data-message-author-role="user"]');
    const assistantElement = element.querySelector('[data-message-author-role="assistant"]');

    if (userElement) {
      const content = userElement.querySelector(".whitespace-pre-wrap")?.textContent?.trim() || "";
      messages.unshift({ role: MessageRole.User, content });
    } else if (assistantElement) {
      const content = assistantElement.querySelector(".markdown")?.textContent?.trim() || "";
      messages.unshift({ role: MessageRole.Assistant, content });
    }
  }

  return messages;
}

function getInputValue(): string {
  const inputElement =
    (document.querySelector("#prompt-textarea") as HTMLTextAreaElement | HTMLDivElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLDivElement) ||
    (document.querySelector("textarea") as HTMLTextAreaElement);

  return inputElement
    ? inputElement.textContent || (inputElement as HTMLTextAreaElement)?.value || ""
    : "";
}

function addSyncButton(): void {
  const buttonContainer = document.querySelector("div.mt-5.flex.justify-end");
  if (buttonContainer) {
    let syncButton = document.querySelector("#sync-button") as HTMLButtonElement;

    // If the syncButton does not exist, create it
    if (!syncButton) {
      syncButton = document.createElement("button");
      syncButton.id = "sync-button";
      syncButton.className = "btn relative btn-neutral mr-2";
      syncButton.style.color = "rgb(213, 213, 213)";
      syncButton.style.backgroundColor = "transparent";
      syncButton.innerHTML =
        '<div id="sync-button-content" class="flex items-center justify-center font-semibold">Sync Memory</div>';
      syncButton.style.border = "1px solid rgb(213, 213, 213)";
      syncButton.style.fontSize = "12px";
      syncButton.style.fontWeight = "500";
      // add margin right to syncButton
      syncButton.style.marginRight = "8px";

      const syncIcon = document.createElement("img");
      syncIcon.src = chrome.runtime.getURL("icons/mem0-claude-icon.png");
      syncIcon.style.width = "16px";
      syncIcon.style.height = "16px";
      syncIcon.style.marginRight = "8px";

      syncButton.prepend(syncIcon);

      syncButton.addEventListener("click", handleSyncClick);

      syncButton.addEventListener("mouseenter", () => {
        if (!syncButton!.disabled) {
          syncButton!.style.filter = "opacity(0.7)";
        }
      });
      syncButton.addEventListener("mouseleave", () => {
        if (!syncButton!.disabled) {
          syncButton!.style.filter = "opacity(1)";
        }
      });
    }

    if (!buttonContainer.contains(syncButton)) {
      buttonContainer.insertBefore(syncButton, buttonContainer.firstChild);
    }

    // Optionally, handle the disabled state
    function updateSyncButtonState(): void {
      // Define when the sync button should be enabled or disabled
      (syncButton as HTMLButtonElement).disabled = false; // For example, always enabled
      // Update opacity or pointer events if needed
      if ((syncButton as HTMLButtonElement).disabled) {
        (syncButton as HTMLButtonElement).style.opacity = "0.5";
        (syncButton as HTMLButtonElement).style.pointerEvents = "none";
      } else {
        (syncButton as HTMLButtonElement).style.opacity = "1";
        (syncButton as HTMLButtonElement).style.pointerEvents = "auto";
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

function handleSyncClick(): void {
  getMemoryEnabledState().then(memoryEnabled => {
    if (!memoryEnabled) {
      const btn = document.querySelector("#sync-button") as HTMLElement;
      if (btn) {
        showSyncPopup(btn, "Memory is disabled");
      }
      return;
    }

    const table = document.querySelector("table.w-full.border-separate.border-spacing-0");
    const syncButton = document.querySelector("#sync-button") as HTMLButtonElement;

    if (table && syncButton) {
      const rows = table.querySelectorAll("tbody tr");
      const memories: Array<{ role: string; content: string }> = [];

      // Change sync button state to loading
      setSyncButtonLoadingState(true);

      let syncedCount = 0;
      const totalCount = rows.length;

      rows.forEach(row => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 1 && cells[0]) {
          const content =
            cells[0].querySelector("div.whitespace-pre-wrap")?.textContent?.trim() || "";

          const memory = {
            role: MessageRole.User,
            content: `Remember this about me: ${content}`,
          };

          memories.push(memory);

          sendMemoryToMem0(memory, false)
            .then(() => {
              syncedCount++;
              if (syncedCount === totalCount) {
                showSyncPopup(syncButton, `${syncedCount} memories synced`);
                setSyncButtonLoadingState(false);
                // Open the modal with memories after syncing
                // handleMem0Modal('sync-button');
              }
            })
            .catch(error => {
              if (syncedCount === totalCount) {
                showSyncPopup(syncButton, `${syncedCount}/${totalCount} memories synced`);
                setSyncButtonLoadingState(false);
                // Open the modal with memories after syncing
                // handleMem0Modal('sync-button');
              }
            });
        }
      });

      sendMemoriesToMem0(memories)
        .then(() => {
          if (syncButton) {
            showSyncPopup(syncButton, `${memories.length} memories synced`);
          }
          setSyncButtonLoadingState(false);
          // Open the modal with memories after syncing
          handleMem0Modal("sync-button");
        })
        .catch(error => {
          console.error("Error syncing memories:", error);
          if (syncButton) {
            showSyncPopup(syncButton, "Error syncing memories");
          }
          setSyncButtonLoadingState(false);
          // Open the modal even if there was an error
          handleMem0Modal("sync-button");
        });
    } else {
      console.error("Table or Sync button not found");
    }
  });
}

// New function to send memories in batch
function sendMemoriesToMem0(memories: Array<{ role: string; content: string }>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.sync.get(
      [
        StorageKey.API_KEY,
        StorageKey.USER_ID_CAMEL,
        StorageKey.ACCESS_TOKEN,
        StorageKey.SELECTED_ORG,
        StorageKey.SELECTED_PROJECT,
        StorageKey.USER_ID,
      ],
      function (items) {
        if (items[StorageKey.API_KEY] || items[StorageKey.ACCESS_TOKEN]) {
          const authHeader = items[StorageKey.ACCESS_TOKEN]
            ? `Bearer ${items[StorageKey.ACCESS_TOKEN]}`
            : `Token ${items[StorageKey.API_KEY]}`;
          const userId =
            items[StorageKey.USER_ID_CAMEL] || items[StorageKey.USER_ID] || DEFAULT_USER_ID;

          const optionalParams: OptionalApiParams = {};
          if (items[StorageKey.SELECTED_ORG]) {
            optionalParams.org_id = items[StorageKey.SELECTED_ORG];
          }
          if (items[StorageKey.SELECTED_PROJECT]) {
            optionalParams.project_id = items[StorageKey.SELECTED_PROJECT];
          }

          fetch(API_MEMORIES, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: authHeader,
            },
            body: JSON.stringify({
              messages: memories,
              user_id: userId,
              infer: true,
              metadata: {
                provider: Provider.ChatGPT,
              },
              source: Source.OPENMEMORY_CHROME_EXTENSION,
              ...optionalParams,
            }),
          })
            .then(response => {
              if (!response.ok) {
                reject(`Failed to add memories: ${response.status}`);
              } else {
                resolve();
              }
            })
            .catch(error => reject(`Error sending memories to Mem0: ${error}`));
        } else {
          reject("API Key/Access Token not set");
        }
      }
    );
  });
}

function setSyncButtonLoadingState(isLoading: boolean): void {
  const syncButton = document.querySelector("#sync-button") as HTMLButtonElement;
  const syncButtonContent = document.querySelector("#sync-button-content") as HTMLElement;
  if (syncButton) {
    if (isLoading) {
      syncButton.disabled = true;
      syncButton.style.cursor = "wait";
      document.body.style.cursor = "wait";
      syncButton.style.opacity = "0.7";
      if (syncButtonContent) {
        syncButtonContent.textContent = "Syncing...";
      }
    } else {
      syncButton.disabled = false;
      syncButton.style.cursor = "pointer";
      syncButton.style.opacity = "1";
      document.body.style.cursor = "default";
      if (syncButtonContent) {
        syncButtonContent.textContent = "Sync Memory";
      }
    }
  }
}

function showSyncPopup(button: HTMLElement, message: string): void {
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

function sendMemoryToMem0(
  memory: { role: string; content: string },
  infer: boolean = true
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.sync.get(
      [
        StorageKey.API_KEY,
        StorageKey.USER_ID_CAMEL,
        StorageKey.ACCESS_TOKEN,
        StorageKey.SELECTED_ORG,
        StorageKey.SELECTED_PROJECT,
        StorageKey.USER_ID,
      ],
      function (items) {
        if (items[StorageKey.API_KEY] || items[StorageKey.ACCESS_TOKEN]) {
          const authHeader = items[StorageKey.ACCESS_TOKEN]
            ? `Bearer ${items[StorageKey.ACCESS_TOKEN]}`
            : `Token ${items[StorageKey.API_KEY]}`;
          const userId =
            items[StorageKey.USER_ID_CAMEL] || items[StorageKey.USER_ID] || DEFAULT_USER_ID;

          const optionalParams: OptionalApiParams = {};
          if (items[StorageKey.SELECTED_ORG]) {
            optionalParams.org_id = items[StorageKey.SELECTED_ORG];
          }
          if (items[StorageKey.SELECTED_PROJECT]) {
            optionalParams.project_id = items[StorageKey.SELECTED_PROJECT];
          }

          fetch(API_MEMORIES, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: authHeader,
            },
            body: JSON.stringify({
              messages: [{ content: memory.content, role: MessageRole.User }],
              user_id: userId,
              infer: infer,
              metadata: {
                provider: Provider.ChatGPT,
              },
              source: Source.OPENMEMORY_CHROME_EXTENSION,
              ...optionalParams,
            }),
          })
            .then(response => {
              if (!response.ok) {
                reject(`Failed to add memory: ${response.status}`);
              } else {
                resolve();
              }
            })
            .catch(error => reject(`Error sending memory to Mem0: ${error}`));
        } else {
          reject("API Key/Access Token not set");
        }
      }
    );
  });
}

// Add this new function to get the memory_enabled state
function getMemoryEnabledState(): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    chrome.storage.sync.get([StorageKey.MEMORY_ENABLED], function (result) {
      resolve(result.memory_enabled !== false); // Default to true if not set
    });
  });
}

// Returns whether auto-inject is enabled (default: false if not present)
// (auto-inject helpers removed)

// Update the initialization function to add the Mem0 icon button but not intercept Enter key
function initializeMem0Integration(): void {
  // Initialize the listener for theme changes
  unsubscribeThemeChange = onThemeChange(updateButtonTheme);

  document.addEventListener("DOMContentLoaded", () => {
    addSyncButton();
    (async () => await addMem0IconButton())();
    addSendButtonListener();
    (async () => await updateNotificationDot())();
    setupAutoInjectPrefetch();
  });

  document.addEventListener("keydown", function (event) {
    if (event.ctrlKey && event.key === "m") {
      event.preventDefault();
      (async () => {
        await handleMem0Modal("mem0-icon-button");
      })();
    }
  });

  // Remove global Enter interception previously added for auto-inject

  observer = new MutationObserver(() => {
    addSyncButton();
    (async () => await addMem0IconButton())();
    addSendButtonListener();
    (async () => await updateNotificationDot())();
    setupAutoInjectPrefetch();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Add a MutationObserver to watch for changes in the DOM but don't intercept Enter key
  const observerForUI = new MutationObserver(() => {
    (async () => await addMem0IconButton())();
    addSendButtonListener();
    (async () => await updateNotificationDot())();
    setupAutoInjectPrefetch();
  });

  observerForUI.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// (global auto-inject interceptors removed)

// Function to show login popup
function showLoginPopup(): void {
  // First remove any existing popups
  const existingPopup = document.querySelector("#mem0-login-popup");
  if (existingPopup) {
    existingPopup.remove();
  }

  // Create popup container
  const popupOverlay = document.createElement("div");
  popupOverlay.id = "mem0-login-popup";
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

  const popupContainer = document.createElement("div");
  popupContainer.style.cssText = `
    background-color: #1C1C1E;
    border-radius: 12px;
    width: 320px;
    padding: 24px;
    color: white;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Close button
  const closeButton = document.createElement("button");
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
  closeButton.innerHTML = "&times;";
  closeButton.addEventListener("click", () => {
    document.body.removeChild(popupOverlay);
  });

  // Logo and heading
  const logoContainer = document.createElement("div");
  logoContainer.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
  `;

  const logo = document.createElement("img");
  logo.src = chrome.runtime.getURL("icons/mem0-claude-icon.png");
  logo.style.cssText = `
    width: 24px;
    height: 24px;
    border-radius: 50%;
    margin-right: 12px;
  `;

  const logoDark = document.createElement("img");
  logoDark.src = chrome.runtime.getURL("icons/mem0-icon-black.png");
  logoDark.style.cssText = `
    width: 24px;
    height: 24px;
    border-radius: 50%;
    margin-right: 12px;
  `;

  const heading = document.createElement("h2");
  heading.textContent = "Sign in to OpenMemory";
  heading.style.cssText = `
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  `;

  logoContainer.appendChild(heading);

  // Message
  const message = document.createElement("p");
  message.textContent =
    "Please sign in to access your memories and personalize your conversations!";
  message.style.cssText = `
    margin-bottom: 24px;
    color: #D4D4D8;
    font-size: 14px;
    line-height: 1.5;
    text-align: center;
  `;

  // Sign in button
  const signInButton = document.createElement("button");
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
  const signInText = document.createElement("span");
  signInText.textContent = "Sign in with Mem0";

  signInButton.appendChild(logoDark);
  signInButton.appendChild(signInText);

  signInButton.addEventListener("mouseenter", () => {
    signInButton.style.backgroundColor = "#f5f5f5";
  });

  signInButton.addEventListener("mouseleave", () => {
    signInButton.style.backgroundColor = "white";
  });

  // Open sign-in page when clicked
  signInButton.addEventListener("click", () => {
    window.open(APP_LOGIN, "_blank");
    document.body.removeChild(popupOverlay);
  });

  // Assemble popup
  popupContainer.appendChild(logoContainer);
  popupContainer.appendChild(message);
  popupContainer.appendChild(signInButton);

  popupOverlay.appendChild(popupContainer);
  popupOverlay.appendChild(closeButton);

  // Add click event to close when clicking outside
  popupOverlay.addEventListener("click", e => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });

  // Add to body
  document.body.appendChild(popupOverlay);
}

initializeMem0Integration();
// --- SPA navigation handling and extension context guard (mirrors Claude) ---
let chatgptExtensionContextValid = true;
let chatgptCurrentUrl = window.location.href;

function chatgptCheckExtensionContext(): boolean {
  try {
    // chrome.runtime may throw if context invalidated
    // Using optional chaining to avoid ReferenceError
    // lastError exists only after an API call; treat presence of runtime as validity
    const isValid = !!(chrome && chrome.runtime);
    if (chatgptExtensionContextValid && !isValid) {
      chatgptExtensionContextValid = false;
    }
    return isValid;
  } catch (_e) {
    chatgptExtensionContextValid = false;
    return false;
  }
}

function chatgptDetectNavigation(): void {
  const newUrl = window.location.href;
  if (newUrl !== chatgptCurrentUrl) {
    chatgptCurrentUrl = newUrl;

    // Re-initialize UI after small delay for DOM to settle
    setTimeout(() => {
      try {
        addSyncButton();
        (async () => await addMem0IconButton())();
        addSendButtonListener();
        (async () => await updateNotificationDot())();
      } catch (_e) {}
    }, 300);
  }
}

// Poll for SPA navigations and context validity
setInterval(() => {
  chatgptCheckExtensionContext();
  chatgptDetectNavigation();
}, 1000);

// Hook browser history navigation
window.addEventListener("popstate", () => setTimeout(chatgptDetectNavigation, 100));
const chatgptOriginalPushState = history.pushState;
history.pushState = function (data: HistoryStateData, unused: string, url?: string | URL | null) {
  chatgptOriginalPushState.call(history, data, unused, url);
  setTimeout(chatgptDetectNavigation, 100);
};
const chatgptOriginalReplaceState = history.replaceState;
history.replaceState = function (
  data: HistoryStateData,
  unused: string,
  url?: string | URL | null
) {
  chatgptOriginalReplaceState.call(history, data, unused, url);
  setTimeout(chatgptDetectNavigation, 100);
};
