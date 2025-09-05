import type { Settings } from "./types/settings";
import type { HistoryStateData, HistoryUrl } from "./types/browser";
import type { ApiMemoryRequest } from "./types/api";
import { Provider, Category } from "./types/providers";
import { MessageRole } from "./types/api";
import { Source, DEFAULT_USER_ID } from "./types/api";
import { StorageKey } from "./types/storage";
import { API_MEMORIES } from "./consts/api";

(function () {
  // Utilities
  function normalize(text: string): string {
    return (text || "").replace(/\s+/g, " ").trim();
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

  function formatTimestamp(): { date: string; time: string } {
    try {
      const now = new Date();
      const date = now.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      const time = now.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      return { date, time };
    } catch {
      return {
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toISOString().slice(11, 16),
      };
    }
  }

  async function addMemory(
    content: string,
    settings: Settings,
    pageUrl: string,
    engine: string
  ): Promise<boolean> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.accessToken) {
      headers.Authorization = `Bearer ${settings.accessToken}`;
    } else if (settings.apiKey) {
      headers.Authorization = `Token ${settings.apiKey}`;
    } else {
      return false;
    }

    const body: ApiMemoryRequest = {
      messages: [{ role: MessageRole.User, content }],
      user_id: settings.userId,
      metadata: {
        provider: Provider.SearchTracker,
        category: Category.SEARCH,
        engine: engine || "",
        page_url: pageUrl || location.href,
      },
      source: Source.OPENMEMORY_CHROME_EXTENSION,
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
      const res = await fetch(API_MEMORIES, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  function maybeSend(engine: string, query: string): void {
    const q = normalize(query);
    if (!q || q.length < 2) {
      return;
    }

    getSettings().then(async settings => {
      if (!settings.hasCreds || settings.memoryEnabled === false) {
        return;
      }
      // Gate by track_searches toggle (default ON if undefined)
      const allow = await new Promise<boolean>(resolve => {
        try {
          chrome.storage.sync.get([StorageKey.TRACK_SEARCHES], d => {
            resolve(d[StorageKey.TRACK_SEARCHES] !== false);
          });
        } catch {
          resolve(true);
        }
      });
      if (!allow) {
        return;
      }
      const ts = formatTimestamp();
      const content = `Searched on ${engine}: ${q} on ${ts.date} at ${ts.time}`;
      const ok = await addMemory(content, settings, location.href, engine);
    });
  }

  // URL based capture for results pages
  function urlCapture(): void {
    const host = location.hostname || "";
    const path = location.pathname || "";
    const params = new URLSearchParams(location.search || "");

    // Google results
    if (/(^|\.)google\./.test(host) && path.startsWith("/search")) {
      const q = params.get("q");
      if (q) {
        maybeSend("Google", q);
      }
      return;
    }

    // Bing results
    if (host.endsWith("bing.com") && (path === "/search" || path === "/")) {
      const q = params.get("q");
      if (q) {
        maybeSend("Bing", q);
      }
      return;
    }

    // Brave results
    if (host === "search.brave.com" && (path === "/search" || path === "/images")) {
      const q = params.get("q");
      if (q) {
        maybeSend("Brave", q);
      }
      return;
    }

    // Arc results
    if (host === "search.arc.net" && (path === "/search" || path.startsWith("/search"))) {
      const q = params.get("q") || params.get("query");
      if (q) {
        maybeSend("Arc", q);
      }
      return;
    }
  }

  function installSpaUrlWatcher(): void {
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    const onUrlChange = () => {
      try {
        urlCapture();
      } catch {}
    };

    history.pushState = function (data: HistoryStateData, unused: string, url?: HistoryUrl) {
      origPush(data, unused, url);
      onUrlChange();
    };

    history.replaceState = function (data: HistoryStateData, unused: string, url?: HistoryUrl) {
      origReplace(data, unused, url);
      onUrlChange();
    };

    window.addEventListener("popstate", onUrlChange);
  }

  // Run
  urlCapture();
  installSpaUrlWatcher();
})();
