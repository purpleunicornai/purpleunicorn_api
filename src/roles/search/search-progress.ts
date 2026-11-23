// How far a role's paged search has got and how its last run ended, kept on
// the active filter set's metadata so it survives reloads and restarts, and a
// new filter set starts from page 1.
export const SEARCH_PROGRESS_KEY = 'searchProgress';

// Where a run stands once no job is working on it. 'running' is written while
// a job works; read back with no job alive, it means the worker died.
export const SEARCH_RUN_STATUSES = [
  'running',
  'paused',
  'stopped',
  'complete',
  'failed',
] as const;
export type SearchRunStatus = (typeof SEARCH_RUN_STATUSES)[number];

export type SearchProgress = {
  version: 1;
  // 0 until the first page of a run from scratch is saved.
  pagesLoaded: number;
  // The opaque s1. token for the next page; null before page 1 and once
  // every page is loaded.
  nextPageToken: string | null;
  estimatedTotal: number | null;
  status: SearchRunStatus;
  error: string | null;
  updatedAt: string;
};

export type SearchProgressPatch = Partial<
  Omit<SearchProgress, 'version' | 'updatedAt'>
>;

// What the app sees: the resume token stays on the server.
export type PublicSearchProgress = Omit<
  SearchProgress,
  'version' | 'nextPageToken'
> & { hasMore: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isExhausted = (progress: SearchProgress) =>
  progress.pagesLoaded > 0 && progress.nextPageToken === null;

export function parseSearchProgress(metadata: unknown): SearchProgress | null {
  const raw = isRecord(metadata) ? metadata[SEARCH_PROGRESS_KEY] : undefined;
  if (!isRecord(raw) || raw.version !== 1) return null;
  const { pagesLoaded, nextPageToken, estimatedTotal, status, error } = raw;
  if (typeof pagesLoaded !== 'number' || pagesLoaded < 0) return null;
  if (nextPageToken !== null && typeof nextPageToken !== 'string') return null;
  const progress: SearchProgress = {
    version: 1,
    pagesLoaded,
    nextPageToken,
    estimatedTotal: typeof estimatedTotal === 'number' ? estimatedTotal : null,
    // Progress saved before runs had a status ended after a page.
    status: 'stopped',
    error: typeof error === 'string' ? error : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
  if (SEARCH_RUN_STATUSES.includes(status as SearchRunStatus)) {
    progress.status = status as SearchRunStatus;
  } else if (isExhausted(progress)) {
    progress.status = 'complete';
  }
  return progress;
}

export function mergeSearchProgress(
  current: SearchProgress | null,
  patch: SearchProgressPatch,
  now = new Date(),
): SearchProgress {
  return {
    version: 1,
    pagesLoaded: 0,
    nextPageToken: null,
    estimatedTotal: null,
    status: 'running',
    error: null,
    ...current,
    ...patch,
    updatedAt: now.toISOString(),
  };
}

export function withSearchProgress(
  metadata: unknown,
  progress: SearchProgress,
): Record<string, unknown> {
  return {
    ...(isRecord(metadata) ? metadata : {}),
    [SEARCH_PROGRESS_KEY]: progress,
  };
}

export function toPublicSearchProgress(
  progress: SearchProgress,
): PublicSearchProgress {
  const { pagesLoaded, estimatedTotal, status, error, updatedAt } = progress;
  return {
    pagesLoaded,
    hasMore: !isExhausted(progress),
    estimatedTotal,
    status,
    error,
    updatedAt,
  };
}

// Filter-set metadata as the API returns it, with the progress made public.
export function publicFilterMetadata(
  metadata: unknown,
): Record<string, unknown> {
  if (!isRecord(metadata)) return {};
  const rest = { ...metadata };
  delete rest[SEARCH_PROGRESS_KEY];
  const progress = parseSearchProgress(metadata);
  if (!progress) return rest;
  return { ...rest, [SEARCH_PROGRESS_KEY]: toPublicSearchProgress(progress) };
}
