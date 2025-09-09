import type { MemorySearchItem } from './memory';
import type { StorageKey } from './storage';

export type SearchStorage = Partial<{
  [StorageKey.API_KEY]: string;
  [StorageKey.USER_ID_CAMEL]: string;
  [StorageKey.ACCESS_TOKEN]: string;
  [StorageKey.SELECTED_ORG]: string;
  [StorageKey.SELECTED_PROJECT]: string;
  [StorageKey.USER_ID]: string;
  [StorageKey.SIMILARITY_THRESHOLD]: number;
  [StorageKey.TOP_K]: number;
}>;

export type FetchFn<T> = (query: string, opts: { signal?: AbortSignal }) => Promise<T> | T;

export interface OrchestratorOptions {
  fetch: FetchFn<MemorySearchItem[]>;
  onStart?: (normalizedQuery: string) => void;
  onSuccess?: (
    normalizedQuery: string,
    result: MemorySearchItem[],
    meta: { fromCache: boolean }
  ) => void;
  onError?: (normalizedQuery: string, err: Error) => void;
  onFinally?: (normalizedQuery: string) => void;
  minLength?: number;
  debounceMs?: number;
  cacheTTL?: number;
  useCache?: boolean;
  refreshOnCache?: boolean;
}

export interface OrchestratorState {
  latestText: string;
  lastCompletedQuery: string;
  lastResult: MemorySearchItem[] | null;
  inFlightQuery: string | null;
  isInFlight: boolean;
  cacheSize: number;
}

export interface Orchestrator {
  setText(text?: string): void;
  runImmediate(text?: string | null): void;
  cancel(): void;
  getState(): OrchestratorState;
  setOptions(
    opts: Partial<
      Pick<
        OrchestratorOptions,
        'minLength' | 'debounceMs' | 'cacheTTL' | 'useCache' | 'refreshOnCache'
      >
    >
  ): void;
  clearCache(): void;
}
