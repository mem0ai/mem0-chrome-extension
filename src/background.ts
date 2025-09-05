import type { OpenDashboardMessage } from "./types/messages";
import { SidebarAction } from "./types/messages";
import { initContextMenuMemory } from "./context-menu-memory";
import { initDirectUrlTracking } from "./direct-url-tracker";
import { StorageKey } from "./types/storage";


chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ memory_enabled: true }, () => {
    console.log("Memory enabled set to true on install/update");
  });
});

chrome.runtime.onMessage.addListener(
  (
    request: OpenDashboardMessage,
    _sender: chrome.runtime.MessageSender,
    _sendResponse: () => void
  ) => {
    if (request.action === SidebarAction.OPEN_DASHBOARD && request.url) {
      chrome.tabs.create({ url: request.url });
    }
    return undefined;
  }
);

chrome.runtime.onMessage.addListener(
  (
    request: { action?: string },
    sender: chrome.runtime.MessageSender,
    _sendResponse: () => void
  ) => {
    if (request.action === SidebarAction.SIDEBAR_SETTINGS) {
      const tabId = sender.tab?.id;
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, { action: SidebarAction.SIDEBAR_SETTINGS });
      }
    }
    return undefined;
  }
);

initContextMenuMemory();
initDirectUrlTracking();
