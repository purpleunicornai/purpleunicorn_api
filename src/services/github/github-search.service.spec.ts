import { GithubSearchService } from './github-search.service';
import { ParsedRoleFilters } from '../../roles/search/role-filter-parser';

function buildFilters(
  overrides: Partial<ParsedRoleFilters> = {},
): ParsedRoleFilters {
  return {
    jobTitles: [],
    skills: [],
    languages: [],
    companies: [],
    education: [],
    ...overrides,
  };
}

describe('GithubSearchService', () => {
  let get: jest.Mock;
  let service: GithubSearchService;

  beforeEach(() => {
    get = jest.fn();
    service = new GithubSearchService({ githubToken: undefined });
    (service as any).client = { get };
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search', () => {
    it('returns an empty array without calling the API when there is no title or skill to search on', async () => {
      const result = await service.search(buildFilters());

      expect(get).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("queries GitHub's search/users endpoint with the role's main title", async () => {
      get.mockResolvedValue({ data: { items: [] } });

      await service.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Senior Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
        }),
      );

      expect(get).toHaveBeenCalledWith(
        'https://api.github.com/search/users',
        expect.objectContaining({
          params: expect.objectContaining({
            q: expect.stringContaining('"Senior Engineer"'),
          }),
        }),
      );
    });

    it('falls back to the first skill when there is no main-title row', async () => {
      get.mockResolvedValue({ data: { items: [] } });

      await service.search(
        buildFilters({
          skills: [
            { value: ['Rust'], priority: 'ESSENTIAL', nonNegotiable: false },
          ],
        }),
      );

      expect(get).toHaveBeenCalledWith(
        'https://api.github.com/search/users',
        expect.objectContaining({
          params: expect.objectContaining({
            q: expect.stringContaining('Rust'),
          }),
        }),
      );
    });

    it('does not repeat the same skill when it is used as the primary term', async () => {
      get.mockResolvedValue({ data: { items: [] } });

      await service.search(
        buildFilters({
          skills: [
            { value: ['Rust'], priority: 'ESSENTIAL', nonNegotiable: false },
          ],
        }),
      );

      const query = get.mock.calls[0][1].params.q as string;
      expect(query).toBe('Rust');
    });

    it('adds a location: qualifier from the first region, skipping it when remote work is set', async () => {
      get.mockResolvedValue({ data: { items: [] } });

      await service.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
          location: {
            value: {
              countryCode: 'GB',
              regions: [{ type: 'city', value: 'London' }],
              remoteWork: false,
              workAuthorizationRequired: false,
            },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        }),
      );

      expect(get).toHaveBeenCalledWith(
        'https://api.github.com/search/users',
        expect.objectContaining({
          params: expect.objectContaining({
            q: expect.stringContaining('location:"London"'),
          }),
        }),
      );
    });

    it('omits the location qualifier when remote work is true', async () => {
      get.mockResolvedValue({ data: { items: [] } });

      await service.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
          location: {
            value: {
              countryCode: 'GB',
              regions: [{ type: 'city', value: 'London' }],
              remoteWork: true,
              workAuthorizationRequired: false,
            },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        }),
      );

      const query = get.mock.calls[0][1].params.q as string;
      expect(query).not.toContain('location:');
    });

    it('sends an Authorization header when a github token is configured', async () => {
      get.mockResolvedValue({ data: { items: [] } });
      service = new GithubSearchService({ githubToken: 'test-token' });
      (service as any).client = { get };

      await service.search(
        buildFilters({
          skills: [
            { value: ['Rust'], priority: 'ESSENTIAL', nonNegotiable: false },
          ],
        }),
      );

      expect(get).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'token test-token',
          }),
        }),
      );
    });

    it('omits the Authorization header when no token is configured', async () => {
      get.mockResolvedValue({ data: { items: [] } });

      await service.search(
        buildFilters({
          skills: [
            { value: ['Rust'], priority: 'ESSENTIAL', nonNegotiable: false },
          ],
        }),
      );

      const headers = get.mock.calls[0][1].headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it('maps each GitHub user into a GoogleSearchItem shape, carrying the avatar through pagemap', async () => {
      get.mockResolvedValue({
        data: {
          items: [
            {
              id: 1,
              login: 'janedoe',
              bio: 'Backend engineer',
              html_url: 'https://github.com/janedoe',
              avatar_url: 'https://avatars.githubusercontent.com/u/1',
            },
          ],
        },
      });

      const result = await service.search(
        buildFilters({
          skills: [
            { value: ['Rust'], priority: 'ESSENTIAL', nonNegotiable: false },
          ],
        }),
      );

      expect(result).toEqual([
        {
          title: 'janedoe - GitHub',
          link: 'https://github.com/janedoe',
          snippet: 'Backend engineer',
          pagemap: {
            metatags: [
              { 'og:image': 'https://avatars.githubusercontent.com/u/1' },
            ],
          },
        },
      ]);
    });

    it('maps a user with no bio or avatar without crashing', async () => {
      get.mockResolvedValue({
        data: {
          items: [
            {
              id: 2,
              login: 'nouser',
              html_url: 'https://github.com/nouser',
            },
          ],
        },
      });

      const result = await service.search(
        buildFilters({
          skills: [
            { value: ['Rust'], priority: 'ESSENTIAL', nonNegotiable: false },
          ],
        }),
      );

      expect(result).toEqual([
        {
          title: 'nouser - GitHub',
          link: 'https://github.com/nouser',
          snippet: undefined,
        },
      ]);
    });

    it('never throws — returns an empty array when the request fails (rate limit, network error, etc.)', async () => {
      get.mockRejectedValue(new Error('403 rate limited'));

      const result = await service.search(
        buildFilters({
          skills: [
            { value: ['Rust'], priority: 'ESSENTIAL', nonNegotiable: false },
          ],
        }),
      );

      expect(result).toEqual([]);
    });
  });
});
