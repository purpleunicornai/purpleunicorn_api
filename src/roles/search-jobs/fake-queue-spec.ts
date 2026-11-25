// Test helper (the -spec suffix keeps it out of the build; not a suite).
// An in-memory stand-in for the parts of a BullMQ Queue and Job the role
// search uses, so tests can drive job state without Redis.
import type { RoleSearchJobData } from './role-search-job';

export class FakeJob {
  progress: unknown = 0;
  constructor(
    readonly queue: FakeQueue,
    readonly id: string,
    public data: RoleSearchJobData,
    public state = 'waiting',
  ) {}

  getState = jest.fn(() => Promise.resolve(this.state));
  updateData = jest.fn((data: RoleSearchJobData) => {
    this.data = data;
    return Promise.resolve();
  });
  updateProgress = jest.fn((progress: unknown) => {
    this.progress = structuredClone(progress);
    return Promise.resolve();
  });
  remove = jest.fn(() => {
    this.queue.jobs.delete(this.id);
    return Promise.resolve();
  });
}

export class FakeQueue {
  jobs = new Map<string, FakeJob>();

  getJob = jest.fn((id: string) => Promise.resolve(this.jobs.get(id)));
  // Like BullMQ, an add with an id that already exists is ignored.
  add = jest.fn(
    (_name: string, data: RoleSearchJobData, opts: { jobId: string }) => {
      const job =
        this.jobs.get(opts.jobId) ?? new FakeJob(this, opts.jobId, data);
      this.jobs.set(opts.jobId, job);
      return Promise.resolve(job);
    },
  );
}
