export type UserSettings = {
  apiKey?: string;
  accessToken?: string;
  userId?: string;
  memoryEnabled?: boolean;
  selectedOrg?: string;
  selectedProject?: string;
  similarityThreshold?: number;
  topK?: number;
};

export type SidebarSettings = {
  user_id?: string;
  selected_org?: string;
  selected_org_name?: string;
  selected_project?: string;
  selected_project_name?: string;
  memory_enabled: boolean;
  auto_inject_enabled: boolean;
  similarity_threshold: number;
  top_k: number;
  track_searches: boolean;
};

// For compatibility with existing code
export type Settings = {
  hasCreds: boolean;
  apiKey: string | null;
  accessToken: string | null;
  userId: string;
  orgId: string | null;
  projectId: string | null;
  memoryEnabled: boolean;
};
