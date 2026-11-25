import {
  filterTerms,
  toSearchRuns,
  type HistoryFilterSet,
} from './search-history';

const item = (
  category: string,
  list_value: string[],
  extra: Partial<HistoryFilterSet['role_filter_items'][number]> = {},
) => ({ category, value: null, list_value, children: [], ...extra });

const set = (
  uid: string,
  ranAt: string | null,
  items: HistoryFilterSet['role_filter_items'],
  extra: Partial<HistoryFilterSet> = {},
): HistoryFilterSet => ({
  uid,
  role_id: 'role-1',
  archived: true,
  search_run_date: ranAt ? new Date(ranAt) : null,
  search_run_by: 'Kyle Winter',
  search_run_by_id: 'user-1',
  metadata: null,
  role: {
    name: 'Senior Finance Manager',
    project_id: 'p1',
    project: { name: 'Cape Town finance' },
  },
  role_filter_items: items,
  ...extra,
});

describe('filterTerms', () => {
  it('reads companies, experience and location the way recruiters say them', () => {
    expect(
      filterTerms(
        item('companies', ['PwC'], {
          children: [
            {
              title: 'company_type',
              value: 'exclude',
              list_value: [],
              boolean: null,
            },
          ],
        }),
      ),
    ).toEqual(['Exclude PwC']);
    expect(filterTerms(item('experience', [], { value: '6' }))).toEqual([
      '6+ years experience',
    ]);
    expect(
      filterTerms(
        item('location', [], {
          value: 'ZA',
          children: [
            {
              title: 'region',
              value: 'Cape Town',
              list_value: [],
              boolean: null,
            },
            {
              title: 'work_types',
              value: null,
              list_value: ['ONSITE', 'HYBRID'],
              boolean: null,
            },
          ],
        }),
      ),
    ).toEqual(['Cape Town, South Africa', 'On-site, Hybrid']);
  });
});

describe('toSearchRuns', () => {
  const older = set('f1', '2026-11-22T09:18:00Z', [
    item('job_titles', ['CFO']),
    item('skills', ['IFRS']),
  ]);
  const newer = set(
    'f2',
    '2026-11-23T14:32:00Z',
    [item('job_titles', ['CFO']), item('skills', ['Treasury'])],
    {
      archived: false,
      metadata: {
        searchProgress: {
          version: 1,
          pagesLoaded: 4,
          nextPageToken: null,
          broadFrom: null,
          estimatedTotal: 120,
          status: 'complete',
          error: null,
          updatedAt: '2026-11-23T14:40:00Z',
        },
      },
    },
  );
  const never = set('f0', null, [item('job_titles', ['CFO'])]);

  it('lists searched sets newest first with the diff, counts and new candidates vs the previous run', () => {
    const runs = toSearchRuns(
      [older, never, newer],
      [
        { filter_id: 'f1', candidate_uid: 'a', score: 80 },
        { filter_id: 'f2', candidate_uid: 'a', score: 82 },
        { filter_id: 'f2', candidate_uid: 'b', score: 94 },
      ],
    );

    expect(runs.map((r) => r.id)).toEqual(['f2', 'f1']);
    expect(runs[0]).toEqual(
      expect.objectContaining({
        current: true,
        status: 'complete',
        pagesLoaded: 4,
        candidates: 2,
        topScore: 94,
        newCandidates: 1,
        searchesUsed: 1,
        added: ['Treasury'],
        removed: ['IFRS'],
        brief: 'CFO, Treasury',
      }),
    );
    // The first run has nothing to compare with.
    expect(runs[1]).toEqual(
      expect.objectContaining({ added: [], removed: [], newCandidates: 1 }),
    );
  });

  it("doesn't count a failed run as a search", () => {
    const failed = set('f3', '2026-11-21T11:06:00Z', [], {
      metadata: {
        searchProgress: {
          ...(newer.metadata as any).searchProgress,
          status: 'failed',
          error: 'boom',
        },
      },
    });
    expect(toSearchRuns([failed], [])[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: 'boom',
        searchesUsed: 0,
        topScore: null,
      }),
    );
  });
});
