import { Theme } from '../theme';

export const THEME_COLORS = {
  [Theme.DARK]: {
    BUTTON_BG: 'rgba(255, 255, 255, 0.12)',
    BUTTON_BG_HOVER: 'rgba(255, 255, 255, 0.18)',
    BUTTON_BG_ACTIVE: 'rgba(22, 101, 52, 1)',
    BUTTON_BG_ACTIVE_HOVER: 'rgba(16, 85, 42, 1)',
    BUTTON_BORDER: 'rgba(255, 255, 255, 0.2)',
    TEXT_PRIMARY: 'white',
    TEXT_SECONDARY: 'rgba(255, 255, 255, 0.8)',
    NOTIFICATION_DOT: 'rgb(128, 221, 162)',
    NOTIFICATION_DOT_BORDER: '#1C1C1E',
    SPINNER_BORDER: 'rgba(255, 255, 255, 0.3)',
    SPINNER_ACTIVE: 'white',
    SHORTCUT_BG: 'rgba(255, 255, 255, 0.11)',
    SHORTCUT_TEXT: 'white',
    POPUP_BG: 'rgba(255, 255, 255, 0.12)',
    POPUP_BORDER: 'rgba(255, 255, 255, 0.2)',
    POPUP_TEXT: 'white',
    POPUP_SHADOW: 'rgba(0, 0, 0, 0.3)',
  },
  [Theme.LIGHT]: {
    BUTTON_BG: 'rgba(239, 239, 239, 1)',
    BUTTON_BG_HOVER: 'rgba(0, 0, 0, 0.12)',
    BUTTON_BG_ACTIVE: 'rgba(22, 101, 52, 1)',
    BUTTON_BG_ACTIVE_HOVER: 'rgba(16, 85, 42, 1)',
    BUTTON_BORDER: 'rgba(255, 255, 255, 0.2)',
    TEXT_PRIMARY: '#1a1a1a',
    TEXT_SECONDARY: 'rgba(0, 0, 0, 0.7)',
    NOTIFICATION_DOT: 'rgb(22, 163, 74)',
    NOTIFICATION_DOT_BORDER: '#ffffff',
    SPINNER_BORDER: 'rgba(255, 255, 255, 0.3)',
    SPINNER_ACTIVE: 'white',
    SHORTCUT_BG: 'rgba(255, 255, 255, 0.11)',
    SHORTCUT_TEXT: 'white',
    POPUP_BG: 'rgba(255, 255, 255, 0.95)',
    POPUP_BORDER: 'rgba(0, 0, 0, 0.1)',
    POPUP_TEXT: '#1a1a1a',
    POPUP_SHADOW: 'rgba(0, 0, 0, 0.15)',
  },
} as const;

export type ButtonStyles = {
  BASE: string;
  NOTIFICATION_DOT: string;
  TEXT: string;
  CHECKMARK: string;
  SHORTCUT: string;
  SPINNER: string;
};

export type ButtonStyleOptions = {
  marginLeft?: string;
};

export const getButtonStyles = (theme: Theme, options?: ButtonStyleOptions): ButtonStyles => {
  const c = THEME_COLORS[theme];
  const marginLeft = options?.marginLeft || '0px';

  return {
    BASE: `
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      background-color: ${c.BUTTON_BG} !important;
      border: 1px solid ${c.BUTTON_BORDER} !important;
      border-radius: 1200px !important;
      padding: 8px 12px !important;
      margin-left: ${marginLeft} !important;
      color: ${c.TEXT_PRIMARY} !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      transition: background-color .2s ease !important;
      position: relative !important;
      min-height: 34px !important;
      height: auto !important;
      width: auto !important;
      min-width: auto !important;
    `,
    NOTIFICATION_DOT: `
      position: absolute;
      top: -3px;
      right: -3px;
      width: 10px;
      height: 10px;
      background-color: ${c.NOTIFICATION_DOT};
      border-radius: 50%;
      border: 2px solid ${c.NOTIFICATION_DOT_BORDER};
      display: none !important;
      z-index: 1001;
      pointer-events: none;
    `,
    TEXT: `
      color: ${c.TEXT_PRIMARY};
      font-size: 14px;
      font-weight: 500;
    `,
    CHECKMARK: `
      margin-left: 6px;
      display: none;
      font-size: 14px;
      color: ${c.TEXT_PRIMARY};
      font-weight: bold;
    `,
    SHORTCUT: `
      background-color: ${c.SHORTCUT_BG};
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
      font-weight: 500;
      margin-left: 8px;
      display: none;
      color: ${c.SHORTCUT_TEXT};
    `,
    SPINNER: `
      width: 16px;
      height: 16px;
      border: 2px solid ${c.SPINNER_BORDER};
      border-top: 2px solid ${c.SPINNER_ACTIVE};
      border-radius: 50%;
      margin-right: 4px;
      display: none;
      animation: spin 1s linear infinite;
    `,
  };
};
