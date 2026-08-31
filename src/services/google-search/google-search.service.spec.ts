import { GoogleSearchService } from './google-search.service';
import { RoleFilterDto } from '../../roles/dto/role_filter.dto';

function buildDto(overrides: Partial<RoleFilterDto> = {}): RoleFilterDto {
  return {
    title: 'Software Engineer',
    alternative_titles: [],
    title_levels: [],
    roles: [],
    current_role_min_yrs: 0,
    current_role_max_yrs: 0,
    current_role_tenure_yrs: 0,
    country_code: 'US',
    remote_work: false,
    work_authorization_required: false,
    filter_location_cities: [],
    experience_min_yrs: 0,
    experience_max_yrs: 0,
    required_skills: [],
    optional_skills: [],
    education_levels: [],
    education_universities: [],
    education_excluded_universities: [],
    education_graduation_min_yr: null,
    education_graduation_max_yr: null,
    required_languages: [],
    optional_languages: [],
    career_growth: [],
    security_clearance_required: [],
    diversity: [],
    other_experience: [],
    sites: [],
    filter_companies: [],
    metadata: { original_prompt: '', refined_prompt: '', complete: false },
    ...overrides,
  };
}

describe('GoogleSearchService', () => {
  let service: GoogleSearchService;

  beforeEach(() => {
    service = new GoogleSearchService({
      googleSearchApiKey: 'test-api-key',
      googleSearchEngineId: 'test-cx',
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildSiteFilter', () => {
    it('defaults to LinkedIn, Indeed, and the XRAY_SITES list when dto.sites is empty', () => {
      const dto = buildDto({ sites: [] });

      const filter = (service as any).buildSiteFilter(dto);

      expect(filter).toBe(
        '(site:linkedin.com/in OR site:indeed.com/r OR site:xing.com/profile OR ' +
          'site:stackoverflow.com/users OR site:researchgate.net OR site:about.me OR ' +
          'site:behance.net OR site:dribbble.com OR site:angel.co OR site:wellfound.com OR ' +
          'site:kaggle.com OR site:medium.com OR site:dev.to)',
      );
    });

    it('uses dto.sites instead of the defaults when provided', () => {
      const dto = buildDto({ sites: ['github.com', 'gitlab.com'] });

      const filter = (service as any).buildSiteFilter(dto);

      expect(filter).toBe('(site:github.com OR site:gitlab.com)');
    });

    it('does not wrap a single site in parentheses', () => {
      // Google's Custom Search API returns zero results for a
      // parenthesized single-term path-scoped site: filter, e.g.
      // "(site:linkedin.com/in)" — confirmed against the live API.
      const dto = buildDto({ sites: ['linkedin.com/in'] });

      const filter = (service as any).buildSiteFilter(dto);

      expect(filter).toBe('site:linkedin.com/in');
    });
  });

  describe('buildXrayQueries', () => {
    it('builds a primary query with the site filter, quoted title, required skills, and location', () => {
      const dto = buildDto({
        sites: ['linkedin.com'],
        title: 'Software Engineer',
        required_skills: ['TypeScript', 'AWS'],
        filter_location_cities: [
          {
            name: 'New York',
            state: 'NY',
            postcode: '',
            distance_unit: 'MILES',
            distance_value: 0,
          },
        ],
      });

      const queries = (service as any).buildXrayQueries(dto);

      expect(queries).toContain(
        'site:linkedin.com "Software Engineer" TypeScript AWS "New York"',
      );
    });

    it('OR-groups optional skills', () => {
      const dto = buildDto({
        sites: ['linkedin.com'],
        title: 'Software Engineer',
        optional_skills: ['GraphQL', 'Docker'],
      });

      const queries = (service as any).buildXrayQueries(dto);

      expect(queries).toContain(
        'site:linkedin.com "Software Engineer" (GraphQL OR Docker)',
      );
    });

    it('adds a query variant for up to three alternative titles', () => {
      const dto = buildDto({
        sites: ['linkedin.com'],
        title: 'Software Engineer',
        alternative_titles: [
          'Backend Engineer',
          'Platform Engineer',
          'Systems Engineer',
          'Infra Engineer',
        ],
      });

      const queries = (service as any).buildXrayQueries(dto);

      expect(queries).toContain('site:linkedin.com "Backend Engineer"');
      expect(queries).toContain('site:linkedin.com "Platform Engineer"');
      expect(queries).toContain('site:linkedin.com "Systems Engineer"');
      expect(queries).not.toContain('site:linkedin.com "Infra Engineer"');
    });

    it('drops queries that are empty beyond the site filter', () => {
      const dto = buildDto({ sites: ['linkedin.com'], title: '' });

      const queries = (service as any).buildXrayQueries(dto);

      expect(queries).toEqual([]);
    });
  });

  describe('search', () => {
    it('requests the Custom Search API for each built query with the api key, engine id, query, and first page', async () => {
      const get = jest
        .spyOn(service.client, 'get')
        .mockResolvedValue({ data: { items: [] } });

      await service.search(buildDto({ sites: ['linkedin.com/in'] }));

      expect(get).toHaveBeenCalledWith(
        'https://www.googleapis.com/customsearch/v1?key=test-api-key&cx=test-cx&q=site%3Alinkedin.com%2Fin+%22Software+Engineer%22&num=10&start=1',
      );
    });

    it('returns the combined items from every query', async () => {
      const items = [
        { title: 'Jane Doe', link: 'https://linkedin.com/in/janedoe' },
      ];
      jest.spyOn(service.client, 'get').mockResolvedValue({ data: { items } });

      const result = await service.search(
        buildDto({ sites: ['linkedin.com/in'] }),
      );

      expect(result).toEqual(items);
    });

    it('returns an empty array when the response has no items', async () => {
      jest.spyOn(service.client, 'get').mockResolvedValue({ data: {} });

      const result = await service.search(
        buildDto({ sites: ['linkedin.com/in'] }),
      );

      expect(result).toEqual([]);
    });

    it('pages through results up to the 100-result API cap, stopping once a page is short', async () => {
      const fullPage = Array.from({ length: 10 }, (_, i) => ({
        title: `Candidate ${i}`,
        link: `https://linkedin.com/in/candidate-${i}`,
      }));
      const lastPage = fullPage.slice(0, 4);
      const get = jest
        .spyOn(service.client, 'get')
        .mockResolvedValueOnce({ data: { items: fullPage } })
        .mockResolvedValueOnce({ data: { items: fullPage } })
        .mockResolvedValueOnce({ data: { items: lastPage } });

      const result = await service.search(
        buildDto({ sites: ['linkedin.com/in'] }),
      );

      expect(get).toHaveBeenCalledTimes(3);
      expect(get).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('start=1'),
      );
      expect(get).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('start=11'),
      );
      expect(get).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('start=21'),
      );
      expect(result).toHaveLength(24);
    });

    it('never requests past the 100-result API cap even if every page is full', async () => {
      const fullPage = Array.from({ length: 10 }, (_, i) => ({
        title: `Candidate ${i}`,
        link: `https://linkedin.com/in/candidate-${i}`,
      }));
      const get = jest
        .spyOn(service.client, 'get')
        .mockResolvedValue({ data: { items: fullPage } });

      const result = await service.search(
        buildDto({ sites: ['linkedin.com/in'] }),
      );

      expect(get).toHaveBeenCalledTimes(10);
      expect(get).toHaveBeenNthCalledWith(
        10,
        expect.stringContaining('start=91'),
      );
      expect(result).toHaveLength(100);
    });
  });
});
