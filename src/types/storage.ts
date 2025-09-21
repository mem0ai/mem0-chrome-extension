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
  RUN_ID = 'run_id',
  RUN_ID_GPT = 'run_id_gpt',
  RUN_ID_GEMINI = 'run_id_gemini',
  RUN_ID_CLAUDE = 'run_id_claude',
  RUN_ID_DEEPSEEK = 'run_id_deepseek',
  RUN_ID_GROK = 'run_id_grok',
  RUN_ID_PERPLEXITY = 'run_id_perplexity',
  RUN_ID_REPLIT = 'run_id_replit',
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
  run_id?: any;
  run_id_gpt?: any;
  run_id_gemini?: any;
  run_id_claude?: any;
  run_id_deepseek?: any;
  run_id_grok?: any;
  run_id_perplexity?: any;
  run_id_replit?: any;
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
  run_id?: any;
  run_id_gpt?: any;
  run_id_gemini?: any;
  run_id_claude?: any;
  run_id_deepseek?: any;
  run_id_grok?: any;
  run_id_perplexity?: any;
  run_id_replit?: any;
}>;
