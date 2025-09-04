export enum MessageRole {
  User = "user",
  Assistant = "assistant",
}

export type ApiMessage = {
  role: string;
  content: string;
};

export type ApiMemoryRequest = {
  messages: ApiMessage[];
  user_id: string;
  metadata: {
    provider: string;
    category: string;
    page_url?: string;
    engine?: string;
  };
  source: string;
  org_id?: string;
  project_id?: string;
};

export type MemorySearchResponse = Array<{
  id: string;
  memory: string;
  text?: string;
  created_at?: string;
  user_id?: string;
  categories?: string[];
}>;

export type LoginData = {
  apiKey?: string;
  userId?: string;
  user_id?: string;
  access_token?: string;
};

export const DEFAULT_USER_ID = "chrome-extension-user";

export enum Source {
  OPENMEMORY_CHROME_EXTENSION = "OPENMEMORY_CHROME_EXTENSION",
}
