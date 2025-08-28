export function initContextMenuMemory() {
  try {
    chrome.contextMenus.create(
      {
        id: "mem0.saveSelection",
        title: "Save to OpenMemory",
        contexts: ["selection"],
      },
      () => { chrome.runtime && chrome.runtime.lastError; }
    );
  } catch (e) {
    // ignore
  }

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab || !tab.id || info.menuItemId !== "mem0.saveSelection") return;

    const selection = (info.selectionText || "").trim();
    if (!selection) { toast(tab.id, "Select text first", "error"); return; }

    const settings = await getSettings();
    if (!settings.hasCreds) { toast(tab.id, "Sign in required", "error"); return; }
    if (settings.memoryEnabled === false) { toast(tab.id, "Memory is disabled in settings", "error"); return; }

    const title = tab.title || "";
    const url = info.pageUrl || tab.url || "";

    let ctx = await requestSelectionContext(tab.id);
    if (ctx && ctx.error) { await tryInjectSelectionScript(tab.id); ctx = await requestSelectionContext(tab.id); }
    const content = composeBasic({ selection, title, url });

    try {
      const ok = await addMemory(content, settings, url);
      toast(tab.id, ok ? "Saved to OpenMemory" : "Failed to save", ok ? "success" : "error");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to add memory:", err);
      toast(tab.id, "Failed to save", "error");
    }
  });
}

function toast(tabId, message, variant = "success") {
  try {
    chrome.tabs.sendMessage(tabId, {
      type: "mem0:toast",
      payload: { message, variant },
    });
  } catch (e) {
    // Best effort only
  }
}

function normalize(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function clamp(text, max) {
  if (!text) return text;
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function composeBasic({ selection, title, url }) {
  const s = clamp(normalize(selection), 700);
  // Return raw selection only (no prefixes). We keep title/url only in metadata.
  return s;
}

function requestSelectionContext(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: "mem0:getSelectionContext" }, (resp) => {
        if (chrome.runtime && chrome.runtime.lastError) { resolve({ error: chrome.runtime.lastError.message }); return; }
        resolve(resp || { error: "no-response" });
      });
    } catch (e) {
      resolve({ error: String(e) });
    }
  });
}

async function tryInjectSelectionScript(tabId) {
  try {
    if (!chrome.scripting) return false;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['selection_context.js']
    });
    return true;
  } catch (e) { return false; }
}


function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      [
        "apiKey",
        "access_token",
        "user_id",
        "selected_org",
        "selected_project",
        "memory_enabled",
      ],
      (d) => {
        resolve({
          hasCreds: Boolean(d.apiKey || d.access_token),
          apiKey: d.apiKey || null,
          accessToken: d.access_token || null,
          userId: d.user_id || "chrome-extension-user",
          orgId: d.selected_org || null,
          projectId: d.selected_project || null,
          memoryEnabled: d.memory_enabled !== false,
        });
      }
    );
  });
}

async function addMemory(content, settings, pageUrl) {
  const headers = { "Content-Type": "application/json" };
  if (settings.accessToken) headers.Authorization = `Bearer ${settings.accessToken}`;
  else if (settings.apiKey) headers.Authorization = `Token ${settings.apiKey}`;
  else throw new Error("Missing credentials");

  const body = {
    messages: [{ role: "user", content }],
    user_id: settings.userId,
    metadata: {
      provider: "ContextMenu",
      category: "BOOKMARK",
    },
    source: "OPENMEMORY_CHROME_EXTENSION",
  };
  if (settings.orgId) body.org_id = settings.orgId;
  if (settings.projectId) body.project_id = settings.projectId;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch("https://api.mem0.ai/v1/memories/", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res.ok;
  } finally {
    clearTimeout(timeout);
  }
}


