document.addEventListener("DOMContentLoaded", function () {
  const googleSignInButton = document.getElementById("googleSignInButton");

  function checkAuth() {
    chrome.storage.sync.get(["apiKey", "access_token"], function (data) {
      if (data.apiKey || data.access_token) {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          chrome.tabs.sendMessage(tabs[0].id, {action: "toggleSidebar"});
          window.close();
        });
      }
    });
  }

  if (googleSignInButton) {
    googleSignInButton.addEventListener("click", function () {
      chrome.storage.sync.set({ userId: "chrome-extension-user" });
      chrome.storage.sync.get(["userLoggedIn"], function (data) {
        if (data.userLoggedIn) {
          chrome.tabs.create(
            { url: "https://app.mem0.ai/extension?source=chrome-extension" },
            function (tab) {
              window.close();
            }
          );
        } else {
          chrome.tabs.create(
            { url: "https://app.mem0.ai/login?source=chrome-extension" },
            function (tab) {
              window.close();
          }
          );
        }
      });
    });
  }
  checkAuth();
});