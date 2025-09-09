import type {
  CreateMemButtonOptions,
  Elements,
  MemButtonController,
  MemButtonState,
} from '../types/memButton';
import { Theme, onThemeChange } from '../utils/theme';
import { THEME_COLORS, getButtonStyles } from '../utils/ui/button_theme';

function createStyled(tag: string, css: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.style.cssText = css;
  if (text) {
    el.textContent = text;
  }
  return el;
}

function ensureAnimationsInjected(): void {
  if (!document.getElementById('mem0-ui-animations')) {
    const style = document.createElement('style');
    style.id = 'mem0-ui-animations';
    style.textContent = `
      @keyframes popIn {0%{transform:scale(0)}50%{transform:scale(1.2)}100%{transform:scale(1)}}
      #mem0-notification-dot.active {display:block!important;animation:popIn .3s ease-out forwards}
      @keyframes spin {0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
    `;
    document.head.appendChild(style);
  }
}

export function createMemButton(opts: CreateMemButtonOptions): MemButtonController {
  let currentTheme = opts.theme;
  let styles = getButtonStyles(currentTheme, { marginLeft: opts.marginLeft });
  ensureAnimationsInjected();

  // Container and button
  const root = document.createElement('span');
  root.style.position = 'relative';

  const button = document.createElement('button');
  button.id = 'mem0-icon-button';
  button.type = 'button';
  button.setAttribute('aria-label', 'OpenMemory button');
  button.style.cssText = styles.BASE;

  // Internal elements
  const elements: Elements = {
    spinner: createStyled('span', styles.SPINNER),
    text: createStyled('span', styles.TEXT, opts.label ?? 'Memories'),
    checkmark: createStyled('span', styles.CHECKMARK, '✓'),
    shortcut: createStyled('span', styles.SHORTCUT, opts.shortcut ?? ''),
    notificationDot: createStyled('div', styles.NOTIFICATION_DOT),
  };
  elements.notificationDot.id = 'mem0-notification-dot';

  button.appendChild(elements.spinner);
  button.appendChild(elements.text);
  button.appendChild(elements.checkmark);
  button.appendChild(elements.shortcut);
  button.appendChild(elements.notificationDot);

  root.appendChild(button);

  // Clicks
  if (opts.onClick) {
    button.addEventListener('click', () => void opts.onClick?.());
  }

  // Auto-theme change (optional)
  let unsubscribeTheme: (() => void) | null = null;
  if (opts.autoTheme) {
    unsubscribeTheme = onThemeChange(t => setTheme(t));
  }

  function updateTextColorForLight(isActive: boolean) {
    if (currentTheme !== Theme.LIGHT) {
      return;
    }
    const color = isActive ? 'white' : '#1a1a1a';
    elements.text.style.color = color;
    elements.checkmark.style.color = color;
  }

  function setTheme(theme: Theme) {
    currentTheme = theme;
    styles = getButtonStyles(theme, { marginLeft: opts.marginLeft });

    // Update styles
    button.style.cssText = styles.BASE;
    elements.spinner.style.cssText = styles.SPINNER;
    elements.text.style.cssText = styles.TEXT;
    elements.checkmark.style.cssText = styles.CHECKMARK;
    elements.shortcut.style.cssText = styles.SHORTCUT;
    elements.notificationDot.style.cssText = styles.NOTIFICATION_DOT;
  }

  // States
  function setState(state: MemButtonState) {
    const c = THEME_COLORS[currentTheme];

    const config: Record<
      MemButtonState,
      {
        spinner: boolean;
        text: string;
        checkmark: boolean;
        shortcut: boolean;
        bg: string;
        active: boolean;
      }
    > = {
      loading: {
        spinner: true,
        text: 'Memories',
        checkmark: false,
        shortcut: false,
        bg: c.BUTTON_BG_ACTIVE,
        active: true,
      },
      added: {
        spinner: false,
        text: 'Added',
        checkmark: false,
        shortcut: false,
        bg: c.BUTTON_BG_ACTIVE,
        active: true,
      },
      success: {
        spinner: false,
        text: 'Memories',
        checkmark: true,
        shortcut: true,
        bg: c.BUTTON_BG_ACTIVE,
        active: true,
      },
      error: {
        spinner: false,
        text: 'Memories',
        checkmark: true,
        shortcut: true,
        bg: c.BUTTON_BG,
        active: false,
      },
    };

    const s = config[state];
    elements.spinner.style.display = s.spinner ? 'inline-block' : 'none';
    elements.text.textContent = s.text;
    elements.text.style.display = 'inline-block';
    elements.checkmark.style.display = s.checkmark ? 'inline-block' : 'none';
    elements.shortcut.style.display = s.shortcut ? 'inline-block' : 'none';
    button.style.backgroundColor = s.bg;
    updateTextColorForLight(s.active);
  }

  // hover behavior (active background when input has text)
  function wireHover(computeActive: () => boolean) {
    // Remove existing hover listeners if any
    const existingMouseEnter = button.getAttribute('data-mouseenter-handler');
    const existingMouseLeave = button.getAttribute('data-mouseleave-handler');

    if (existingMouseEnter) {
      button.removeEventListener('mouseenter', JSON.parse(existingMouseEnter));
    }
    if (existingMouseLeave) {
      button.removeEventListener('mouseleave', JSON.parse(existingMouseLeave));
    }

    const mouseEnterHandler = () => {
      const c = THEME_COLORS[currentTheme]; // Get current theme colors
      const hasText = !!computeActive();
      button.style.backgroundColor = hasText ? c.BUTTON_BG_ACTIVE_HOVER : c.BUTTON_BG_HOVER;
    };

    const mouseLeaveHandler = () => {
      const c = THEME_COLORS[currentTheme]; // Get current theme colors
      const hasText = !!computeActive();
      button.style.backgroundColor = hasText ? c.BUTTON_BG_ACTIVE : c.BUTTON_BG;
    };

    button.addEventListener('mouseenter', mouseEnterHandler);
    button.addEventListener('mouseleave', mouseLeaveHandler);

    // Store handlers for potential removal
    button.setAttribute('data-mouseenter-handler', JSON.stringify(mouseEnterHandler));
    button.setAttribute('data-mouseleave-handler', JSON.stringify(mouseLeaveHandler));
  }

  function destroy() {
    unsubscribeTheme?.();
    root.remove();
  }

  return { root, button, elements, setTheme, setState, wireHover, destroy };
}
