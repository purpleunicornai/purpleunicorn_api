import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { LogsService } from '../../common/logs/logs.service';
import { SearchService } from '../search/search.service';
import {
  applyStageEvent,
  initialLive,
  pagesPerRun,
  ROLE_SEARCH_CONCURRENCY,
  ROLE_SEARCH_QUEUE,
  RoleSearchControl,
  RoleSearchJobData,
  RoleSearchLive,
} from './role-search-job';

// Loads the role's search page by page in the background, up to
// pagesPerRun() pages, so it carries on after the tab closes. Between batches
// it checks for a stop; between pages for a pause or stop. Where it got to is
// saved on the filter set after every page, and how the run ended at the end.
@Processor(ROLE_SEARCH_QUEUE, { concurrency: ROLE_SEARCH_CONCURRENCY })
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

  async process(job: Job<RoleSearchJobData>): Promise<void> {
    const { orgId, roleId, filterId, userId, userName, roleName } = job.data;
    const finish = (
      status: 'paused' | 'stopped' | 'complete' | 'failed',
      error: string | null = null,
    ) => this.searchService.saveSearchProgress(filterId, { status, error });

    try {
      const started = await this.searchService.saveSearchProgress(filterId, {
        status: 'running',
        error: null,
      });
      let live: RoleSearchLive = initialLive(started.estimatedTotal);
      const cap = pagesPerRun();
      for (let runPage = 1; runPage <= cap; runPage++) {
        live = { ...live, runPage };
        await job.updateProgress(live);
        const outcome = await this.searchService.runSearchPage(
          roleId,
          filterId,
          userId,
          userName,
          roleName,
          {
            onStage: async (event) => {
              live = applyStageEvent(live, event);
              await job.updateProgress(live);
            },
            shouldStop: async () => (await this.controlOf(job)) === 'stop',
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

        const control = await this.controlOf(job);
        if (control) {
          return void (await finish(control === 'stop' ? 'stopped' : 'paused'));
        }
      }
      await finish('paused');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Role search ${job.id} failed: ${message}`);
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
