/** Individual memory structure with id, text, and categories */
export type MemoryItem = {
  id?: string;
  text: string;
  memory?: string;
  categories?: string[];
  removed?: boolean;
  created_at?: string;
  user_id?: string;
};

/** Simplified memory structure */
export type Memory = Partial<{
  id: string;
  memory: string;
  categories: string[];
}>;

/** Search result item from API */
export type MemorySearchItem = { id: string | number; memory: string; categories?: string[] };

/** API response wrapper for memories */
export type MemoriesResponse = Partial<{
  count: number;
  results: Memory[];
}>;

/** Prompt templates and regex patterns */
export type OpenMemoryPrompts = {
  memory_header_html_strong: string;
  memory_header_plain_regex: RegExp;
  memory_header_html_regex: RegExp;
};

/** Optional parameters for API calls (org_id, project_id) */
export type OptionalApiParams = Partial<{
  org_id: string;
  project_id: string;
}>;
