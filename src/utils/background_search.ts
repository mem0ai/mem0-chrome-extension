type OrchestratorOptionsBase = {
  minLength?: number;
  debounceMs?: number;
  cacheTTL?: number;
  useCache?: boolean;
  refreshOnCache?: boolean;
};

type OrchestratorOptions = OrchestratorOptionsBase & {
  fetch: (query: string, args: { signal?: AbortSignal }) => Promise<void>;
  onStart?: (normalized: string) => void;
  onSuccess?: (normalized: string, cached: any, args: { fromCache?: boolean }) => void;
  onError?: (normalized: string, error: Error) => void;
  onFinally?: (normalized: string) => void;
};

export function normalizeQuery(query: string): string {
  if (!query) {
    return "";
  }
  return String(query).trim().replace(/\s+/g, " ").toLowerCase();
}

export function createOrchestrator(options: OrchestratorOptions) {
  const fetchFn = options && options.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error(
      "OPENMEMORY_SEARCH createOrchestrator requires options.fetch(query, { signal })"
    );
  }

  const onStart = options.onStart || (() => {});
  const onSuccess = options.onSuccess || (() => {});
  const onError = options.onError || (() => {});
  const onFinally = options.onFinally || (() => {});

  let minLength = typeof options.minLength === "number" ? options.minLength : 3;
  let debounceMs = typeof options.debounceMs === "number" ? options.debounceMs : 300;
  let cacheTTL = typeof options.cacheTTL === "number" ? options.cacheTTL : 60_000;
  let useCache = options.useCache !== false;
  let refreshOnCache = !!options.refreshOnCache;

  let latestText = "";
  let lastCompletedQuery = "";
  let lastResult: any | null = null;

  let inFlightQuery: string | null = null;
  let abortController: AbortController | null = null;

  let timerId: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;

  let cache = new Map<string, { ts: number; result: any }>();

  function getState() {
    return {
      latestText: latestText,
      lastCompletedQuery: lastCompletedQuery,
      lastResult: lastResult,
      inFlightQuery: inFlightQuery,
      isInFlight: !!inFlightQuery,
      cacheSize: cache.size,
    };
  }

  function setOptions(newOpts: OrchestratorOptionsBase): void {
    if (!newOpts) {
      return;
    }
    if (typeof newOpts.minLength === "number") {
      minLength = newOpts.minLength;
    }
    if (typeof newOpts.debounceMs === "number") {
      debounceMs = newOpts.debounceMs;
    }
    if (typeof newOpts.cacheTTL === "number") {
      cacheTTL = newOpts.cacheTTL;
    }
    if (typeof newOpts.useCache === "boolean") {
      useCache = newOpts.useCache;
    }
    if (typeof newOpts.refreshOnCache === "boolean") {
      refreshOnCache = newOpts.refreshOnCache;
    }
  }

  function clearTimer(): void {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function clearCache(): void {
    cache.clear();
  }

  function getCached(normQuery: string): any | null {
    if (!useCache) {
      return null;
    }
    let v = cache.get(normQuery);
    if (!v) {
      return null;
    }
    if (Date.now() - v.ts > cacheTTL) {
      cache.delete(normQuery);
      return null;
    }
    return v.result;
  }

  function setCached(normQuery: string, result: any): void {
    cache.set(normQuery, { ts: Date.now(), result: result });
  }

  function cancel() {
    clearTimer();
    if (abortController) {
      try {
        abortController.abort();
      } catch (_) {
        /* empty */
      }
    }
    inFlightQuery = null;
    abortController = null;
  }

  function run(query: string | null): void {
    let raw = query !== null ? String(query) : latestText;
    let norm = normalizeQuery(raw);
    if (!norm || norm.length < minLength) {
      return;
    }

    let cached = getCached(norm);
    if (cached) {
      onSuccess(norm, cached, { fromCache: true });
      if (!refreshOnCache) {
        return;
      }
    }

    if (inFlightQuery && inFlightQuery === norm) {
      return;
    }
    if (inFlightQuery && inFlightQuery !== norm && abortController) {
      try {
        abortController.abort();
      } catch (_) {
        /* empty */
      }
    }

    inFlightQuery = norm;
    abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
    let mySeq = ++seq;

    onStart(norm);

    Promise.resolve()
      .then(function () {
        return fetchFn(norm, { signal: abortController ? abortController.signal : undefined });
      })
      .then(function (result) {
        if (inFlightQuery !== norm || mySeq !== seq) {
          return;
        }

        setCached(norm, result);
        lastCompletedQuery = norm;
        lastResult = result;
        onSuccess(norm, result, { fromCache: false });
      })
      .catch(function (err: Error) {
        let aborted =
          (abortController && abortController.signal && abortController.signal.aborted) ||
          (err && err.name === "AbortError");
        if (mySeq !== seq) {
          return;
        }
        if (!aborted) {
          onError(norm, err);
        }
      })
      .finally(function () {
        if (mySeq !== seq) {
          return;
        }
        inFlightQuery = null;
        abortController = null;
        onFinally(norm);
      });
  }

  function schedule(): void {
    clearTimer();
    if (!latestText || normalizeQuery(latestText).length < minLength) {
      return;
    }
    timerId = setTimeout(() => {
      timerId = null;
      run(latestText);
    }, debounceMs);
  }

  return {
    setText: function (text: string | null): void {
      latestText = !text ? "" : String(text);
      schedule();
    },
    runImmediate: function (text: string | null) {
      if (text) {
        latestText = String(text);
      }
      clearTimer();
      run(latestText);
    },
    cancel: cancel,
    getState: getState,
    setOptions: setOptions,
    clearCache: clearCache,
  };
}
