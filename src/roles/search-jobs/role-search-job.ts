import type {
  SearchPageStage,
  SearchPageStageEvent,
} from '../search/search.service';

export const ROLE_SEARCH_QUEUE = 'role-search';

// Pages one run loads before it pauses itself. Each page is a Vertex call
// plus two Gemini calls, so this is the main cost control. Change it here, or
// per environment with ROLE_SEARCH_PAGES_PER_RUN.
export const DEFAULT_PAGES_PER_RUN = 5;

export function pagesPerRun(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.ROLE_SEARCH_PAGES_PER_RUN);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_PAGES_PER_RUN;
}

// Searches run concurrently per API process; each is mostly waiting on
// Vertex and Gemini.
export const ROLE_SEARCH_CONCURRENCY = 3;

// One job per filter set: BullMQ ignores an add whose id already exists, so
// starting twice is a no-op. (BullMQ ids can't contain ':'.)
export const roleSearchJobId = (filterId: string) => `role-search-${filterId}`;

// Asked of a running job by the pause and stop endpoints, via its data.
// Pause finishes the page in hand; stop quits before the next batch.
export type RoleSearchControl = 'pause' | 'stop';

export interface RoleSearchJobData {
  orgId: string;
  roleId: string;
  filterId: string;
  userId: string;
  userName: string;
  roleName?: string;
  control: RoleSearchControl | null;
}

// What the job reports while it works (job.progress), for the R7 card and
// the loading bar.
export interface RoleSearchLive {
  // Pages into this run, 1..pagesPerRun.
  runPage: number;
  page: number;
  stage: SearchPageStage;
  completed: number;
  total: number;
  estimatedTotal: number | null;
  // Across this run.
  skippedDuplicates: number;
  // Results saved this run, in arrival order.
  savedIds: string[];
}

export const initialLive = (estimatedTotal: number | null): RoleSearchLive => ({
  runPage: 0,
  page: 0,
  stage: 'preparing',
  completed: 0,
  total: 0,
  estimatedTotal,
  skippedDuplicates: 0,
  savedIds: [],
});

export function applyStageEvent(
  live: RoleSearchLive,
  event: SearchPageStageEvent,
): RoleSearchLive {
  const next = { ...live, stage: event.stage, page: event.page };
  if (event.stage === 'preparing' && event.status === 'started') {
    next.completed = 0;
    next.total = 0;
  }
  if (event.stage === 'searching' && event.status === 'done') {
    next.total = event.found ?? 0;
    next.estimatedTotal = event.estimatedTotal ?? live.estimatedTotal;
    next.skippedDuplicates =
      live.skippedDuplicates + (event.skippedDuplicates ?? 0);
  }
  if (event.stage === 'scoring') next.completed = event.completed ?? 0;
  if (event.savedIds?.length) {
    next.savedIds = [...live.savedIds, ...event.savedIds];
  }
  return next;
}

// The run as the app sees it. queued/running/pausing/stopping have a live
// job; the rest come from the progress saved on the filter set.
export type RoleSearchStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'pausing'
  | 'stopping'
  | 'paused'
  | 'stopped'
  | 'complete'
  | 'failed';

export interface RoleSearchState {
  status: RoleSearchStatus;
  pagesLoaded: number;
  hasMore: boolean;
  estimatedTotal: number | null;
  pagesPerRun: number;
  error: string | null;
  updatedAt: string | null;
  live: RoleSearchLive | null;
}
