// WebNavigation
export type OnCommittedDetails = {
  tabId: number;
  url: string;
  processId: number;
  frameId: number;
  parentFrameId: number;
  transitionType: chrome.webNavigation.TransitionType;
  transitionQualifiers: chrome.webNavigation.TransitionQualifier[];
  timeStamp: number;
  documentId: string;
  parentDocumentId?: string;
  documentLifecycle: chrome.extensionTypes.DocumentLifecycle;
  frameType: chrome.extensionTypes.FrameType;
};

// JSON types
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };

// Browser history
export type HistoryStateData = Record<string, unknown> | null;
export type HistoryUrl = string | URL | null;
