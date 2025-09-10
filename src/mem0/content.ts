/* eslint-disable no-console */
import { APP_AUTH_SESSION, APP_LOGIN } from '../consts/api';
import { getBrowser, sendExtensionEvent } from '../utils/util_functions';

function fetchAndSaveSession() {
  fetch(APP_AUTH_SESSION)
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
if (window.location.href.includes(APP_LOGIN)) {
  chrome.storage.sync.set({ userLoggedIn: false });
}

fetchAndSaveSession();
