// API Endpoints
export const API_BASE_URL = "https://api.mem0.ai";
export const API_SEARCH = `${API_BASE_URL}/v2/memories/search/`;
export const API_MEMORIES = `${API_BASE_URL}/v1/memories/`;
export const API_EXTENSION = `${API_BASE_URL}/v1/extension/`;
export const API_ORGANIZATIONS = `${API_BASE_URL}/api/v1/orgs/organizations/`;
export const API_PROJECTS = (orgId: string) => `${API_BASE_URL}/api/v1/orgs/organizations/${orgId}/projects/`;

// App URLs
export const APP_BASE_URL = "https://app.mem0.ai";
export const APP_LOGIN = `${APP_BASE_URL}/login`;
export const APP_EXTENSION = `${APP_BASE_URL}/extension?source=chrome-extension`;
export const APP_LOGIN_EXTENSION = `${APP_BASE_URL}/login?source=chrome-extension`;
export const APP_DASHBOARD_REQUESTS = `${APP_BASE_URL}/dashboard/requests`;
export const APP_DASHBOARD_USERS = `${APP_BASE_URL}/dashboard/users`;
export const APP_DASHBOARD_USER = (userId: string) => `${APP_BASE_URL}/dashboard/user/${userId}`;
export const APP_DASHBOARD_USER_MEMORY = (userId: string, memoryId: string) => `${APP_BASE_URL}/dashboard/user/${userId}?memoryId=${memoryId}`;
export const APP_AUTH_SESSION = `${APP_BASE_URL}/api/auth/session`;