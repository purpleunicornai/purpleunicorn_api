import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import { SearchService } from '../search/search.service';
import {
  isExhausted,
  parseSearchProgress,
  SearchProgress,
} from '../search/search-progress';
import {
  pagesPerRun,
  ROLE_SEARCH_QUEUE,
  RoleSearchControl,
  RoleSearchJobData,
  RoleSearchLive,
  RoleSearchState,
  RoleSearchStatus,
  roleSearchJobId,
} from './role-search-job';

type RoleSearchJob = Job<RoleSearchJobData>;

// Job states in which the job is still going to run or is running.
const LIVE_STATES = new Set([
  'waiting',
  'prioritized',
  'delayed',
  'waiting-children',
  'active',
]);

export interface StartRoleSearchInput {
  orgId: string;
  roleId: string;
  userId: string;
  userName: string;
  roleName?: string;
}

// Starts, pauses, stops and reports the role's background search. The job
// does the work (RoleSearchProcessor); the filter set's metadata holds where
// it got to and how the last run ended, so status survives restarts.
@Injectable()
export class RoleSearchJobsService {
  constructor(
    @InjectQueue(ROLE_SEARCH_QUEUE)
    private readonly queue: Queue<RoleSearchJobData>,
    private readonly searchService: SearchService,
  ) {}

  async status(roleId: string): Promise<RoleSearchState> {
    const filterSet = await this.searchService.findActiveFilterSet(roleId);
    if (!filterSet) return this.describe(null, null, null);
    const job = await this.liveJob(filterSet.uid);
    return this.describe(
      parseSearchProgress(filterSet.metadata),
      job?.job ?? null,
      job?.state ?? null,
    );
  }

  // Idempotent: a live job is left running (and un-paused, if a pause or
  // stop was pending), and BullMQ dedupes concurrent adds by job id.
  async start(
    input: StartRoleSearchInput,
    { restart }: { restart: boolean },
  ): Promise<RoleSearchState> {
    const filterSet = await this.searchService.findActiveFilterSet(
      input.roleId,
    );
    if (!filterSet) {
      throw new RequestException(
        'Save filters before running a search',
        HttpStatus.NOT_FOUND,
        'ROLE_FILTER_NOT_FOUND',
      );
    }

    const jobId = roleSearchJobId(filterSet.uid);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (LIVE_STATES.has(state)) {
        if (existing.data.control) {
          await existing.updateData({ ...existing.data, control: null });
        }
        return this.status(input.roleId);
      }
      // A finished job kept by a failed removal; clear it so the id is free.
      await existing.remove();
    }

    const progress = parseSearchProgress(filterSet.metadata);
    if (!restart && progress && isExhausted(progress)) {
      return this.status(input.roleId);
    }

    if (restart) {
      // Reset here rather than in the job so status reads page 0 at once,
      // and a job retried after a worker restart resumes, not restarts.
      await this.searchService.saveSearchProgress(filterSet.uid, {
        pagesLoaded: 0,
        nextPageToken: null,
        estimatedTotal: null,
        status: 'running',
        error: null,
      });
    }
    await this.queue.add(
      'run',
      { ...input, filterId: filterSet.uid, control: null },
      { jobId, removeOnComplete: true, removeOnFail: true },
    );
    return this.status(input.roleId);
  }

  pause(roleId: string): Promise<RoleSearchState> {
    return this.control(roleId, 'pause');
  }

  stop(roleId: string): Promise<RoleSearchState> {
    return this.control(roleId, 'stop');
  }

  // A running job is asked through its data and checks between batches; a
  // job still waiting is simply removed. Without a job there's nothing to do.
  private async control(
    roleId: string,
    control: RoleSearchControl,
  ): Promise<RoleSearchState> {
    const filterSet = await this.searchService.findActiveFilterSet(roleId);
    const live = filterSet ? await this.liveJob(filterSet.uid) : null;
    if (filterSet && live) {
      if (live.state === 'active') {
        await live.job.updateData({ ...live.job.data, control });
      } else {
        await live.job.remove();
        await this.searchService.saveSearchProgress(filterSet.uid, {
          status: control === 'pause' ? 'paused' : 'stopped',
        });
      }
    }
    return this.status(roleId);
  }

  private async liveJob(
    filterId: string,
  ): Promise<{ job: RoleSearchJob; state: string } | null> {
    const job = await this.queue.getJob(roleSearchJobId(filterId));
    if (!job) return null;
    const state = await job.getState();
    return LIVE_STATES.has(state) ? { job, state } : null;
  }

  private describe(
    progress: SearchProgress | null,
    job: RoleSearchJob | null,
    state: string | null,
  ): RoleSearchState {
    return {
      status: this.statusOf(progress, job, state),
      pagesLoaded: progress?.pagesLoaded ?? 0,
      hasMore: progress ? !isExhausted(progress) : true,
      estimatedTotal: progress?.estimatedTotal ?? null,
      pagesPerRun: pagesPerRun(),
      error: job ? null : (progress?.error ?? null),
      updatedAt: progress?.updatedAt || null,
      live: job ? liveOf(job) : null,
    };
  }

  private statusOf(
    progress: SearchProgress | null,
    job: RoleSearchJob | null,
    state: string | null,
  ): RoleSearchStatus {
    if (job) {
      if (job.data.control === 'pause') return 'pausing';
      if (job.data.control === 'stop') return 'stopping';
      return state === 'active' ? 'running' : 'queued';
    }
    if (!progress) return 'idle';
    // Saved as running but no job alive: the worker died mid-run.
    return progress.status === 'running' ? 'stopped' : progress.status;
  }
}

function liveOf(job: RoleSearchJob): RoleSearchLive | null {
  const progress: unknown = job.progress;
  return typeof progress === 'object' && progress !== null && 'page' in progress
    ? (progress as RoleSearchLive)
    : null;
}
