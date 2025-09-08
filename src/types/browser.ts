/** Web navigation event details */
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

/** JSON primitive value types */
export type JsonPrimitive = string | number | boolean | null;
/** Recursive JSON value type */
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };
/** JSON object structure */
export type JsonObject = { [k: string]: JsonValue };

/** Browser history state data */
export type HistoryStateData = JsonObject | null;
/** Browser history URL type */
export type HistoryUrl = string | URL | null;
