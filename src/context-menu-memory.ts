import { type ApiMemoryRequest, DEFAULT_USER_ID, MessageRole, SOURCE } from './types/api';
import {
  MessageType,
  type SelectionContextResponse,
  type ToastMessage,
  ToastVariant,
} from './types/messages';
import { Category, Provider } from './types/providers';
import type { Settings } from './types/settings';
import { StorageKey } from './types/storage';

export function initContextMenuMemory(): void {
  try {
    chrome.contextMenus.create(
      {
        id: 'mem0.saveSelection',
        title: 'Save to OpenMemory',
        contexts: ['selection'],
      },
      () => {
        /* no-op */
      }
    );
  } catch {
    // ignore
  }

  chrome.contextMenus.onClicked.addListener(
    async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
      if (
        !tab ||
        tab.id === null ||
        tab.id === undefined ||
        info.menuItemId !== 'mem0.saveSelection'
      ) {
        return;
      }

      const tabId = tab.id; // Type narrowing - we know tab.id is not null or undefined here

      const selection = String(info.selectionText || '').trim();
      if (!selection) {
        toast(tabId, 'Select text first', ToastVariant.ERROR);
        return;
      }

      const settings = await getSettings();
      if (!settings.hasCreds) {
        toast(tabId, 'Sign in required', ToastVariant.ERROR);
        return;
      }
      if (settings.memoryEnabled === false) {
        toast(tabId, 'Memory is disabled in settings', ToastVariant.ERROR);
        return;
      }

      const title = tab.title || '';
      const url = info.pageUrl || tab.url || '';

      let ctx = await requestSelectionContext(tabId);
      if (ctx && ctx.error) {
        await tryInjectSelectionScript(tabId);
        ctx = await requestSelectionContext(tabId);
      }
      const content = composeBasic({ selection, title, url });

      try {
        const ok = await addMemory(content, settings);
        toast(
          tabId,
          ok ? 'Saved to OpenMemory' : 'Failed to save',
          ok ? ToastVariant.SUCCESS : ToastVariant.ERROR
        );
      } catch (err) {
        console.error('Failed to add memory:', err);
        toast(tabId, 'Failed to save', ToastVariant.ERROR);
      }
    }
  );
}

function toast(tabId: number, message: string, variant: ToastVariant = ToastVariant.SUCCESS): void {
  try {
    const msg: ToastMessage = { type: MessageType.TOAST, payload: { message, variant } };
    chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // Best effort only
  }
}

function normalize(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function clamp(text: string, max: number): string {
  if (!text) {
    return text;
  }
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max - 1).trimEnd() + '…';
}

function composeBasic({ selection }: { selection: string; title: string; url: string }): string {
  const s = clamp(normalize(selection), 700);
  // Return raw selection only (no prefixes). We keep title/url only in metadata.
  return s;
}

function requestSelectionContext(tabId: number): Promise<SelectionContextResponse> {
  return new Promise(resolve => {
    try {
      chrome.tabs.sendMessage(
        tabId,
        { type: MessageType.GET_SELECTION_CONTEXT },
        undefined,
        (resp?: SelectionContextResponse) => {
          resolve(resp || { error: 'no-response' });
        }
      );
    } catch (e) {
      resolve({ error: String(e) });
    }
  });
}

async function tryInjectSelectionScript(tabId: number): Promise<boolean> {
  try {
    if (!chrome.scripting) {
      return false;
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['selection_context.ts'],
    });
    return true;
  } catch {
    return false;
  }
}

function getSettings(): Promise<Settings> {
  return new Promise<Settings>(resolve => {
    chrome.storage.sync.get(
      [
        StorageKey.API_KEY,
        StorageKey.ACCESS_TOKEN,
        StorageKey.USER_ID,
        StorageKey.SELECTED_ORG,
        StorageKey.SELECTED_PROJECT,
        StorageKey.MEMORY_ENABLED,
      ],
      d => {
        resolve({
          hasCreds: Boolean(d[StorageKey.API_KEY] || d[StorageKey.ACCESS_TOKEN]),
          apiKey: d[StorageKey.API_KEY],
          accessToken: d[StorageKey.ACCESS_TOKEN],
          userId: d[StorageKey.USER_ID] || DEFAULT_USER_ID,
          orgId: d[StorageKey.SELECTED_ORG],
          projectId: d[StorageKey.SELECTED_PROJECT],
          memoryEnabled: d[StorageKey.MEMORY_ENABLED] !== false,
        });
      }
    );
  });
}

async function addMemory(content: string, settings: Settings): Promise<boolean> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.accessToken) {
    headers.Authorization = `Bearer ${settings.accessToken}`;
  } else if (settings.apiKey) {
    headers.Authorization = `Token ${settings.apiKey}`;
  } else {
    throw new Error('Missing credentials');
  }

  const body: ApiMemoryRequest = {
    messages: [{ role: MessageRole.User, content }],
    user_id: settings.userId,
    metadata: {
      provider: Provider.ContextMenu,
      category: Category.BOOKMARK,
    },
    source: SOURCE,
  };
  if (settings.orgId) {
    body.org_id = settings.orgId;
  }
  if (settings.projectId) {
    body.project_id = settings.projectId;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://api.mem0.ai/v1/memories/', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res.ok;
  } finally {
    clearTimeout(timeout);
  }
}
