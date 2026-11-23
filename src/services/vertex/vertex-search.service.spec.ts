import { VertexSearchService } from './vertex-search.service';
import { VertexService } from './vertex.service';
import { extractCandidate } from '../../roles/search/extract-candidate';
import { ParsedRoleFilters } from '../../roles/search/role-filter-parser';
import { parseSearchPageToken } from '../../roles/search/search-page-token';

jest.mock('../../roles/search/extract-candidate', () => ({
  extractCandidate: jest.fn(),
}));

const extract = extractCandidate as jest.MockedFunction<
  typeof extractCandidate
>;

type FakeVertexResult = {
  document?: {
    derivedStructData?: { fields?: { link?: { stringValue?: string } } };
  };
};

function keyOf(raw: unknown): string | undefined {
  const result = raw as FakeVertexResult;
  return result.document?.derivedStructData?.fields?.link?.stringValue;
}

function profile(key: string, location?: string) {
  return {
    name: key,
    key,
    linkedinUrl: `https://www.linkedin.com/in/${key}`,
    location,
    candidate: { first_name: key },
  };
}

function result(key: string) {
  return {
    document: { derivedStructData: { fields: { link: { stringValue: key } } } },
  };
}

function essentialLocation(
  city: string,
  remoteWork = false,
): ParsedRoleFilters {
  return {
    jobTitles: [],
    skills: [],
    languages: [],
    companies: [],
    education: [],
    location: {
      priority: 'ESSENTIAL',
      nonNegotiable: false,
      value: {
        countryCode: 'ZA',
        regions: [{ type: 'city', value: city }],
        remoteWork,
        workAuthorizationRequired: false,
      },
    },
  };
}

describe('VertexSearchService', () => {
  let vertexService: { search: jest.Mock };
  let service: VertexSearchService;

  beforeEach(() => {
    vertexService = { search: jest.fn() };
    service = new VertexSearchService(
      vertexService as unknown as VertexService,
    );
    extract.mockReset();
    extract.mockImplementation((raw) => {
      const key = keyOf(raw);
      return key ? profile(key) : null;
    });
  });

  it('walks Vertex pages until the cap or the stream is exhausted', async () => {
    vertexService.search
      .mockResolvedValueOnce({
        results: [result('a'), result('b')],
        nextPageToken: 'tok-2',
        totalSize: 40,
      })
      .mockResolvedValueOnce({
        results: [result('c')],
        nextPageToken: undefined,
        totalSize: 40,
      });

    const items = await service.search({
      jobTitles: [],
      skills: [],
      languages: [],
      companies: [],
      education: [],
    });

    expect(items.map((item) => item.link)).toEqual([
      'https://www.linkedin.com/in/a',
      'https://www.linkedin.com/in/b',
      'https://www.linkedin.com/in/c',
    ]);
    expect(items.map((item) => item.page)).toEqual([1, 1, 2]);
    expect(vertexService.search).toHaveBeenCalledTimes(2);
  });

  it('drops a later-page duplicate when the previous page token is passed back', async () => {
    vertexService.search.mockResolvedValueOnce({
      results: [result('a'), result('b')],
      nextPageToken: 'tok-2',
    });
    const first = await service.searchPage(
      { kind: 'single', query: 'q' },
      {
        jobTitles: [],
        skills: [],
        languages: [],
        companies: [],
        education: [],
      },
      10,
    );
    vertexService.search.mockResolvedValueOnce({
      results: [result('a'), result('c')],
    });
    const second = await service.searchPage(
      { kind: 'single', query: 'q' },
      {
        jobTitles: [],
        skills: [],
        languages: [],
        companies: [],
        education: [],
      },
      10,
      parseSearchPageToken(first.nextPageToken),
    );

    expect(second.items.map((item) => item.extracted?.key)).toEqual(['c']);
    expect(second.skippedDuplicates).toBe(1);
    expect(second.page).toBe(2);
  });

  it('runs location and remote queries in parallel and stamps matchedBy', async () => {
    vertexService.search.mockImplementation((query: string) => {
      if (query.includes('"Cape Town"')) {
        return { results: [result('local-1')], nextPageToken: 'L2' };
      }
      return {
        results: [result('remote-1'), result('local-1')],
        nextPageToken: 'R2',
      };
    });

    const page = await service.searchPage(
      {
        kind: 'split',
        locationQuery: 'site:linkedin.com/in ("Cape Town")',
        remoteQuery: 'site:linkedin.com/in ("remote")',
      },
      essentialLocation('Cape Town', true),
      10,
    );

    expect(page.items.map((item) => item.extracted?.key)).toEqual([
      'local-1',
      'remote-1',
    ]);
    expect(page.items.map((item) => item.matchedBy)).toEqual([
      'location',
      'remote',
    ]);
    expect(vertexService.search).toHaveBeenCalledTimes(2);
  });

  it('drops a clearly different country before returning the page', async () => {
    extract.mockImplementation((raw) => {
      const key = keyOf(raw);
      if (key === 'ny') return profile(key, 'New York, United States');
      return key ? profile(key, 'Cape Town, South Africa') : null;
    });
    vertexService.search.mockResolvedValue({
      results: [result('ct'), result('ny')],
    });

    const page = await service.searchPage(
      { kind: 'single', query: 'q' },
      essentialLocation('Cape Town'),
      10,
    );

    expect(page.items.map((item) => item.extracted?.key)).toEqual(['ct']);
    expect(page.filteredOutByLocation).toBe(1);
  });

  it('reports Vertex estimate, summed across a split search', async () => {
    vertexService.search.mockImplementation((query: string) =>
      query.includes('"Cape Town"')
        ? { results: [result('local-1')], nextPageToken: 'L2', totalSize: 900 }
        : { results: [result('remote-1')], totalSize: 340 },
    );

    const page = await service.searchPage(
      {
        kind: 'split',
        locationQuery: 'site:linkedin.com/in ("Cape Town")',
        remoteQuery: 'site:linkedin.com/in ("remote")',
      },
      essentialLocation('Cape Town', true),
      10,
    );

    expect(page.estimatedTotal).toBe(1240);
  });

  it('pages through the role search one page at a time and ends without a token', async () => {
    const filters = {
      jobTitles: [],
      skills: [],
      languages: [],
      companies: [],
      education: [],
    };
    vertexService.search.mockResolvedValueOnce({
      results: [result('a')],
      nextPageToken: 'tok-2',
      totalSize: 41,
    });
    const first = await service.searchRolePage(filters, 'Analyst', null);
    vertexService.search.mockResolvedValueOnce({ results: [result('b')] });
    const second = await service.searchRolePage(
      filters,
      'Analyst',
      null,
      parseSearchPageToken(first.nextPageToken),
    );

    expect(first).toEqual(
      expect.objectContaining({ page: 1, estimatedTotal: 41 }),
    );
    expect(vertexService.search).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      20,
      'tok-2',
    );
    expect(second.page).toBe(2);
    expect(second.items.map((item) => item.page)).toEqual([2]);
    expect(second.nextPageToken).toBeUndefined();
  });
});
