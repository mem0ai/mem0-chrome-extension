/** User preference structure with API keys, memory settings, and thresholds */
export type UserSettings = Partial<{
  apiKey: string;
  accessToken: string;
  userId: string;
  memoryEnabled: boolean;
  selectedOrg: string;
  selectedProject: string;
  similarityThreshold: number;
  topK: number;
}>;

/** Sidebar-specific settings with organization and project info */
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

/** Legacy settings structure for compatibility */
export type Settings = {
  hasCreds: boolean;
  apiKey: string | null;
  accessToken: string | null;
  userId: string;
  orgId: string | null;
  projectId: string | null;
  memoryEnabled: boolean;
};
