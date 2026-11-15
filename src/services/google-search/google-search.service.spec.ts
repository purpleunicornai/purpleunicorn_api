import { GoogleSearchService, isXraySiteLink } from './google-search.service';
import serpApiMixedFixture from './__fixtures__/serpapi-mixed-search.json';
import { ParsedRoleFilters } from '../../roles/search/role-filter-parser';
import { candidate, candidate_experience } from '../../generated/prisma/client';
import { CriterionExpansions } from '../../roles/search/criterion-expansions';

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

// Distinct links per page, so the link de-dupe in search() doesn't collapse
// what are meant to be different people.
function buildPage(start: number, length = 10) {
  return Array.from({ length }, (_, i) => ({
    title: `Candidate ${start + i}`,
    link: `https://linkedin.com/in/candidate-${start + i}`,
  }));
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

const SITES =
  '(site:linkedin.com/in OR site:indeed.com/r OR site:xing.com/profile OR ' +
  'site:stackoverflow.com/users OR site:researchgate.net OR site:about.me OR ' +
  'site:behance.net OR site:dribbble.com OR site:angel.co OR site:wellfound.com OR ' +
  'site:kaggle.com OR site:medium.com OR site:dev.to)';

function buildExpansions(
  byCategory: CriterionExpansions['byCategory'],
): CriterionExpansions {
  return {
    version: 1,
    generatedAt: '2026-11-06T09:00:00.000Z',
    model: 'gemini-2.5-flash',
    byCategory,
  };
}

const FOUNDER_EXPANSIONS = buildExpansions({
  job_titles: [
    {
      seed: 'founder',
      terms: [
        'founder',
        'co-founder',
        'entrepreneur',
        'startup',
        'side hustle',
      ],
    },
  ],
});

function mainTitle(title: string): ParsedRoleFilters['jobTitles'][number] {
  return {
    value: { titles: [title], option: 'main_title' },
    priority: 'ESSENTIAL',
    nonNegotiable: false,
  };
}

const UK_LOCATION: ParsedRoleFilters['location'] = {
  value: {
    countryCode: 'GB',
    regions: [],
    remoteWork: false,
    workAuthorizationRequired: false,
  },
  priority: 'ESSENTIAL',
  nonNegotiable: false,
};

type BuildXrayQueries = (
  filters: ParsedRoleFilters,
  roleName?: string,
  regionNames?: string[],
  relaxed?: boolean,
  expansions?: CriterionExpansions | null,
) => string[];

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
          },
        ],
        skills: [
          {
            value: ['TypeScript', 'AWS'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
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
        },
      });

      const queries = (service as any).buildXrayQueries(filters);

      expect(queries).toContain(
        '(site:linkedin.com/in OR site:indeed.com/r OR site:xing.com/profile OR ' +
          'site:stackoverflow.com/users OR site:researchgate.net OR site:about.me OR ' +
          'site:behance.net OR site:dribbble.com OR site:angel.co OR site:wellfound.com OR ' +
          'site:kaggle.com OR site:medium.com OR site:dev.to) "Software Engineer" "New York" TypeScript AWS',
      );
    });

    it('scopes to the country name and requires the education qualification (or an alias) right after the title', () => {
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: ['Financial Manager'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
        skills: [
          { value: ['IFRS'], priority: 'ESSENTIAL', nonNegotiable: false },
        ],
        education: [
          {
            value: {
              qualifications: ['CA(SA)'],
              institutions: [],
              institutionType: 'include',
            },
            priority: 'OPTIONAL',
            nonNegotiable: false,
          },
        ],
        location: {
          value: {
            countryCode: 'ZA',
            regions: [],
            remoteWork: false,
            workAuthorizationRequired: false,
          },
          priority: 'OPTIONAL',
          nonNegotiable: false,
        },
      });

      const [query] = (service as any).buildXrayQueries(filters);

      expect(query).toMatch(
        /\) "Financial Manager" "South Africa" \("CA\(SA\)" OR "Chartered Accountant" OR SAICA\) IFRS$/,
      );
    });

    it('uses resolved region names instead of the stored province code', () => {
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: ['Accountant'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
        location: {
          value: {
            countryCode: 'ZA',
            regions: [
              { type: 'province', value: 'WC' },
              { type: 'province', value: 'Cape Town' },
            ],
            remoteWork: false,
            workAuthorizationRequired: false,
          },
          priority: 'ESSENTIAL',
          nonNegotiable: false,
        },
      });

      const [query] = (service as any).buildXrayQueries(filters, undefined, [
        'Western Cape',
        'Cape Town',
      ]);

      expect(query).toContain('Accountant ("Western Cape" OR "Cape Town")');
      expect(query).not.toContain(' WC');
    });

    it('OR-groups optional skills', () => {
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: ['Software Engineer'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
        skills: [
          {
            value: ['GraphQL', 'Docker'],
            priority: 'OPTIONAL',
            nonNegotiable: false,
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
          },
        ],
        companies: [
          {
            value: { names: ['Google', 'Microsoft'], type: 'include' },
            priority: 'OPTIONAL',
            nonNegotiable: false,
          },
        ],
      });

      const queries = (service as any).buildXrayQueries(filters);

      expect(
        queries.some((q: string) => q.includes('(Google OR Microsoft)')),
      ).toBe(true);
    });

    it('returns no queries when there is no main job title and no role name to fall back to', () => {
      const filters = buildFilters();

      const queries = (service as any).buildXrayQueries(filters);

      expect(queries).toEqual([]);
    });

    it("falls back to the role's name as the main title when no main_title row exists", () => {
      const filters = buildFilters({
        skills: [
          {
            value: ['TypeScript'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });

      const queries = (service as any).buildXrayQueries(
        filters,
        'Fullstack Developer',
      );

      expect(
        queries.some((q: string) => q.includes('"Fullstack Developer"')),
      ).toBe(true);
    });

    it('falls back to the role name when the main_title row exists but has no titles', () => {
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: [], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });

      const queries = (service as any).buildXrayQueries(
        filters,
        'Fullstack Developer',
      );

      expect(
        queries.some((q: string) => q.includes('"Fullstack Developer"')),
      ).toBe(true);
    });

    it('falls back to the role name as an alternative title when no alternative_title row exists', () => {
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: ['Software Engineer'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });

      const queries = (service as any).buildXrayQueries(
        filters,
        'Fullstack Developer',
      );

      expect(
        queries.some(
          (q: string) =>
            q.includes('"Fullstack Developer"') &&
            !q.includes('"Software Engineer"'),
        ),
      ).toBe(true);
    });

    it('still returns no queries when there is no main job title and no role name was passed', () => {
      const filters = buildFilters();

      const queries = (service as any).buildXrayQueries(filters, undefined);

      expect(queries).toEqual([]);
    });
  });

  describe('buildXrayQueries with saved criterion expansions', () => {
    const build: BuildXrayQueries = (...args) =>
      (
        service as unknown as { buildXrayQueries: BuildXrayQueries }
      ).buildXrayQueries(...args);

    it('sends the founder title as an OR group right before the location, split to stay inside the 32-word limit', () => {
      const queries = build(
        buildFilters({
          jobTitles: [mainTitle('founder')],
          location: UK_LOCATION,
        }),
        undefined,
        undefined,
        false,
        FOUNDER_EXPANSIONS,
      );

      // The site filter is 25 words and "United Kingdom" 2, leaving 5 for
      // the title group: the seed's chunk first, the rest in a second query.
      expect(queries).toEqual([
        `${SITES} (founder OR co-founder OR entrepreneur) "United Kingdom"`,
        `${SITES} (startup OR "side hustle") "United Kingdom"`,
      ]);
    });

    it('chunks an expanded title to fit alongside the location and a literal essential skill', () => {
      const queries = build(
        buildFilters({
          jobTitles: [mainTitle('founder')],
          skills: [
            { value: ['Python'], priority: 'ESSENTIAL', nonNegotiable: false },
          ],
          location: UK_LOCATION,
        }),
        undefined,
        undefined,
        false,
        FOUNDER_EXPANSIONS,
      );

      // 25 site + 2 location + 1 skill leaves 4 words for the title group.
      expect(queries).toEqual([
        `${SITES} (founder OR co-founder) "United Kingdom" Python`,
        `${SITES} (entrepreneur OR startup) "United Kingdom" Python`,
        `${SITES} "side hustle" "United Kingdom" Python`,
      ]);
      for (const query of queries) {
        expect(query.split(/\s+/).length).toBeLessThanOrEqual(32);
      }
    });

    it('builds exactly the original queries when nothing is expanded', () => {
      const filters = buildFilters({
        jobTitles: [
          mainTitle('Financial Manager'),
          {
            value: { titles: ['Finance Lead'], option: 'alternative_title' },
            priority: 'OPTIONAL',
            nonNegotiable: false,
          },
        ],
        skills: [
          {
            value: ['IFRS', 'SAP'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
          {
            value: ['Power BI', 'Excel'],
            priority: 'OPTIONAL',
            nonNegotiable: false,
          },
        ],
        location: UK_LOCATION,
      });
      // A saved group for a criterion that isn't in this filter set changes
      // nothing either.
      const unrelated = buildExpansions({
        skills: [{ seed: 'Python', terms: ['Python', 'Django'] }],
      });

      const original = build(filters, 'Role');
      expect(original).toEqual([
        `${SITES} "Financial Manager" "United Kingdom" IFRS SAP ("Power BI" OR Excel)`,
        `${SITES} "Finance Lead" "United Kingdom" IFRS SAP ("Power BI" OR Excel)`,
      ]);
      expect(build(filters, 'Role', undefined, false, null)).toEqual(original);
      expect(build(filters, 'Role', undefined, false, unrelated)).toEqual(
        original,
      );
    });

    it('with two oversized groups, shares the free words so every query fits, covering every term but not every combination', () => {
      const queries = build(
        buildFilters({
          jobTitles: [mainTitle('Data Engineer')],
          skills: [
            {
              value: ['Python', 'SQL'],
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
            {
              value: ['AWS', 'GCP'],
              priority: 'OPTIONAL',
              nonNegotiable: false,
            },
          ],
        }),
        undefined,
        undefined,
        false,
        buildExpansions({
          skills: [
            { seed: 'Python', terms: ['Python', 'Django', 'machine learning'] },
            { seed: 'aws', terms: ['AWS', 'Amazon Web Services', 'gcp'] },
          ],
        }),
      );

      // 25 site + 2 title + 1 SQL leaves 4 words for both groups, 2 each, so
      // each chunk is one term. Each later term is paired with the other
      // group's seed only, not with its later terms.
      expect(queries).toEqual([
        `${SITES} "Data Engineer" Python SQL AWS`,
        `${SITES} "Data Engineer" Django SQL AWS`,
        `${SITES} "Data Engineer" "machine learning" SQL AWS`,
        `${SITES} "Data Engineer" Python SQL "Amazon Web Services"`,
        `${SITES} "Data Engineer" Python SQL gcp`,
      ]);
      for (const query of queries) {
        expect(query.split(/\s+/).length).toBeLessThanOrEqual(32);
      }
    });

    it('splits an oversized skill group into extra queries, keeping the title and location in each and the seed in the first', () => {
      const queries = build(
        buildFilters({
          jobTitles: [mainTitle('Data Engineer')],
          skills: [
            { value: ['Python'], priority: 'ESSENTIAL', nonNegotiable: false },
          ],
          location: UK_LOCATION,
        }),
        undefined,
        undefined,
        false,
        buildExpansions({
          skills: [
            {
              seed: 'Python',
              terms: [
                'Python',
                'Django',
                'Flask',
                'FastAPI',
                'Pandas',
                'NumPy',
              ],
            },
          ],
        }),
      );

      // 25 site + 2 title + 2 location leaves 3 words for the skill group.
      expect(queries).toEqual([
        `${SITES} "Data Engineer" "United Kingdom" (Python OR Django)`,
        `${SITES} "Data Engineer" "United Kingdom" (Flask OR FastAPI)`,
        `${SITES} "Data Engineer" "United Kingdom" (Pandas OR NumPy)`,
      ]);
    });

    it('search() sends the saved OR groups, and the thin-result retry keeps the expanded title', async () => {
      const get = jest
        .spyOn(service.client, 'get')
        .mockResolvedValue({ data: { items: [] } });

      await service.search(
        buildFilters({
          jobTitles: [mainTitle('founder')],
          skills: [
            { value: ['Python'], priority: 'ESSENTIAL', nonNegotiable: false },
          ],
        }),
        undefined,
        FOUNDER_EXPANSIONS,
      );

      const queries = get.mock.calls.map(([url]) =>
        new URL(url).searchParams.get('q'),
      );
      // The strict queries leave room for the literal skill; the retry,
      // without it, fits one more term per chunk.
      expect(queries).toEqual([
        `${SITES} (founder OR co-founder OR entrepreneur) Python`,
        `${SITES} (startup OR "side hustle") Python`,
        `${SITES} (founder OR co-founder OR entrepreneur OR startup)`,
        `${SITES} "side hustle"`,
      ]);
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
            },
          ],
        }),
      );

      expect(result).toEqual([]);
    });

    it('pages through results up to the 100-result API cap, stopping once a page is short', async () => {
      const get = jest
        .spyOn(service.client, 'get')
        .mockResolvedValueOnce({ data: { items: buildPage(0) } })
        .mockResolvedValueOnce({ data: { items: buildPage(10) } })
        .mockResolvedValueOnce({ data: { items: buildPage(20, 4) } });

      const result = await service.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Software Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
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
      let start = 0;
      const get = jest.spyOn(service.client, 'get').mockImplementation(() => {
        const items = buildPage(start);
        start += 10;
        return Promise.resolve({ data: { items } });
      });

      const result = await service.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Software Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
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

    it('drops the same profile returned by more than one query', async () => {
      jest.spyOn(service.client, 'get').mockResolvedValue({
        data: {
          items: [
            { title: 'Jane', link: 'https://linkedin.com/in/jane' },
            { title: 'Jane', link: 'https://linkedin.com/in/jane/?trk=x' },
          ],
        },
      });

      const result = await service.search(
        buildFilters({
          jobTitles: [
            {
              value: {
                titles: ['Engineer', 'Developer'],
                option: 'main_title',
              },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
        }),
      );

      expect(result).toEqual([
        { title: 'Jane', link: 'https://linkedin.com/in/jane' },
      ]);
    });

    it('keeps results already fetched when a later page fails', async () => {
      jest
        .spyOn(service.client, 'get')
        .mockResolvedValueOnce({ data: { items: buildPage(0) } })
        .mockRejectedValueOnce(new Error('429 quota'))
        .mockResolvedValue({ data: { items: [] } });

      const result = await service.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
        }),
      );

      expect(result.slice(0, 10)).toEqual(buildPage(0));
    });

    it('retries without skills or companies, but keeps location and education, when the strict query is thin', async () => {
      const get = jest
        .spyOn(service.client, 'get')
        .mockResolvedValueOnce({ data: { items: buildPage(0, 3) } })
        .mockResolvedValueOnce({ data: { items: buildPage(100, 5) } });

      const result = await service.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Financial Manager'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
            {
              value: { titles: [], option: 'alternative_title' },
              priority: 'OPTIONAL',
              nonNegotiable: false,
            },
          ],
          skills: [
            {
              value: ['IFRS', 'SAP'],
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
          education: [
            {
              value: {
                qualifications: ['CA(SA)'],
                institutions: [],
                institutionType: 'include',
              },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
          location: {
            value: {
              countryCode: 'ZA',
              regions: [],
              remoteWork: false,
              workAuthorizationRequired: false,
            },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        }),
      );

      const queries = get.mock.calls.map(([url]) =>
        new URL(url).searchParams.get('q'),
      );
      expect(queries).toHaveLength(2);
      expect(queries[0]).toMatch(/ IFRS SAP$/);
      expect(queries[1]).toMatch(
        /\) "Financial Manager" "South Africa" \("CA\(SA\)" OR "Chartered Accountant" OR SAICA\)$/,
      );
      expect(result).toHaveLength(8);
    });

    it('does not run relaxed queries when the strict search already found enough', async () => {
      let start = 0;
      const get = jest.spyOn(service.client, 'get').mockImplementation(() => {
        const items = start < 30 ? buildPage(start) : [];
        start += 10;
        return Promise.resolve({ data: { items } });
      });

      await service.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
          skills: [
            { value: ['Go'], priority: 'ESSENTIAL', nonNegotiable: false },
          ],
        }),
      );

      const queries = new Set(
        get.mock.calls.map(([url]) => new URL(url).searchParams.get('q')),
      );
      expect(queries.size).toBe(1);
    });
  });

  describe('with SEARCH_PROVIDER=serper', () => {
    it('sends the same x-ray query with the role country, and keeps paging past a short Google page', async () => {
      const serper = new GoogleSearchService({
        searchProvider: 'serper',
        serperApiKey: 'test-serper-key',
      } as any);
      const post = jest
        .spyOn(serper.client, 'post')
        .mockResolvedValueOnce({
          data: { organic: buildPage(0, 9) },
        })
        .mockResolvedValueOnce({ data: { organic: buildPage(9, 25) } })
        .mockResolvedValue({ data: { organic: [] } });
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: ['Financial Manager'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
        education: [
          {
            value: {
              qualifications: ['CA(SA)'],
              institutions: [],
              institutionType: 'include',
            },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
        location: {
          value: {
            countryCode: 'ZA',
            regions: [],
            remoteWork: false,
            workAuthorizationRequired: false,
          },
          priority: 'ESSENTIAL',
          nonNegotiable: false,
        },
      });

      const result = await serper.search(filters);

      const [expectedQuery] = (serper as any).buildXrayQueries(
        filters,
        undefined,
        [],
      );
      expect(post.mock.calls[0][1]).toEqual({
        q: expectedQuery,
        num: 10,
        page: 1,
        gl: 'za',
      });
      expect(post.mock.calls[1][1]).toMatchObject({ page: 2 });
      expect(expectedQuery).toContain('"South Africa"');
      expect(expectedQuery).toContain('"CA(SA)"');
      expect(result).toHaveLength(34);
    });
  });

  describe('off-site results', () => {
    it('keeps x-ray profile links (any subdomain) and drops job boards and look-alike hosts', () => {
      expect(isXraySiteLink('https://za.linkedin.com/in/jane')).toBe(true);
      expect(isXraySiteLink('https://www.linkedin.com/in/jane/?trk=x')).toBe(
        true,
      );
      expect(isXraySiteLink('https://www.indeed.com/r/Jane-Doe/abc')).toBe(
        true,
      );
      expect(isXraySiteLink('https://stackoverflow.com/users/1/jane')).toBe(
        true,
      );
      expect(isXraySiteLink('https://dev.to/jane')).toBe(true);
      expect(
        isXraySiteLink('https://za.linkedin.com/jobs/managing-finances-jobs'),
      ).toBe(false);
      expect(isXraySiteLink('https://linkedin.com/industry/foo')).toBe(false);
      expect(isXraySiteLink('https://linkedin.com/inbox')).toBe(false);
      expect(
        isXraySiteLink('https://za.indeed.com/q-finance-manager-jobs.html'),
      ).toBe(false);
      expect(isXraySiteLink('https://linkedin.com.example.org/in/x')).toBe(
        false,
      );
      expect(isXraySiteLink('not a url')).toBe(false);
    });

    it('with SEARCH_PROVIDER=serpapi, returns only profile links from a mixed jobs/profiles page', async () => {
      const serpapi = new GoogleSearchService({
        googleSearchApiKey: undefined,
        googleSearchEngineId: undefined,
        searchProvider: 'serpapi',
        serpApiKey: 'test-serpapi-key',
      });
      jest
        .spyOn(serpapi.client, 'get')
        .mockResolvedValueOnce({ data: serpApiMixedFixture })
        .mockResolvedValue({ data: { organic_results: [] } });

      const result = await serpapi.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Financial Manager'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
        }),
      );

      expect(result.map((item) => item.link)).toEqual([
        'https://za.linkedin.com/in/thandi-mokoena-ca-sa',
        'https://www.linkedin.com/in/pietervanwyk',
      ]);
    });

    it('with SEARCH_PROVIDER=vertex, sends the same x-ray query and drops off-site results', async () => {
      const vertex = new GoogleSearchService({
        googleSearchApiKey: undefined,
        googleSearchEngineId: undefined,
        searchProvider: 'vertex',
        vertexProjectId: 'my-project',
        vertexEngineId: 'xray-app',
        vertexApiKey: 'test-key',
      });
      const post = jest
        .spyOn(vertex.client, 'post')
        .mockResolvedValueOnce({
          data: {
            results: [
              {
                document: {
                  derivedStructData: {
                    title: 'Finance jobs',
                    link: 'https://za.linkedin.com/jobs/finance-jobs',
                  },
                },
              },
              {
                document: {
                  derivedStructData: {
                    title: 'Jane Doe | LinkedIn',
                    link: 'https://za.linkedin.com/in/janedoe',
                  },
                },
              },
            ],
          },
        })
        .mockResolvedValue({ data: {} });
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: ['Financial Manager'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });

      const result = await vertex.search(filters);

      const [expectedQuery] = (
        vertex as unknown as {
          buildXrayQueries: (f: typeof filters) => string[];
        }
      ).buildXrayQueries(filters);
      expect(post.mock.calls[0][1]).toMatchObject({ query: expectedQuery });
      expect(result.map((item) => item.link)).toEqual([
        'https://za.linkedin.com/in/janedoe',
      ]);
    });

    it('keeps paging past a page that is all job listings', async () => {
      const serper = new GoogleSearchService({
        googleSearchApiKey: undefined,
        googleSearchEngineId: undefined,
        searchProvider: 'serper',
        serperApiKey: 'test-serper-key',
      });
      const jobsPage = Array.from({ length: 10 }, (_, i) => ({
        title: `Job ${i}`,
        link: `https://za.linkedin.com/jobs/job-${i}`,
      }));
      const post = jest
        .spyOn(serper.client, 'post')
        .mockResolvedValueOnce({ data: { organic: jobsPage } })
        .mockResolvedValueOnce({ data: { organic: buildPage(0, 5) } })
        .mockResolvedValue({ data: { organic: [] } });

      const result = await serper.search(
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
        }),
      );

      expect(post.mock.calls[1][1]).toMatchObject({ page: 2 });
      expect(result).toEqual(buildPage(0, 5));
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
