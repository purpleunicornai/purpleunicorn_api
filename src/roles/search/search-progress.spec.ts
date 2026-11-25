import {
  mergeSearchProgress,
  parseSearchProgress,
  PublicSearchProgress,
  publicFilterMetadata,
  SearchProgress,
  withSearchProgress,
} from './search-progress';

const progress: SearchProgress = {
  version: 1,
  pagesLoaded: 3,
  nextPageToken: 's1.abc',
  broadFrom: null,
  estimatedTotal: 1240,
  status: 'paused',
  error: null,
  updatedAt: '2026-11-17T10:00:00.000Z',
};

describe('search progress', () => {
  it('reads stored progress and ignores anything malformed', () => {
    expect(parseSearchProgress({ searchProgress: progress })).toEqual(progress);
    expect(parseSearchProgress(null)).toBeNull();
    expect(parseSearchProgress({ searchProgress: { version: 2 } })).toBeNull();
    expect(
      parseSearchProgress({
        searchProgress: { ...progress, nextPageToken: 42 },
      }),
    ).toBeNull();
  });

  it('gives progress saved before runs had a status the status its pages imply', () => {
    const legacy = { ...progress, status: undefined, error: undefined };
    expect(parseSearchProgress({ searchProgress: legacy })?.status).toBe(
      'stopped',
    );
    expect(
      parseSearchProgress({
        searchProgress: { ...legacy, nextPageToken: null },
      })?.status,
    ).toBe('complete');
  });

  it('starts fresh progress at page 0 and patches existing progress in place', () => {
    const now = new Date('2026-11-17T12:00:00.000Z');
    expect(mergeSearchProgress(null, { status: 'running' }, now)).toEqual({
      version: 1,
      pagesLoaded: 0,
      nextPageToken: null,
      broadFrom: null,
      estimatedTotal: null,
      status: 'running',
      error: null,
      updatedAt: now.toISOString(),
    });
    expect(mergeSearchProgress(progress, { status: 'stopped' }, now)).toEqual({
      ...progress,
      status: 'stopped',
      updatedAt: now.toISOString(),
    });
  });

  it('stores progress alongside the rest of the metadata', () => {
    expect(
      withSearchProgress({ criterionExpansions: { version: 1 } }, progress),
    ).toEqual({
      criterionExpansions: { version: 1 },
      searchProgress: progress,
    });
  });

  it('never exposes the resume token, only whether more pages exist', () => {
    expect(
      publicFilterMetadata({
        criterionExpansions: { version: 1 },
        searchProgress: progress,
      }),
    ).toEqual({
      criterionExpansions: { version: 1 },
      searchProgress: {
        pagesLoaded: 3,
        hasMore: true,
        estimatedTotal: 1240,
        status: 'paused',
        error: null,
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
    });
    const hasMore = (stored: Partial<SearchProgress>) =>
      (
        publicFilterMetadata({ searchProgress: { ...progress, ...stored } })
          .searchProgress as PublicSearchProgress
      ).hasMore;
    expect(hasMore({ nextPageToken: null })).toBe(false);
    // Nothing loaded yet still has pages to load.
    expect(hasMore({ pagesLoaded: 0, nextPageToken: null })).toBe(true);
    // Look deeper's broader query has pages until its own first page says not.
    expect(hasMore({ pagesLoaded: 5, broadFrom: 5, nextPageToken: null })).toBe(
      true,
    );
    expect(hasMore({ pagesLoaded: 6, broadFrom: 5, nextPageToken: null })).toBe(
      false,
    );
    expect(publicFilterMetadata({ searchProgress: 'junk' })).toEqual({});
  });
});
