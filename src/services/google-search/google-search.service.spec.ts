import { GoogleSearchService } from './google-search.service';
import { ParsedRoleFilters } from '../../roles/search/role-filter-parser';
import { candidate, candidate_experience } from '../../generated/prisma/client';

type CandidateWithExperience = candidate & {
  experience: candidate_experience[];
};

function buildExperience(
  overrides: Partial<candidate_experience> = {},
): candidate_experience {
  return {
    uid: 'experience-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    candidate_id: 'candidate-1',
    company_name: 'Alpha Inc',
    company_location: null,
    role: 'Engineer',
    start_date: new Date('2020-01-01T00:00:00.000Z'),
    end_date: null,
    responsibilities: null,
    skills: [],
    ...overrides,
  };
}

function buildCandidate(
  overrides: Partial<CandidateWithExperience> = {},
): CandidateWithExperience {
  return {
    uid: 'candidate-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    first_name: 'Jane',
    last_name: 'Doe',
    email: null,
    phone: null,
    country_calling_code: null,
    contact_info_last_updated: null,
    rocketreach_profile_id: null,
    current_location_city: null,
    current_location_country_code: null,
    current_location_postal_code: null,
    open_to_relocation: null,
    open_to_remote_work: null,
    current_work_authorization_status: null,
    experience_years: null,
    experience_roles: [],
    current_title: null,
    current_company: null,
    current_salary: null,
    current_salary_currency: null,
    current_role_start_date: null,
    skills: [],
    languages: [],
    diversity: [],
    summary: null,
    image_url: null,
    enriched_at: null,
    experience: [],
    ...overrides,
  };
}

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
    it('defaults to LinkedIn, Indeed, and the XRAY_SITES list', () => {
      const filter = (service as any).buildSiteFilter();

      expect(filter).toBe(
        '(site:linkedin.com/in OR site:indeed.com/r OR site:xing.com/profile OR ' +
          'site:stackoverflow.com/users OR site:researchgate.net OR site:about.me OR ' +
          'site:behance.net OR site:dribbble.com OR site:angel.co OR site:wellfound.com OR ' +
          'site:kaggle.com OR site:medium.com OR site:dev.to)',
      );
    });
  });

  describe('buildXrayQueries', () => {
    it('builds a query from the main job title, essential skills, and location region', () => {
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: ['Software Engineer'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
            filterId: 'f1',
          },
        ],
        skills: [
          {
            value: ['TypeScript', 'AWS'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
            filterId: 'f2',
          },
        ],
        location: {
          value: {
            countryCode: 'US',
            regions: [{ type: 'city', value: 'New York' }],
            remoteWork: false,
            workAuthorizationRequired: false,
          },
          priority: 'ESSENTIAL',
          nonNegotiable: false,
          filterId: 'f3',
        },
      });

      const queries = (service as any).buildXrayQueries(filters);

      expect(queries).toContain(
        '(site:linkedin.com/in OR site:indeed.com/r OR site:xing.com/profile OR ' +
          'site:stackoverflow.com/users OR site:researchgate.net OR site:about.me OR ' +
          'site:behance.net OR site:dribbble.com OR site:angel.co OR site:wellfound.com OR ' +
          'site:kaggle.com OR site:medium.com OR site:dev.to) "Software Engineer" TypeScript AWS "New York"',
      );
    });

    it('OR-groups optional skills', () => {
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: ['Software Engineer'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
            filterId: 'f1',
          },
        ],
        skills: [
          {
            value: ['GraphQL', 'Docker'],
            priority: 'OPTIONAL',
            nonNegotiable: false,
            filterId: 'f2',
          },
        ],
      });

      const queries = (service as any).buildXrayQueries(filters);

      expect(
        queries.some((query: string) => query.includes('(GraphQL OR Docker)')),
      ).toBe(true);
    });

    it('adds a query variant for up to three alternative titles', () => {
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: ['Software Engineer'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
            filterId: 'f1',
          },
          {
            value: {
              titles: [
                'Backend Engineer',
                'Platform Engineer',
                'Systems Engineer',
                'Infra Engineer',
              ],
              option: 'alternative_title',
            },
            priority: 'OPTIONAL',
            nonNegotiable: false,
            filterId: 'f2',
          },
        ],
      });

      const queries = (service as any).buildXrayQueries(filters);

      expect(
        queries.some((q: string) => q.includes('"Backend Engineer"')),
      ).toBe(true);
      expect(
        queries.some((q: string) => q.includes('"Platform Engineer"')),
      ).toBe(true);
      expect(
        queries.some((q: string) => q.includes('"Systems Engineer"')),
      ).toBe(true);
      expect(queries.some((q: string) => q.includes('"Infra Engineer"'))).toBe(
        false,
      );
    });

    it('includes required company names in the query', () => {
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: ['Software Engineer'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
            filterId: 'f1',
          },
        ],
        companies: [
          {
            value: { names: ['Google', 'Microsoft'], type: 'include' },
            priority: 'OPTIONAL',
            nonNegotiable: false,
            filterId: 'f2',
          },
        ],
      });

      const queries = (service as any).buildXrayQueries(filters);

      expect(
        queries.some((q: string) => q.includes('(Google OR Microsoft)')),
      ).toBe(true);
    });

    it('returns no queries when there is no main job title', () => {
      const filters = buildFilters();

      const queries = (service as any).buildXrayQueries(filters);

      expect(queries).toEqual([]);
    });
  });

  describe('buildCandidateQueries', () => {
    it('returns no queries when the candidate has no name', () => {
      const candidate = buildCandidate({ first_name: null, last_name: null });

      const queries = (service as any).buildCandidateQueries(candidate);

      expect(queries).toEqual([]);
    });

    it('builds a query combining the quoted full name with the current company', () => {
      const candidate = buildCandidate({
        first_name: 'Jane',
        last_name: 'Doe',
        current_company: 'TechCorp',
      });

      const queries = (service as any).buildCandidateQueries(candidate);

      expect(queries).toContain(
        '(site:linkedin.com/in OR site:indeed.com/r OR site:xing.com/profile OR ' +
          'site:stackoverflow.com/users OR site:researchgate.net OR site:about.me OR ' +
          'site:behance.net OR site:dribbble.com OR site:angel.co OR site:wellfound.com OR ' +
          'site:kaggle.com OR site:medium.com OR site:dev.to) "Jane Doe" TechCorp',
      );
    });

    it('falls back to a name-only query when there is no company on file', () => {
      const candidate = buildCandidate({
        first_name: 'Jane',
        last_name: 'Doe',
        current_company: null,
        experience: [],
      });

      const queries = (service as any).buildCandidateQueries(candidate);

      expect(queries).toEqual([
        '(site:linkedin.com/in OR site:indeed.com/r OR site:xing.com/profile OR ' +
          'site:stackoverflow.com/users OR site:researchgate.net OR site:about.me OR ' +
          'site:behance.net OR site:dribbble.com OR site:angel.co OR site:wellfound.com OR ' +
          'site:kaggle.com OR site:medium.com OR site:dev.to) "Jane Doe"',
      ]);
    });

    it('adds a query variant for up to three companies drawn from experience history', () => {
      const candidate = buildCandidate({
        first_name: 'Jane',
        last_name: 'Doe',
        current_company: null,
        experience: [
          buildExperience({ company_name: 'Alpha Inc' }),
          buildExperience({ company_name: 'Beta LLC' }),
          buildExperience({ company_name: 'Gamma Co' }),
          buildExperience({ company_name: 'Delta Ltd' }),
        ],
      });

      const queries = (service as any).buildCandidateQueries(candidate);

      expect(
        queries.some((query: string) =>
          query.endsWith('"Jane Doe" "Alpha Inc"'),
        ),
      ).toBe(true);
      expect(
        queries.some((query: string) =>
          query.endsWith('"Jane Doe" "Beta LLC"'),
        ),
      ).toBe(true);
      expect(
        queries.some((query: string) =>
          query.endsWith('"Jane Doe" "Gamma Co"'),
        ),
      ).toBe(true);
      expect(
        queries.some((query: string) =>
          query.endsWith('"Jane Doe" "Delta Ltd"'),
        ),
      ).toBe(false);
    });

    it('dedupes repeated employers among the experience-derived variants', () => {
      const candidate = buildCandidate({
        first_name: 'Jane',
        last_name: 'Doe',
        current_company: null,
        experience: [
          buildExperience({ company_name: 'Alpha Inc' }),
          buildExperience({ company_name: 'Alpha Inc' }),
        ],
      });

      const queries = (service as any).buildCandidateQueries(candidate);

      expect(
        queries.filter((query: string) => query.includes('Alpha Inc')),
      ).toHaveLength(1);
    });
  });

  describe('search', () => {
    it('requests the Custom Search API for each built query with the api key, engine id, query, and first page', async () => {
      const get = jest
        .spyOn(service.client, 'get')
        .mockResolvedValue({ data: { items: [] } });

      await service.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Software Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
              filterId: 'f1',
            },
          ],
        }),
      );

      // Built via URLSearchParams (not encodeURIComponent) to match the
      // form-urlencoded escaping the real request URL uses — notably,
      // parentheses are escaped to %28/%29 under this scheme, unlike
      // encodeURIComponent, which leaves them unescaped.
      const expectedQuery = new URLSearchParams({
        q: '(site:linkedin.com/in OR site:indeed.com/r OR site:xing.com/profile OR site:stackoverflow.com/users OR site:researchgate.net OR site:about.me OR site:behance.net OR site:dribbble.com OR site:angel.co OR site:wellfound.com OR site:kaggle.com OR site:medium.com OR site:dev.to) "Software Engineer"',
      }).toString();

      expect(get).toHaveBeenCalledWith(expect.stringContaining(expectedQuery));
    });

    it('returns the combined items from every query', async () => {
      const items = [
        { title: 'Jane Doe', link: 'https://linkedin.com/in/janedoe' },
      ];
      jest.spyOn(service.client, 'get').mockResolvedValue({ data: { items } });

      const result = await service.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Software Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
              filterId: 'f1',
            },
          ],
        }),
      );

      expect(result).toEqual(items);
    });

    it('returns an empty array when the response has no items', async () => {
      jest.spyOn(service.client, 'get').mockResolvedValue({ data: {} });

      const result = await service.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Software Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
              filterId: 'f1',
            },
          ],
        }),
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
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Software Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
              filterId: 'f1',
            },
          ],
        }),
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
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Software Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
              filterId: 'f1',
            },
          ],
        }),
      );

      expect(get).toHaveBeenCalledTimes(10);
      expect(get).toHaveBeenNthCalledWith(
        10,
        expect.stringContaining('start=91'),
      );
      expect(result).toHaveLength(100);
    });
  });

  describe('searchCandidate', () => {
    it('makes no request and returns no items when the candidate has no name', async () => {
      const get = jest.spyOn(service.client, 'get');

      const result = await service.searchCandidate(
        buildCandidate({ first_name: null, last_name: null }),
      );

      expect(get).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('caps pagination at 20 results per query rather than the 100-result role-search cap', async () => {
      const fullPage = Array.from({ length: 10 }, (_, i) => ({
        title: `Result ${i}`,
        link: `https://linkedin.com/in/result-${i}`,
      }));
      const get = jest
        .spyOn(service.client, 'get')
        .mockResolvedValue({ data: { items: fullPage } });

      const result = await service.searchCandidate(
        buildCandidate({
          first_name: 'Jane',
          last_name: 'Doe',
          current_company: null,
          experience: [],
        }),
      );

      expect(get).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(20);
    });
  });
});
