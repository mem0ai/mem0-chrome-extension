import type { Theme } from '../utils/theme';

export type Elements = {
  spinner: HTMLElement;
  text: HTMLElement;
  checkmark: HTMLElement;
  shortcut: HTMLElement;
  notificationDot: HTMLElement;
};

export type MemButtonState = 'loading' | 'added' | 'success' | 'error';

export type CreateMemButtonOptions = {
  theme: Theme;
  label?: string; // Text on the button
  shortcut?: string; // Shortcut label (e.g. "Ctrl + M")
  autoTheme?: boolean; // Subscribe to system theme change
  onClick?: () => void; // Click handler
  marginLeft?: string; // Custom margin-left for the button
};

export type MemButtonController = {
  root: HTMLElement; // Container (span)
  button: HTMLButtonElement;
  elements: Elements;
  setTheme: (theme: Theme) => void;
  setState: (s: MemButtonState) => void;
  wireHover: (computeActive: () => boolean) => void; // Active background when text is present
  destroy: () => void;
};
