// Direct URL tracking (typed navigations) for background service worker
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
      provider: "DirectURL",
      category: "NAVIGATION",
      page_url: pageUrl || "",
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

function shouldTrackTyped(details) {
  if (!details || details.frameId !== 0) return false;
  const url = details.url || "";
  if (!/^https?:\/\//i.test(url)) return false;
  const type = details.transitionType || "";
  const qualifiers = details.transitionQualifiers || [];
  if (type === "typed") return true;
  if (qualifiers && qualifiers.includes("from_address_bar")) return true;
  return false;
}

export function initDirectUrlTracking() {
  try {
    chrome.webNavigation.onCommitted.addListener(async (details) => {
      try {
        if (!shouldTrackTyped(details)) return;
        const url = details.url;
        if (!url) return;
        // Skip if this is a known search results page (handled by search_tracker.js)
        if (isSearchResultsUrl(url)) return;

        const settings = await getSettings();
        if (!settings.hasCreds || settings.memoryEnabled === false) return;
        // Gate by track_searches toggle (default OFF if undefined). We treat typed URL as part of tracking searches/history.
        const allow = await new Promise((resolve) => {
          try {
            chrome.storage.sync.get(["track_searches"], (d) => {
              resolve(d.track_searches === true);
            });
          } catch { resolve(false); }
        });
        if (!allow) return;
        const hostname = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
        const ts = formatTimestamp();
        const content = `User visited ${url}${hostname ? ` (${hostname})` : ""} on ${ts.date} at ${ts.time}`;
        await addMemory(content, settings, url);
      } catch {
        // no-op
      }
    });
  } catch {
    // no-op
  }
}

function isSearchResultsUrl(urlString) {
  try {
    const u = new URL(urlString);
    const host = u.hostname || "";
    const path = u.pathname || "";
    const params = u.searchParams || new URLSearchParams();

    // Google results: /search?q=
    if ((/^.*\.google\.[^\/]+$/.test(host) || host === "google.com" || host.endsWith(".google.com")) && path.startsWith("/search")) {
      if (params.get("q")) return true;
    }

    // Bing results: /search?q=
    if (host.endsWith("bing.com") && (path === "/search" || path === "/")) {
      if (params.get("q")) return true;
    }

    // Brave results: /search?q= or /images?q=
    if (host === "search.brave.com" && (path === "/search" || path === "/images")) {
      if (params.get("q")) return true;
    }

    // Arc results: /search?q= (or query=)
    if (host === "search.arc.net" && path.startsWith("/search")) {
      if (params.get("q") || params.get("query")) return true;
    }

    return false;
  } catch {
    return false;
  }
}

function formatTimestamp() {
  try {
    const now = new Date();
    const date = now.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric'
    });
    const time = now.toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit'
    });
    return { date, time };
  } catch {
    return { date: new Date().toISOString().slice(0,10), time: new Date().toISOString().slice(11,16) };
  }
}


