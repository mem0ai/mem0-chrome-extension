export type OrchestratorLike = { runImmediate: (q: string) => void };

export function createSearchSession<T>(opts: {
  normalizeQuery: (q: string) => string;
  defaultTimeoutMs?: number;
}) {
  const { normalizeQuery, defaultTimeoutMs = 15000 } = opts;

  type Pending = {
    resolve: (items: T[]) => void;
    reject: (err: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
    query: string;
  } | null;

  let pending: Pending = null;
  let stagedQuery = '';
  let stagedItems: T[] = [];

  function clearPending() {
    if (pending) {
      clearTimeout(pending.timeoutId);
      pending = null;
    }
  }

  function runSearchAndWait(
    orchestrator: OrchestratorLike,
    rawQuery: string,
    timeoutMs = defaultTimeoutMs
  ): Promise<T[]> {
    const norm = normalizeQuery(rawQuery);

    if (stagedQuery === norm && stagedItems.length) {
      return Promise.resolve(stagedItems);
    }

    if (pending) {
      pending.reject(new Error('superseded'));
      clearPending();
    }

    orchestrator.runImmediate(rawQuery);

    return new Promise<T[]>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        clearPending();
        reject(new Error('no-result'));
      }, timeoutMs);

      pending = { resolve, reject, timeoutId, query: norm };
    });
  }

  // Call from onSuccess of your orchestrator
  function onSuccess(normQuery: string, items: T[]) {
    stagedQuery = normQuery;
    stagedItems = items || [];
    if (pending && pending.query === normQuery) {
      clearTimeout(pending.timeoutId);
      pending.resolve(stagedItems);
      pending = null;
    }
  }

  // Call from onError of your orchestrator
  function onError(normQuery: string, err: Error) {
    if (pending && pending.query === normQuery) {
      clearTimeout(pending.timeoutId);
      pending.reject(err);
      pending = null;
    }
    stagedQuery = '';
    stagedItems = [];
  }

  return {
    runSearchAndWait,
    onSuccess,
    onError,
  };
}
