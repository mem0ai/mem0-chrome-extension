import { initContextMenuMemory } from './context-menu-memory.js';
import { initDirectUrlTracking } from './direct-url-tracker.js';

// Initial setting when extension is installed or updated
chrome.runtime.onInstalled.addListener((details) => {
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "toggleSidebarSettings") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "toggleSidebarSettings" }); 
  } 
}); 

// Initialize features
initContextMenuMemory();
initDirectUrlTracking();