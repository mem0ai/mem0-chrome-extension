import type { StorageData } from '../types/storage';

type EventType = string;
type AdditionalData = Record<string, any>;
type CallbackFunction = (success: boolean) => void;

type ExtensionEventPayload = {
  event_type: EventType;
  additional_data: {
    timestamp: string;
    version: string;
    user_agent: string;
    user_id: string;
    [key: string]: any;
  };
};

type BrowserType = 'Edge' | 'Opera' | 'Chrome' | 'Firefox' | 'Safari' | 'Unknown';

/**
 * Utility function to send extension events to PostHog via mem0 API
 * @param eventType - The type of event (e.g., "extension_install", "extension_toggle_button")
 * @param additionalData - Optional additional data to include with the event
 * @param callback - Optional callback function called after attempt (receives success boolean)
 */
export const sendExtensionEvent = (
  eventType: EventType, 
  additionalData: AdditionalData = {},
  callback: CallbackFunction | null = null
): void => {
  chrome.storage.sync.get(["apiKey", "access_token", "userId", "user_id"], (data: StorageData) => {
    if (!data.apiKey && !data.access_token) {
      if (callback) callback(false);
      return;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (data.access_token) {
      headers["Authorization"] = `Bearer ${data.access_token}`;
    } else if (data.apiKey) {
      headers["Authorization"] = `Token ${data.apiKey}`;
    }

    const payload: ExtensionEventPayload = {
      event_type: eventType,
      additional_data: {
        timestamp: new Date().toISOString(),
        version: chrome.runtime.getManifest().version,
        user_agent: navigator.userAgent,
        user_id: data.userId || data.user_id || "chrome-extension-user",
        ...additionalData
      }
    };

    console.log("eventType", eventType);
    console.log("payload", payload);

    fetch("https://api.mem0.ai/v1/extension/", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
    })
    .then(response => {
      const success = response.ok;
      if (callback) callback(success);
    })
    .catch(error => {
      console.error(`Error sending ${eventType} event:`, error);
      if (callback) callback(false);
    });
  });
};

export const getBrowser = (): BrowserType => {
  const userAgent = navigator.userAgent;
  if (userAgent.includes('Edg/')) return 'Edge';
  if (userAgent.includes('OPR/') || userAgent.includes('Opera/')) return 'Opera';
  if (userAgent.includes('Chrome/')) return 'Chrome';
  if (userAgent.includes('Firefox/')) return 'Firefox';
  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) return 'Safari';
  return 'Unknown';
};
