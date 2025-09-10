// --- Types ---
type InlinePlacement = {
  strategy: 'inline';
  where?: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend';
  inlineAlign?: 'start' | 'center' | 'end';
  inlineClass?: string;
};

type DockPlacement = {
  strategy: 'dock';
  container?: string | Element;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  gap?: number;
};

type FloatPlacement = {
  strategy: 'float';
  placement?:
    | 'top-start'
    | 'top-center'
    | 'top-end'
    | 'right-start'
    | 'right-center'
    | 'right-end'
    | 'bottom-start'
    | 'bottom-center'
    | 'bottom-end'
    | 'left-start'
    | 'left-center'
    | 'left-end';
  gap?: number;
};

type Placement = InlinePlacement | DockPlacement | FloatPlacement;

interface SiteConfig {
  editorSelector: string;
  deriveAnchor: (editor: Element) => Element | null;
  placement: Placement;
  fallbackAnchors?: string[];
  adjacentTargets?: string[];
  autoButtonTextPattern?: RegExp;
  enableFloatingFallback?: boolean;
  sendButtonSelector?: string;
  modelButtonSelector?: string;
}

interface SiteConfigs {
  claude: SiteConfig;
  chatgpt: SiteConfig;
  grok: SiteConfig;
  deepseek: SiteConfig;
  gemini: SiteConfig;
  perplexity: SiteConfig;
  replit: SiteConfig;
}

// --- Config (no globals) ---
const SITE_CONFIG = {
  claude: {
    editorSelector:
      'div[contenteditable="true"], textarea, p[data-placeholder], [contenteditable="true"]',
    deriveAnchor: editor => editor.closest('form') || editor.parentElement,
    // Place the icon floating near the editor to avoid container clipping on some layouts
    placement: { strategy: 'float', placement: 'right-start', gap: 8 },
    fallbackAnchors: ['#input-tools-menu-trigger', 'button[aria-label*="Send" i]'],
  },
  chatgpt: {
    editorSelector: 'textarea, [contenteditable="true"], input[type="text"]',
    deriveAnchor: editor => {
      const form = editor.closest('form');
      const toolbar =
        (form &&
          (form.querySelector('[data-testid="composer-trailing-actions"]') ||
            form.querySelector('.composer-trailing-actions') ||
            form.querySelector('.items-center.gap-1\\.5') ||
            form.querySelector('.items-center.gap-2'))) ||
        null;
      return toolbar || form || editor.parentElement;
    },
    placement: { strategy: 'inline', where: 'beforeend', inlineAlign: 'end' },
    adjacentTargets: [
      'button[aria-label="Dictate button"]',
      'button[aria-label*="mic" i]',
      'button[aria-label*="voice" i]',
    ],
    fallbackAnchors: [
      'form [data-testid="composer-trailing-actions"]',
      'form .composer-trailing-actions',
      'form textarea',
      'main form textarea',
    ],
    enableFloatingFallback: true,
  },
  grok: {
    editorSelector: 'textarea, [contenteditable="true"], input[type="text"]',
    deriveAnchor: editor => {
      const root = editor.closest('form') || editor.parentElement || document.body;
      const autoBtn = Array.from(root.querySelectorAll('button,[role="button"]')).find(b =>
        /\bAuto\b/i.test((b.textContent || '').trim())
      );
      return autoBtn ? autoBtn.parentElement || root : root;
    },
    placement: { strategy: 'inline', where: 'beforeend', inlineAlign: 'end' },
    autoButtonTextPattern: /\bAuto\b/i,
    fallbackAnchors: [
      'button[aria-label*="Send" i]',
      'button[data-testid*="send" i]',
      'form button[type="submit"]',
      'textarea',
      '[role="textbox"]',
    ],
  },
  deepseek: {
    editorSelector: 'textarea, [contenteditable="true"], input[type="text"]',
    deriveAnchor: editor => editor.closest('form') || editor.parentElement,
    placement: { strategy: 'inline', where: 'beforeend', inlineAlign: 'end' },
  },
  gemini: {
    editorSelector: 'textarea, [contenteditable="true"], input[type="text"]',
    deriveAnchor: editor => editor.closest('form') || editor.parentElement,
    placement: { strategy: 'inline', where: 'beforeend', inlineAlign: 'end' },
  },
  perplexity: {
    editorSelector: 'textarea, [contenteditable], input[type="text"]',
    deriveAnchor: editor => editor.closest('form') || editor.parentElement,
    placement: { strategy: 'inline', where: 'beforeend', inlineAlign: 'end' },
    sendButtonSelector: 'button[aria-label="Submit"]',
    modelButtonSelector: 'button[aria-label="Choose a model"]',
  },
  replit: {
    editorSelector: 'textarea, [contenteditable="true"], input[type="text"]',
    deriveAnchor: editor => editor.closest('form') || editor.parentElement || document.body,
    placement: { strategy: 'float', placement: 'right-center', gap: 12 },
  },
} as const satisfies SiteConfigs;

// --- Export exactly as requested ---
export { SITE_CONFIG };
