import { SearchService } from '../search/search.service';
import { SearchProgress } from '../search/search-progress';
import { FakeJob, FakeQueue } from './fake-queue-spec';
import { RoleSearchJobData, roleSearchJobId } from './role-search-job';
import { RoleSearchJobsService } from './role-search-jobs.service';

const progress = (patch: Partial<SearchProgress> = {}) => ({
  searchProgress: {
    version: 1,
    pagesLoaded: 2,
    nextPageToken: 's1.next',
    estimatedTotal: 1240,
    status: 'paused',
    error: null,
    updatedAt: '2026-11-17T10:00:00.000Z',
    ...patch,
  },
});

const jobData = (
  patch: Partial<RoleSearchJobData> = {},
): RoleSearchJobData => ({
  orgId: 'org-1',
  roleId: 'role-1',
  filterId: 'filter-1',
  userId: 'user-1',
  userName: 'Jane Admin',
  roleName: 'Senior Finance Manager',
  control: null,
  ...patch,
});

const startInput = {
  orgId: 'org-1',
  roleId: 'role-1',
  userId: 'user-1',
  userName: 'Jane Admin',
  roleName: 'Senior Finance Manager',
};

describe('RoleSearchJobsService', () => {
  let queue: FakeQueue;
  let searchService: {
    findActiveFilterSet: jest.Mock;
    saveSearchProgress: jest.Mock;
  };
  let service: RoleSearchJobsService;
  const jobId = roleSearchJobId('filter-1');
  const withFilterSet = (metadata: unknown) =>
    searchService.findActiveFilterSet.mockResolvedValue({
      uid: 'filter-1',
      metadata,
    });
  const withJob = (state: string, patch: Partial<RoleSearchJobData> = {}) => {
    const job = new FakeJob(queue, jobId, jobData(patch), state);
    queue.jobs.set(jobId, job);
    return job;
  };

  beforeEach(() => {
    delete process.env.ROLE_SEARCH_PAGES_PER_RUN;
    queue = new FakeQueue();
    searchService = {
      findActiveFilterSet: jest.fn().mockResolvedValue(null),
      saveSearchProgress: jest.fn().mockResolvedValue(undefined),
    };
    service = new RoleSearchJobsService(
      queue as never,
      searchService as unknown as SearchService,
    );
  });

  describe('start', () => {
    it('queues one job for the active filter set', async () => {
      withFilterSet({});

      const state = await service.start(startInput, { restart: true });

      expect(queue.add).toHaveBeenCalledWith('run', jobData(), {
        jobId,
        removeOnComplete: true,
        removeOnFail: true,
      });
      expect(state).toEqual(
        expect.objectContaining({
          status: 'queued',
          pagesLoaded: 0,
          hasMore: true,
          pagesPerRun: 5,
        }),
      );
    });

    it('resets progress to page 1 before queueing a restart, but not a resume', async () => {
      withFilterSet(progress());

      await service.start(startInput, { restart: true });
      expect(searchService.saveSearchProgress).toHaveBeenCalledWith(
        'filter-1',
        {
          pagesLoaded: 0,
          nextPageToken: null,
          estimatedTotal: null,
          status: 'running',
          error: null,
        },
      );

      queue.jobs.clear();
      searchService.saveSearchProgress.mockClear();
      await service.start(startInput, { restart: false });
      expect(searchService.saveSearchProgress).not.toHaveBeenCalled();
      expect(queue.jobs.size).toBe(1);
    });

    it('is idempotent while a job is live, and un-pauses one asked to pause', async () => {
      withFilterSet(progress());
      const job = withJob('active', { control: 'pause' });

      const state = await service.start(startInput, { restart: false });

      expect(queue.add).not.toHaveBeenCalled();
      expect(job.data.control).toBeNull();
      expect(state.status).toBe('running');
    });

    it('keeps concurrent starts to one job', async () => {
      withFilterSet({});

      await Promise.all([
        service.start(startInput, { restart: true }),
        service.start(startInput, { restart: true }),
      ]);

      expect(queue.jobs.size).toBe(1);
    });

    it('does nothing when resuming a search with every page loaded', async () => {
      withFilterSet(progress({ nextPageToken: null, status: 'complete' }));

      const state = await service.start(startInput, { restart: false });

      expect(queue.add).not.toHaveBeenCalled();
      expect(state).toEqual(
        expect.objectContaining({ status: 'complete', hasMore: false }),
      );
    });

    it('refuses to start without saved filters', async () => {
      await expect(
        service.start(startInput, { restart: true }),
      ).rejects.toThrow('Save filters before running a search');
    });
  });

  describe('pause and stop', () => {
    it('asks a running job to pause after its page', async () => {
      withFilterSet(progress({ status: 'running' }));
      const job = withJob('active');

      const state = await service.pause('role-1');

      expect(job.data.control).toBe('pause');
      expect(state.status).toBe('pausing');
      expect(searchService.saveSearchProgress).not.toHaveBeenCalled();
    });

    it('asks a running job to stop before its next batch', async () => {
      withFilterSet(progress({ status: 'running' }));
      const job = withJob('active');

      expect((await service.stop('role-1')).status).toBe('stopping');
      expect(job.data.control).toBe('stop');
    });

    it('removes a job that has not started and records it as stopped', async () => {
      withFilterSet(progress());
      withJob('waiting');

      await service.stop('role-1');

      expect(queue.jobs.size).toBe(0);
      expect(searchService.saveSearchProgress).toHaveBeenCalledWith(
        'filter-1',
        { status: 'stopped' },
      );
    });

    it('does nothing without a live job', async () => {
      withFilterSet(progress());

      const state = await service.pause('role-1');

      expect(searchService.saveSearchProgress).not.toHaveBeenCalled();
      expect(state.status).toBe('paused');
    });
  });

  describe('status', () => {
    it('is idle before any search', async () => {
      expect(await service.status('role-1')).toEqual({
        status: 'idle',
        pagesLoaded: 0,
        hasMore: true,
        estimatedTotal: null,
        pagesPerRun: 5,
        error: null,
        updatedAt: null,
        live: null,
      });
    });

    it('reads how the last run ended from the filter set, so it survives a reload', async () => {
      withFilterSet(progress({ status: 'paused' }));
      expect((await service.status('role-1')).status).toBe('paused');

      withFilterSet(progress({ status: 'stopped' }));
      expect((await service.status('role-1')).status).toBe('stopped');

      withFilterSet(progress({ status: 'failed', error: 'Vertex timed out' }));
      expect(await service.status('role-1')).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Vertex timed out',
        }),
      );
    });

    it('treats a run saved as running with no job alive as stopped', async () => {
      withFilterSet(progress({ status: 'running' }));

      expect((await service.status('role-1')).status).toBe('stopped');
    });

    it('includes the live job progress while running', async () => {
      withFilterSet(progress({ status: 'running' }));
      const job = withJob('active');
      job.progress = { runPage: 1, page: 3, stage: 'scoring', savedIds: [] };

      expect((await service.status('role-1')).live).toEqual(job.progress);
    });

    it('reports the pages-per-run cap from the environment', async () => {
      process.env.ROLE_SEARCH_PAGES_PER_RUN = '8';
      expect((await service.status('role-1')).pagesPerRun).toBe(8);
      process.env.ROLE_SEARCH_PAGES_PER_RUN = 'lots';
      expect((await service.status('role-1')).pagesPerRun).toBe(5);
    });
  });
});
