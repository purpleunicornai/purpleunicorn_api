import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { LogsService } from '../../common/logs/logs.service';
import { SearchService } from '../search/search.service';
import {
  applyStageEvent,
  INLINE_RUN_BUDGET_MS,
  INLINE_TIMEOUT_MESSAGE,
  initialLive,
  pagesPerRun,
  ROLE_SEARCH_QUEUE,
  ROLE_SEARCH_WORKER,
  RoleSearchControl,
  RoleSearchJobData,
  RoleSearchLive,
} from './role-search-job';

// Loads the role's search page by page, up to pagesPerRun() pages: as a
// background job (so it carries on after the tab closes), or on Vercel inside
// the start request. Between batches it checks for a stop; between pages for a
// pause or stop. Where it got to is saved on the filter set after every page,
// and how the run ended at the end.
@Processor(ROLE_SEARCH_QUEUE, ROLE_SEARCH_WORKER)
export class RoleSearchProcessor extends WorkerHost {
  private readonly logger = new Logger(RoleSearchProcessor.name);

  constructor(
    @InjectQueue(ROLE_SEARCH_QUEUE)
    private readonly queue: Queue<RoleSearchJobData>,
    private readonly searchService: SearchService,
    private readonly logsService: LogsService,
  ) {
    super();
  }

  // The worker's entry: a queued job, with live progress and pause/stop kept
  // on the job.
  process(job: Job<RoleSearchJobData>): Promise<void> {
    return this.run(job.data, {
      onProgress: (live) => job.updateProgress(live),
      control: () => this.controlOf(job),
    });
  }

  // Vercel: run the search in the calling request. Past the budget the run
  // is cut off at its next checkpoint and recorded failed, so it never stays
  // on "running". Pause and stop need a job, so they don't apply here.
  async runInline(
    data: RoleSearchJobData,
    budgetMs = INLINE_RUN_BUDGET_MS,
  ): Promise<void> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), budgetMs);
    const timeout = new Promise<'timeout'>((resolve) =>
      abort.signal.addEventListener('abort', () => resolve('timeout')),
    );
    try {
      const outcome = await Promise.race([
        this.run(data, { signal: abort.signal }).then(() => 'done' as const),
        timeout,
      ]);
      if (outcome === 'timeout') {
        this.logger.error(`Role search ${data.filterId} timed out`);
        await this.searchService.saveSearchProgress(data.filterId, {
          status: 'failed',
          error: INLINE_TIMEOUT_MESSAGE,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // An aborted signal reads as a stop and silences the run's own writes, so
  // whoever aborted records how it ended.
  private async run(
    data: RoleSearchJobData,
    {
      onProgress,
      control,
      signal,
    }: {
      onProgress?: (live: RoleSearchLive) => Promise<unknown>;
      control?: () => Promise<RoleSearchControl | null>;
      signal?: AbortSignal;
    } = {},
  ): Promise<void> {
    const { orgId, roleId, filterId, userId, userName, roleName } = data;
    const finish = async (
      status: 'paused' | 'stopped' | 'complete' | 'failed',
      error: string | null = null,
    ) => {
      if (!signal?.aborted) {
        await this.searchService.saveSearchProgress(filterId, {
          status,
          error,
        });
      }
    };
    const controlOf = async (): Promise<RoleSearchControl | null> =>
      signal?.aborted ? 'stop' : ((await control?.()) ?? null);

    try {
      const started = await this.searchService.saveSearchProgress(filterId, {
        status: 'running',
        error: null,
      });
      let live: RoleSearchLive = initialLive(started.estimatedTotal);
      const cap = pagesPerRun();
      for (let runPage = 1; runPage <= cap; runPage++) {
        live = { ...live, runPage };
        await onProgress?.(live);
        const outcome = await this.searchService.runSearchPage(
          roleId,
          filterId,
          userId,
          userName,
          roleName,
          {
            onStage: async (event) => {
              live = applyStageEvent(live, event);
              await onProgress?.(live);
            },
            shouldStop: async () => (await controlOf()) === 'stop',
          },
        );

        if (outcome.kind === 'superseded') return;
        if (outcome.kind === 'stopped') return void (await finish('stopped'));
        if (outcome.saved > 0 || outcome.tokensUsed > 0) {
          void this.logsService.log({
            organization_id: orgId,
            user_id: userId,
            type: 'ROLE_SEARCH',
            role_id: roleId,
            tokens_used: outcome.tokensUsed,
            message: `Ran search page ${outcome.page} for role "${roleName ?? roleId}", saved ${outcome.saved} candidate(s)`,
          });
        }
        if (!outcome.hasMore) return void (await finish('complete'));

        const requested = await controlOf();
        if (requested) {
          return void (await finish(
            requested === 'stop' ? 'stopped' : 'paused',
          ));
        }
      }
      await finish('paused');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Role search ${filterId} failed: ${message}`);
      await finish('failed', message).catch(() => undefined);
    }
  }

  // The endpoints write pause/stop into the job's data, so read it fresh.
  private async controlOf(
    job: Job<RoleSearchJobData>,
  ): Promise<RoleSearchControl | null> {
    const current = job.id ? await this.queue.getJob(job.id) : undefined;
    return current?.data.control ?? null;
  }
}
