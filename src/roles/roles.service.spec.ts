import { RolesService } from './roles.service';
import { RoleFilterDto } from '../common/dto/search.dto';
import { GoogleSearchService } from '../services/google-search/google-search.service';
import { GeminiService } from '../services/gemini/gemini.service';
import { PrismaService } from '../common/database/prisma.service';

function buildDto(overrides: Partial<RoleFilterDto> = {}): RoleFilterDto {
  return {
    uid: 'search-1',
    created: '2026-08-23T07:56:51.913Z',
    updated: '2026-08-23T07:56:51.913Z',
    role_id: 'role-1',
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

function buildGoogleSearchService(): jest.Mocked<GoogleSearchService> {
  return { search: jest.fn().mockResolvedValue([]) } as unknown as jest.Mocked<GoogleSearchService>;
}

function buildGeminiService(): jest.Mocked<GeminiService> {
  return {
    formatCandidates: jest.fn().mockResolvedValue({ matches: [], tokensUsed: 0 }),
  } as unknown as jest.Mocked<GeminiService>;
}

function buildPrisma() {
  return {
    candidate: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    role_result: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

function buildCandidateFields(overrides: Record<string, unknown> = {}) {
  return {
    main_source: 'LinkedIn',
    original_source_url: 'https://www.linkedin.com/in/janedoe',
    sources: ['LinkedIn'],
    first_name: 'Jane',
    last_name: 'Doe',
    skills: ['TypeScript'],
    ...overrides,
  };
}

describe('RolesService', () => {
  let googleSearchService: jest.Mocked<GoogleSearchService>;
  let geminiService: jest.Mocked<GeminiService>;
  let prisma: ReturnType<typeof buildPrisma>;
  let service: RolesService;

  beforeEach(() => {
    googleSearchService = buildGoogleSearchService();
    geminiService = buildGeminiService();
    prisma = buildPrisma();
    service = new RolesService(
      googleSearchService,
      geminiService,
      prisma as unknown as PrismaService,
    );
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
            uid: '1',
            created: '2026-08-23T07:56:51.913Z',
            updated: '2026-08-23T07:56:51.913Z',
            role_filters_id: 'search-1',
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

  describe('searchGoogle', () => {
    it('runs every built query against GoogleSearchService and returns the combined results', async () => {
      const dto = buildDto({
        sites: ['linkedin.com'],
        title: 'Software Engineer',
        alternative_titles: ['Backend Engineer'],
      });
      const primaryResults = [{ title: 'Jane Doe', link: 'https://linkedin.com/in/jane' }];
      const altResults = [{ title: 'John Roe', link: 'https://linkedin.com/in/john' }];
      googleSearchService.search
        .mockResolvedValueOnce(primaryResults)
        .mockResolvedValueOnce(altResults);

      const results = await (service as any).searchGoogle(dto);

      expect(googleSearchService.search).toHaveBeenCalledWith(
        'site:linkedin.com "Software Engineer"',
      );
      expect(googleSearchService.search).toHaveBeenCalledWith(
        'site:linkedin.com "Backend Engineer"',
      );
      expect(results).toEqual([...primaryResults, ...altResults]);
    });
  });

  describe('upsertCandidate', () => {
    it('creates a new candidate when no existing candidate has a matching original_source_url', async () => {
      const created = { uid: 'candidate-1', ...buildCandidateFields() };
      prisma.candidate.create.mockResolvedValue(created);

      const result = await (service as any).upsertCandidate(buildCandidateFields());

      expect(prisma.candidate.findFirst).toHaveBeenCalledWith({
        where: { original_source_url: 'https://www.linkedin.com/in/janedoe' },
      });
      expect(prisma.candidate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          main_source: 'LinkedIn',
          first_name: 'Jane',
        }),
      });
      expect(result).toBe(created);
    });

    it('updates the existing candidate when the extracted fields differ', async () => {
      const existing = {
        uid: 'candidate-1',
        main_source: 'LinkedIn',
        original_source_url: 'https://www.linkedin.com/in/janedoe',
        sources: ['LinkedIn'],
        first_name: 'Jane',
        last_name: 'Doe',
        skills: ['JavaScript'],
      };
      prisma.candidate.findFirst.mockResolvedValue(existing);
      const updated = { ...existing, skills: ['TypeScript'] };
      prisma.candidate.update.mockResolvedValue(updated);

      const result = await (service as any).upsertCandidate(buildCandidateFields());

      expect(prisma.candidate.update).toHaveBeenCalledWith({
        where: { uid: 'candidate-1' },
        data: expect.objectContaining({ skills: ['TypeScript'] }),
      });
      expect(result).toBe(updated);
    });

    it('returns the existing candidate without updating when nothing has changed', async () => {
      const existing = {
        uid: 'candidate-1',
        ...buildCandidateFields(),
      };
      prisma.candidate.findFirst.mockResolvedValue(existing);

      const result = await (service as any).upsertCandidate(buildCandidateFields());

      expect(prisma.candidate.update).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('creates a new candidate without a dedup lookup when original_source_url is missing', async () => {
      const fields = buildCandidateFields({ original_source_url: undefined });
      const created = { uid: 'candidate-2', ...fields };
      prisma.candidate.create.mockResolvedValue(created);

      const result = await (service as any).upsertCandidate(fields);

      expect(prisma.candidate.findFirst).not.toHaveBeenCalled();
      expect(prisma.candidate.create).toHaveBeenCalled();
      expect(result).toBe(created);
    });

    it('converts current_role_start_date and graduation_years into Date objects', async () => {
      prisma.candidate.create.mockResolvedValue({ uid: 'candidate-3' });

      await (service as any).upsertCandidate(
        buildCandidateFields({
          current_role_start_date: '2024-01-15T00:00:00.000Z',
          graduation_years: ['2020-06-18T00:00:00.000Z'],
        }),
      );

      const data = prisma.candidate.create.mock.calls[0][0].data;
      expect(data.current_role_start_date).toEqual(new Date('2024-01-15T00:00:00.000Z'));
      expect(data.graduation_years).toEqual([new Date('2020-06-18T00:00:00.000Z')]);
    });
  });

  describe('upsertRoleResult', () => {
    const match = { candidate: buildCandidateFields(), summary: 'Strong match', score: 85 };

    it('creates a role_result linking the candidate to the role when none exists', async () => {
      const created = { uid: 'result-1' };
      prisma.role_result.create.mockResolvedValue(created);

      const result = await (service as any).upsertRoleResult(
        'role-1',
        'candidate-1',
        match,
        123,
      );

      expect(prisma.role_result.findFirst).toHaveBeenCalledWith({
        where: { role_id: 'role-1', candidate_uid: 'candidate-1' },
      });
      expect(prisma.role_result.create).toHaveBeenCalledWith({
        data: {
          role_id: 'role-1',
          candidate_uid: 'candidate-1',
          summary: 'Strong match',
          score: 85,
          tokens_used: 123,
        },
      });
      expect(result).toBe(created);
    });

    it('updates the existing role_result when one already exists for that role and candidate', async () => {
      const existing = { uid: 'result-1' };
      prisma.role_result.findFirst.mockResolvedValue(existing);
      const updated = { uid: 'result-1', score: 85 };
      prisma.role_result.update.mockResolvedValue(updated);

      const result = await (service as any).upsertRoleResult(
        'role-1',
        'candidate-1',
        match,
        123,
      );

      expect(prisma.role_result.update).toHaveBeenCalledWith({
        where: { uid: 'result-1' },
        data: {
          role_id: 'role-1',
          candidate_uid: 'candidate-1',
          summary: 'Strong match',
          score: 85,
          tokens_used: 123,
        },
      });
      expect(result).toBe(updated);
    });
  });

  describe('search', () => {
    it('runs the Google search, formats results with Gemini, and saves each match as a candidate + role_result', async () => {
      const dto = buildDto({ role_id: 'role-1', sites: ['linkedin.com'] });
      const items = [{ title: 'Jane Doe', link: 'https://linkedin.com/in/jane' }];
      googleSearchService.search.mockResolvedValue(items);

      const match = { candidate: buildCandidateFields(), summary: 'Strong match', score: 85 };
      geminiService.formatCandidates.mockResolvedValue({ matches: [match], tokensUsed: 100 });

      const candidate = { uid: 'candidate-1' };
      prisma.candidate.create.mockResolvedValue(candidate);
      const roleResult = { uid: 'result-1' };
      prisma.role_result.create.mockResolvedValue(roleResult);

      const results = await service.search(dto);

      expect(geminiService.formatCandidates).toHaveBeenCalledWith(items, dto);
      expect(prisma.candidate.create).toHaveBeenCalled();
      expect(prisma.role_result.create).toHaveBeenCalledWith({
        data: {
          role_id: 'role-1',
          candidate_uid: 'candidate-1',
          summary: 'Strong match',
          score: 85,
          tokens_used: 100,
        },
      });
      expect(results).toEqual([roleResult]);
    });
  });
});
