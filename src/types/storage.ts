/** Enum for all storage keys used in the extension */
export enum StorageKey {
  API_KEY = 'apiKey',
  ACCESS_TOKEN = 'access_token',
  USER_ID = 'user_id',
  USER_ID_CAMEL = 'userId',
  USER_LOGGED_IN = 'userLoggedIn',
  SELECTED_ORG = 'selected_org',
  SELECTED_PROJECT = 'selected_project',
  MEMORY_ENABLED = 'memory_enabled',
  AUTO_INJECT_ENABLED = 'auto_inject_enabled',
  SIMILARITY_THRESHOLD = 'similarity_threshold',
  TOP_K = 'top_k',
  TRACK_SEARCHES = 'track_searches',
}

/** Type mapping for storage values (required fields) */
export type StorageItems = {
  apiKey: string;
  userId: string;
  user_id: string;
  access_token: string;
  memory_enabled: boolean;
  selected_org: string;
  selected_project: string;
  similarity_threshold: number;
  top_k: number;
};

/** Type mapping for storage values (optional fields) */
export type StorageData = Partial<{
  apiKey: string;
  userId: string;
  user_id: string;
  access_token: string;
  memory_enabled: boolean;
  selected_org: string;
  selected_project: string;
  similarity_threshold: number;
  top_k: number;
}>;
