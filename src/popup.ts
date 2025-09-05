import { SidebarAction } from "./types/messages";
import { StorageKey } from "./types/storage";
import { DEFAULT_USER_ID } from "./types/api";
import { APP_EXTENSION, APP_LOGIN_EXTENSION } from "./consts/api";
document.addEventListener("DOMContentLoaded", () => {
  const googleSignInButton = document.getElementById("googleSignInButton") as HTMLButtonElement;

  const checkAuth = (): void => {
    chrome.storage.sync.get([StorageKey.API_KEY, StorageKey.ACCESS_TOKEN], data => {
      if (data[StorageKey.API_KEY] || data[StorageKey.ACCESS_TOKEN]) {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          const tabId = tabs[0]?.id;
          if (tabId != null) {
            chrome.tabs.sendMessage(tabId, { action: SidebarAction.TOGGLE_SIDEBAR });
          }
          window.close();
        });
      }
    });
  };

  if (googleSignInButton) {
    googleSignInButton.addEventListener("click", () => {
      chrome.storage.sync.set({ [StorageKey.USER_ID_CAMEL]: DEFAULT_USER_ID });
      chrome.storage.sync.get([StorageKey.USER_LOGGED_IN], data => {
        const url = data[StorageKey.USER_LOGGED_IN]
          ? APP_EXTENSION
          : APP_LOGIN_EXTENSION;
        chrome.tabs.create({ url }, () => {
          window.close();
        });
      });
    });
  }
  checkAuth();
});
