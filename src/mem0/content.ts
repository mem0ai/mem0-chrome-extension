function fetchAndSaveSession() {
  fetch("https://app.mem0.ai/api/auth/session")
    .then(response => response.json())
    .then(data => {
      if (data && data.access_token) {
        chrome.storage.sync.set({ access_token: data.access_token });
        chrome.storage.sync.set({ userLoggedIn: true });
      }
    })
    .catch(error => {
      console.error("Error fetching session:", error);
    });
}

// Check if the URL contains the login page and update userLoggedIn
if (window.location.href.includes("https://app.mem0.ai/login")) {
  chrome.storage.sync.set({ userLoggedIn: false });
}

fetchAndSaveSession();
