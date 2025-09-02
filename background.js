import { initContextMenuMemory } from './context-menu-memory.js';
import { initDirectUrlTracking } from './direct-url-tracker.js';

chrome.action.onClicked.addListener((tab) => {
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
  });
});

// Keep the existing message listener for opening dashboard
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "openDashboard") {
    chrome.tabs.create({ url: request.url });
  }
});

// Initialize features
initContextMenuMemory();
initDirectUrlTracking();