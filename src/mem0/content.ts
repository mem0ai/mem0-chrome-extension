import { getBrowser, sendExtensionEvent } from '../utils/util_functions';

function fetchAndSaveSession() {
  fetch('https://app.mem0.ai/api/auth/session')
    .then(response => response.json())
    .then(data => {
      if (data && data.access_token) {
        chrome.storage.sync.set({ access_token: data.access_token });
        chrome.storage.sync.set({ userLoggedIn: true });
        //Track successful login
        sendExtensionEvent('login_success', {
          browser: getBrowser(),
          source: 'OPENMEMORY_CHROME_EXTENSION',
        });
      }
    })
    .catch(error => {
      console.error('Error fetching session:', error);
    });
}

// Check if the URL contains the login page and update userLoggedIn
if (window.location.href.includes('https://app.mem0.ai/login')) {
  chrome.storage.sync.set({ userLoggedIn: false });
}

fetchAndSaveSession();
