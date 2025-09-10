import type { ManifestV3Export } from '@crxjs/vite-plugin';

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: 'OpenMemory',
  version: '1.3.17',
  description:
    '🧠 OpenMemory keeps your conversations in sync. 🔄 No more repeating yourself—just seamless AI collaboration! ✨',

  icons: {
    '16': 'icons/icon16.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png',
  },

  permissions: ['storage', 'activeTab', 'tabs', 'contextMenus', 'scripting', 'webNavigation'],
  host_permissions: ['https://api.mem0.ai/*', 'https://app.mem0.ai/*', 'https://claude.ai/*'],

  action: {
    default_popup: 'src/popup.html',
    default_icon: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
  },

  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },

  content_scripts: [
    { matches: ['https://claude.ai/*'], js: ['src/claude/content.ts'] },
    {
      matches: ['https://chat.openai.com/*', 'https://chatgpt.com/*'],
      js: ['src/chatgpt/content.ts'],
    },
    { matches: ['https://www.perplexity.ai/*'], js: ['src/perplexity/content.ts'] },
    { matches: ['https://app.mem0.ai/*'], js: ['src/mem0/content.ts'] },
    { matches: ['https://grok.com/*', 'https://x.com/i/grok*'], js: ['src/grok/content.ts'] },
    { matches: ['https://chat.deepseek.com/*'], js: ['src/deepseek/content.ts'] },
    { matches: ['https://gemini.google.com/*'], js: ['src/gemini/content.ts'] },
    { matches: ['https://replit.com/*'], js: ['src/replit/content.ts'] },
    { matches: ['<all_urls>'], js: ['src/sidebar.ts'], run_at: 'document_end' },
    {
      matches: ['<all_urls>'],
      js: ['src/selection_context.ts'],
      run_at: 'document_idle',
      all_frames: true,
    },
    { matches: ['<all_urls>'], js: ['src/search_tracker.ts'], run_at: 'document_idle' },
  ],

  web_accessible_resources: [{ resources: ['icons/*'], matches: ['<all_urls>'] }],
};

export default manifest;
