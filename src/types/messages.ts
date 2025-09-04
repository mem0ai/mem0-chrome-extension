export enum ToastVariant {
  SUCCESS = "success",
  ERROR = "error",
}

export enum MessageType {
  GET_SELECTION_CONTEXT = "mem0:getSelectionContext",
  SELECTION_CONTEXT = "mem0:selectionContext",
  TOAST = "mem0:toast",
}

export enum SidebarAction {
  TOGGLE_SIDEBAR = "toggleSidebar",
  OPEN_POPUP = "openPopup",
  TOGGLE_MEM0 = "toggleMem0",
  OPEN_DASHBOARD = "openDashboard",
  SIDEBAR_SETTINGS = "toggleSidebarSettings",
  OPEN_OPTIONS = "openOptions",
  SHOW_LOGIN_POPUP = "showLoginPopup",
}

export type SelectionContextPayload = {
  selection?: string;
  title?: string;
  url?: string;
};

export type SelectionContextResponse = {
  type?: string;
  payload?: SelectionContextPayload;
  error?: string;
};

export type GetSelectionContextMessage = {
  type: MessageType.GET_SELECTION_CONTEXT;
};

export type ToastMessage = {
  type: MessageType.TOAST;
  payload: {
    message?: string;
    variant?: ToastVariant;
  };
};

export type SelectionContextMessage = GetSelectionContextMessage | ToastMessage;

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
