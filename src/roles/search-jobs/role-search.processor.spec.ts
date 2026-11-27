import { LogsService } from '../../common/logs/logs.service';
import {
  SearchPageHooks,
  SearchPageOutcome,
  SearchService,
} from '../search/search.service';
import { FakeJob, FakeQueue } from './fake-queue-spec';
import { RoleSearchJobData, roleSearchJobId } from './role-search-job';
import { RoleSearchProcessor } from './role-search.processor';

const jobId = roleSearchJobId('filter-1');
const data = (patch: Partial<RoleSearchJobData> = {}): RoleSearchJobData => ({
  orgId: 'org-1',
  roleId: 'role-1',
  filterId: 'filter-1',
  userId: 'user-1',
  userName: 'Jane Admin',
  roleName: 'Senior Finance Manager',
  control: null,
  ...patch,
});
const page = (
  n: number,
  hasMore = true,
): Extract<SearchPageOutcome, { kind: 'done' }> => ({
  kind: 'done',
  page: n,
  hasMore,
  estimatedTotal: 1240,
  saved: 20,
  tokensUsed: 300,
});

describe('RoleSearchProcessor', () => {
  let queue: FakeQueue;
  let job: FakeJob;
  let searchService: {
    runSearchPage: jest.Mock<
      Promise<SearchPageOutcome>,
      [string, string, string, string, string | undefined, SearchPageHooks?]
    >;
    saveSearchProgress: jest.Mock;
  };
  let logsService: { log: jest.Mock };
  let processor: RoleSearchProcessor;
  const statuses = () =>
    searchService.saveSearchProgress.mock.calls.map(
      ([, patch]) => (patch as { status: string }).status,
    );
  const process = () => processor.process(job as never);

  beforeEach(() => {
    delete globalThis.process.env.ROLE_SEARCH_PAGES_PER_RUN;
    queue = new FakeQueue();
    job = new FakeJob(queue, jobId, data(), 'active');
    queue.jobs.set(jobId, job);
    searchService = {
      runSearchPage: jest.fn<
        Promise<SearchPageOutcome>,
        [string, string, string, string, string | undefined, SearchPageHooks?]
      >(),
      saveSearchProgress: jest.fn().mockResolvedValue({ estimatedTotal: 1240 }),
    };
    logsService = { log: jest.fn().mockResolvedValue(undefined) };
    processor = new RoleSearchProcessor(
      queue as never,
      searchService as unknown as SearchService,
      logsService as unknown as LogsService,
    );
  });

  it('loads pages until there are no more, then records the run complete', async () => {
    searchService.runSearchPage
      .mockResolvedValueOnce(page(1))
      .mockResolvedValueOnce(page(2, false));

    await process();

    expect(searchService.runSearchPage).toHaveBeenCalledTimes(2);
    expect(searchService.runSearchPage).toHaveBeenCalledWith(
      'role-1',
      'filter-1',
      'user-1',
      'Jane Admin',
      'Senior Finance Manager',
      expect.any(Object),
    );
    expect(statuses()).toEqual(['running', 'complete']);
    expect(logsService.log).toHaveBeenCalledTimes(2);
    expect(logsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        type: 'ROLE_SEARCH',
        tokens_used: 300,
      }),
    );
  });

  it('pauses itself after the pages-per-run cap', async () => {
    searchService.runSearchPage.mockImplementation(() =>
      Promise.resolve(page(1)),
    );

    await process();

    expect(searchService.runSearchPage).toHaveBeenCalledTimes(5);
    expect(statuses()).toEqual(['running', 'paused']);
  });

  it('takes the cap from ROLE_SEARCH_PAGES_PER_RUN', async () => {
    globalThis.process.env.ROLE_SEARCH_PAGES_PER_RUN = '2';
    searchService.runSearchPage.mockResolvedValue(page(1));

    await process();

    expect(searchService.runSearchPage).toHaveBeenCalledTimes(2);
  });

  it('finishes the page in hand when asked to pause, then records it paused', async () => {
    searchService.runSearchPage.mockImplementation(() => {
      job.data = { ...job.data, control: 'pause' };
      return Promise.resolve(page(1));
    });

    await process();

    expect(searchService.runSearchPage).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(['running', 'paused']);
  });

  it('passes a stop request to the page and records the run stopped', async () => {
    searchService.runSearchPage.mockImplementation(
      async (_r, _f, _u, _n, _name, hooks) => {
        expect(await hooks?.shouldStop?.()).toBe(false);
        job.data = { ...job.data, control: 'stop' };
        expect(await hooks?.shouldStop?.()).toBe(true);
        return { kind: 'stopped' };
      },
    );

    await process();

    expect(statuses()).toEqual(['running', 'stopped']);
    expect(logsService.log).not.toHaveBeenCalled();
  });

  it('reports each stage as live job progress', async () => {
    searchService.runSearchPage.mockImplementation(
      async (_r, _f, _u, _n, _name, hooks) => {
        await hooks?.onStage?.({
          stage: 'searching',
          status: 'done',
          page: 3,
          found: 20,
          estimatedTotal: 1300,
          skippedDuplicates: 2,
        });
        await hooks?.onStage?.({
          stage: 'scoring',
          status: 'progress',
          page: 3,
          completed: 10,
          total: 20,
          savedIds: ['result-1'],
        });
        return page(3, false);
      },
    );

    await process();

    expect(job.progress).toEqual({
      runPage: 1,
      page: 3,
      stage: 'scoring',
      completed: 10,
      total: 20,
      estimatedTotal: 1300,
      skippedDuplicates: 2,
      savedIds: ['result-1'],
    });
  });

  it('records a failure with its message', async () => {
    searchService.runSearchPage.mockRejectedValue(new Error('Vertex down'));

    await process();

    expect(searchService.saveSearchProgress).toHaveBeenLastCalledWith(
      'filter-1',
      { status: 'failed', error: 'Vertex down' },
    );
  });

  it('leaves a replaced filter set alone', async () => {
    searchService.runSearchPage.mockResolvedValue({ kind: 'superseded' });

    await process();

    expect(statuses()).toEqual(['running']);
  });

  describe('runInline (Vercel)', () => {
    const failedMessage = expect.stringContaining('timed out') as string;

    it('runs the pages in the request with no job, and records how it ended', async () => {
      searchService.runSearchPage
        .mockResolvedValueOnce(page(1))
        .mockResolvedValueOnce(page(2, false));

      await processor.runInline(data());

      expect(searchService.runSearchPage).toHaveBeenCalledTimes(2);
      expect(statuses()).toEqual(['running', 'complete']);
      expect(queue.getJob).not.toHaveBeenCalled();
      expect(job.updateProgress).not.toHaveBeenCalled();
    });

    it('records a failure with its message', async () => {
      searchService.runSearchPage.mockRejectedValue(new Error('Vertex down'));

      await processor.runInline(data());

      expect(searchService.saveSearchProgress).toHaveBeenLastCalledWith(
        'filter-1',
        { status: 'failed', error: 'Vertex down' },
      );
    });

    it('marks the search failed with a clear message when it runs out of time, even if a page is stuck', async () => {
      searchService.runSearchPage.mockReturnValue(new Promise(() => undefined));

      await processor.runInline(data(), 20);

      expect(statuses()).toEqual(['running', 'failed']);
      expect(searchService.saveSearchProgress).toHaveBeenLastCalledWith(
        'filter-1',
        { status: 'failed', error: failedMessage },
      );
    });

    it('cuts a page that is still going off at its next checkpoint, and does not overwrite the failure', async () => {
      let release: (outcome: SearchPageOutcome) => void = () => undefined;
      let stopAsked: boolean | undefined;
      searchService.runSearchPage.mockImplementation(
        (_r, _f, _u, _n, _name, hooks) =>
          new Promise((resolve) => {
            release = (outcome) =>
              void hooks?.shouldStop?.().then((stop) => {
                stopAsked = stop;
                resolve(outcome);
              });
          }),
      );

      await processor.runInline(data(), 20);
      release({ kind: 'stopped' });
      await new Promise((resolve) => setImmediate(resolve));

      expect(stopAsked).toBe(true);
      expect(statuses()).toEqual(['running', 'failed']);
    });

    it('does not start another page once out of time', async () => {
      searchService.runSearchPage.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return page(1);
      });

      await processor.runInline(data(), 10);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(searchService.runSearchPage).toHaveBeenCalledTimes(1);
      expect(statuses()).toEqual(['running', 'failed']);
    });
  });
});
