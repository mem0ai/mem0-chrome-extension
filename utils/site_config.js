var SITE_CONFIG = (typeof SITE_CONFIG !== 'undefined') ? SITE_CONFIG : {};

SITE_CONFIG.claude = {
  editorSelector: 'div[contenteditable="true"], textarea, p[data-placeholder], [contenteditable="true"]',
  deriveAnchor: function(editor) {
    return editor.closest('form') || editor.parentElement;
  },
  placement: { strategy: 'dock', container: 'form', side: 'bottom', align: 'start', gap: 8 },
  fallbackAnchors: ['#input-tools-menu-trigger', 'button[aria-label*="Send" i]']
};

SITE_CONFIG.chatgpt = {
  editorSelector: 'textarea, [contenteditable="true"], input[type="text"]',
  deriveAnchor: function(editor) {
    var form = editor.closest('form');
    var toolbar = (form && (
      form.querySelector('[data-testid="composer-trailing-actions"]') ||
      form.querySelector('.composer-trailing-actions') ||
      form.querySelector('.items-center.gap-1\\.5') ||
      form.querySelector('.items-center.gap-2')
    )) || null;
    return toolbar || form || editor.parentElement;
  },
  placement: { strategy: 'inline', where: 'beforeend', inlineAlign: 'end' },
  adjacentTargets: [
    'button[aria-label="Dictate button"]',
    'button[aria-label*="mic" i]',
    'button[aria-label*="voice" i]'
  ],
  fallbackAnchors: [
    'form [data-testid="composer-trailing-actions"]',
    'form .composer-trailing-actions',
    'form textarea',
    'main form textarea'
  ],
  enableFloatingFallback: true
};

SITE_CONFIG.grok = {
  editorSelector: 'textarea, [contenteditable="true"], input[type="text"]',
  deriveAnchor: function(editor) {
    var root = editor.closest('form') || editor.parentElement || document.body;
    var autoBtn = Array.from(root.querySelectorAll('button,[role="button"]')).find(function(b){
      return /\bAuto\b/i.test((b.textContent||'').trim());
    });
    return autoBtn ? (autoBtn.parentElement || root) : root;
  },
  placement: { strategy: 'inline', where: 'beforeend', inlineAlign: 'end' },
  autoButtonTextPattern: /\bAuto\b/i
};

SITE_CONFIG.deepseek = {
  editorSelector: 'textarea, [contenteditable="true"], input[type="text"]',
  deriveAnchor: function(editor) { return editor.closest('form') || editor.parentElement; },
  placement: { strategy: 'inline', where: 'beforeend', inlineAlign: 'end' }
};

SITE_CONFIG.gemini = {
  editorSelector: 'textarea, [contenteditable="true"], input[type="text"]',
  deriveAnchor: function(editor) { return editor.closest('form') || editor.parentElement; },
  placement: { strategy: 'inline', where: 'beforeend', inlineAlign: 'end' }
};

SITE_CONFIG.perplexity = {
  editorSelector: 'textarea, [contenteditable], input[type="text"]',
  deriveAnchor: function(editor) { return editor.closest('form') || editor.parentElement; },
  placement: { strategy: 'inline', where: 'beforeend', inlineAlign: 'end' },
  sendButtonSelector: 'button[aria-label="Submit"]',
  modelButtonSelector: 'button[aria-label="Choose a model"]'
};

SITE_CONFIG.replit = {
  editorSelector: 'textarea, [contenteditable="true"], input[type="text"]',
  deriveAnchor: function(editor) { return editor.closest('form') || editor.parentElement || document.body; },
  placement: { strategy: 'float', placement: 'right-center', gap: 12 }
};


