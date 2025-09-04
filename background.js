import { initContextMenuMemory } from './context-menu-memory.js';
import { initDirectUrlTracking } from './direct-url-tracker.js';
import { sendExtensionEvent, getBrowser } from './utils/util_functions.js';

chrome.action.onClicked.addListener((tab) => {
  sendExtensionEvent("extension_browser_icon_clicked", {
    browser: getBrowser(),
    source: "OPENMEMORY_CHROME_EXTENSION",
    tab_url: tab.url
  });

  // Check auth status and open popup or toggle sidebar
  chrome.storage.sync.get(["apiKey", "access_token"], function (data) {
    if (data.apiKey || data.access_token) {
      chrome.tabs.sendMessage(tab.id, { action: "toggleSidebar" });
    } else {
      chrome.action.openPopup();
    }
  });
});


// Initial setting when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ memory_enabled: true }, function() {
    console.log('Memory enabled set to true on install/update');

    if (details.reason === 'install') {
      sendExtensionEvent("extension_installed", {
        browser: getBrowser(),
        source: "chrome_web_store"
      });
    }
  });
});

// Keep the existing message listener for opening dashboard
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "openDashboard") {
    chrome.tabs.create({ url: request.url });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "toggleSidebarSettings") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "toggleSidebarSettings" }); 
  } 
}); 

// Initialize features
initContextMenuMemory();
initDirectUrlTracking();