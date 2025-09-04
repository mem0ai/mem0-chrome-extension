// Memory items
export type MemoryItem = {
  id?: string;
  text: string;
  memory?: string;
  categories?: string[];
  removed?: boolean;
  created_at?: string;
  user_id?: string;
};

export type Memory = {
  id?: string;
  memory?: string;
  categories?: string[];
};

export type MemoriesResponse = {
  count?: number;
  results?: Memory[];
};

// Prompts
export type OpenMemoryPrompts = {
  rerank_system_prompt: string;
  memory_header_text: string;
  memory_header_html_strong: string;
  memory_marker_prefix: string;
  memory_header_plain_regex: RegExp;
  memory_header_html_regex: RegExp;
};

// API parameters
export type OptionalApiParams = {
  org_id?: string;
  project_id?: string;
};

// Data for browser history
export type HistoryStateData = Record<string, unknown> | null;
