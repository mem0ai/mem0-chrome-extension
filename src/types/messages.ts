/** Enum for toast notification types (SUCCESS, ERROR) */
export enum ToastVariant {
  SUCCESS = 'success',
  ERROR = 'error',
}

/** Enum for different message types */
export enum MessageType {
  GET_SELECTION_CONTEXT = 'mem0:getSelectionContext',
  SELECTION_CONTEXT = 'mem0:selectionContext',
  TOAST = 'mem0:toast',
}

/** Enum for sidebar actions (TOGGLE_SIDEBAR, OPEN_POPUP, etc.) */
export enum SidebarAction {
  TOGGLE_SIDEBAR = 'toggleSidebar',
  OPEN_POPUP = 'openPopup',
  TOGGLE_MEM0 = 'toggleMem0',
  OPEN_DASHBOARD = 'openDashboard',
  SIDEBAR_SETTINGS = 'toggleSidebarSettings',
  OPEN_OPTIONS = 'openOptions',
  SHOW_LOGIN_POPUP = 'showLoginPopup',
}

/** Payload for selection context messages */
export type SelectionContextPayload = Partial<{
  selection: string;
  title: string;
  url: string;
}>;

/** Response structure for selection context */
export type SelectionContextResponse = Partial<{
  type: string;
  payload: SelectionContextPayload;
  error: string;
}>;

/** Message type for getting selection context */
export type GetSelectionContextMessage = {
  type: MessageType.GET_SELECTION_CONTEXT;
};

/** Toast notification message structure */
export type ToastMessage = {
  type: MessageType.TOAST;
  payload: {
    message?: string;
    variant?: ToastVariant;
  };
};

/** Union type for selection context messages */
export type SelectionContextMessage = GetSelectionContextMessage | ToastMessage;

/** Response callback type */
export type SendResponse = (response: SelectionContextResponse) => void;

export type ToggleSidebarMessage = {
  action: SidebarAction.TOGGLE_SIDEBAR;
};

export type OpenPopupMessage = {
  action: SidebarAction.OPEN_POPUP;
};

export type ToggleMem0Message = {
  action: SidebarAction.TOGGLE_MEM0;
  enabled: boolean;
};

export type OpenDashboardMessage = {
  action: SidebarAction.OPEN_DASHBOARD;
  url: string;
};

export type SidebarActionMessage =
  | ToggleSidebarMessage
  | OpenPopupMessage
  | ToggleMem0Message
  | OpenDashboardMessage;
