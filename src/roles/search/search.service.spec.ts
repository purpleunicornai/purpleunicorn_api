import { SearchService } from './search.service';
import { GoogleSearchService } from '../../services/google-search/google-search.service';
import { GeminiService } from '../../services/gemini/gemini.service';
import { CandidateScoringService } from './candidate-scoring.service';
import { PrismaService } from '../../common/database/prisma.service';
import { RequestException } from '../../common/exception/core/ExceptionBase';

async function captureError(
  promise: Promise<unknown>,
): Promise<RequestException> {
  try {
    await promise;
  } catch (error) {
    return error as RequestException;
  }
  throw new Error('Expected promise to reject');
}

function buildRole(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'role-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    project_id: 'project-1',
    name: 'Fullstack Developer',
    description: null,
    summary: null,
    created_by: 'user-1',
    ...overrides,
  };
}

function buildStoredFilter(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'filter-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    role_id: 'role-1',
    country_code: 'US',
    remote_work: false,
    work_authorization_required: false,
    experience_min_yrs: 0,
    experience_max_yrs: 0,
    title: 'Fullstack Developer',
    alternative_titles: [],
    title_levels: [],
    roles: [],
    current_role_min_yrs: 0,
    current_role_max_yrs: 0,
    current_role_tenure_yrs: 0,
    required_skills: ['React', 'Node.js'],
    optional_skills: [],
    education_levels: [],
    education_institution: [],
    education_excluded_institutions: [],
    education_graduation_min_yr: null,
    education_graduation_max_yr: null,
    required_languages: [],
    optional_languages: [],
    career_growth: [],
    security_clearance_required: [],
    diversity: [],
    other_experience: [],
    sites: [],
    metadata: { complete: true, refined_prompt: '', original_prompt: '' },
    filter_location_cities: [],
    ...overrides,
  };
}

function buildGoogleSearchService(): jest.Mocked<GoogleSearchService> {
  return {
    search: jest.fn().mockResolvedValue([]),
    searchCandidate: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<GoogleSearchService>;
}

function buildGeminiService(): jest.Mocked<GeminiService> {
  return {
    formatCandidates: jest
      .fn()
      .mockResolvedValue({ matches: [], tokensUsed: 0 }),
    enrichCandidate: jest
      .fn()
      .mockResolvedValue({ enrichment: {}, tokensUsed: 0 }),
  } as unknown as jest.Mocked<GeminiService>;
}

function buildCandidateScoringService(): jest.Mocked<CandidateScoringService> {
  return {
    scoreCandidate: jest.fn().mockReturnValue({ score: 0, breakdown: [] }),
  } as unknown as jest.Mocked<CandidateScoringService>;
}

function buildPrisma() {
  return {
    role_filters: {
      findFirst: jest.fn(),
    },
    candidate: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    candidate_experience: {
      createMany: jest.fn(),
    },
    candidate_education: {
      createMany: jest.fn(),
    },
    candidate_source: {
      createMany: jest.fn(),
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
    source_title: 'Jane Doe - Software Engineer - LinkedIn',
    source_name: 'LinkedIn',
    source_url: 'https://www.linkedin.com/in/janedoe',
    first_name: 'Jane',
    last_name: 'Doe',
    skills: ['TypeScript'],
    ...overrides,
  };
}

function buildCandidateRecord(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'candidate-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    first_name: 'Jane',
    last_name: 'Doe',
    email: null,
    phone: null,
    current_company: null,
    experience_roles: [],
    skills: [],
    languages: [],
    diversity: [],
    enriched_at: null,
    experience: [],
    sources: [
      {
        uid: 'source-1',
        title: 'Jane Doe - Software Engineer - LinkedIn',
        source: 'LinkedIn',
        url: 'https://www.linkedin.com/in/janedoe',
        candidate_id: 'candidate-1',
        main: true,
        type: 'SEARCH',
      },
    ],
    ...overrides,
  };
}

describe('SearchService', () => {
  let googleSearchService: jest.Mocked<GoogleSearchService>;
  let geminiService: jest.Mocked<GeminiService>;
  let candidateScoringService: jest.Mocked<CandidateScoringService>;
  let prisma: ReturnType<typeof buildPrisma>;
  let service: SearchService;

  beforeEach(() => {
    googleSearchService = buildGoogleSearchService();
    geminiService = buildGeminiService();
    candidateScoringService = buildCandidateScoringService();
    prisma = buildPrisma();
    service = new SearchService(
      googleSearchService,
      geminiService,
      candidateScoringService,
      prisma as unknown as PrismaService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRoleFilter', () => {
    it('fetches the saved filter scoped to the role, with its location cities', async () => {
      const filter = buildStoredFilter();
      prisma.role_filters.findFirst.mockResolvedValue(filter);

      const result = await (service as any).getRoleFilter('filter-1', 'role-1');

      expect(prisma.role_filters.findFirst).toHaveBeenCalledWith({
        where: { uid: 'filter-1', role_id: 'role-1' },
        include: { filter_location_cities: true },
      });
      expect(result).toBe(filter);
    });

    it('throws a 404 RequestException when no matching saved filter exists for the role', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(null);

      const error = await captureError(
        (service as any).getRoleFilter('filter-1', 'role-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('Role filter not found');
      expect(error.getStatus()).toBe(404);
    });
  });

  describe('toRoleFilterDto', () => {
    it('maps the stored filter fields into the shape the search pipeline expects', () => {
      const filter = buildStoredFilter({
        title: 'Fullstack Developer',
        required_skills: ['React', 'Node.js'],
        industry: 'Technology',
        filter_location_cities: [
          {
            uid: 'city-1',
            created: new Date('2026-08-23T00:00:00.000Z'),
            updated: new Date('2026-08-23T00:00:00.000Z'),
            role_filters_id: 'filter-1',
            name: 'London',
            state: '',
            country_code: 'GB',
          },
        ],
      });

      const dto = (service as any).toRoleFilterDto(filter);

      expect(dto.title).toBe('Fullstack Developer');
      expect(dto.required_skills).toEqual(['React', 'Node.js']);
      expect(dto.industry).toBe('Technology');
      expect(dto.filter_location_cities).toEqual([
        expect.objectContaining({ name: 'London', country_code: 'GB' }),
      ]);
    });

    it('converts stored graduation year dates back into plain years', () => {
      const filter = buildStoredFilter({
        education_graduation_min_yr: new Date(Date.UTC(2020, 0, 1)),
        education_graduation_max_yr: null,
      });

      const dto = (service as any).toRoleFilterDto(filter);

      expect(dto.education_graduation_min_yr).toBe(2020);
      expect(dto.education_graduation_max_yr).toBeNull();
    });
  });

  describe('upsertCandidate', () => {
    it('creates a new candidate when no existing candidate has a matching source url', async () => {
      const created = { uid: 'candidate-1', ...buildCandidateFields() };
      prisma.candidate.create.mockResolvedValue(created);

      const result = await (service as any).upsertCandidate(
        buildCandidateFields(),
      );

      expect(prisma.candidate.findFirst).toHaveBeenCalledWith({
        where: {
          sources: {
            some: { url: 'https://www.linkedin.com/in/janedoe' },
          },
        },
        include: { experience: true, education: true },
      });
      expect(prisma.candidate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          first_name: 'Jane',
          sources: {
            create: [
              {
                title: 'Jane Doe - Software Engineer - LinkedIn',
                source: 'LinkedIn',
                url: 'https://www.linkedin.com/in/janedoe',
                main: true,
                type: 'SEARCH',
              },
            ],
          },
        }),
        include: { experience: true, education: true },
      });
      expect(result).toBe(created);
    });

    it('does not include source_title/source_name/source_url as top-level scalar fields', async () => {
      prisma.candidate.create.mockResolvedValue({ uid: 'candidate-1' });

      await (service as any).upsertCandidate(buildCandidateFields());

      const data = prisma.candidate.create.mock.calls[0][0].data;
      expect(data.source_title).toBeUndefined();
      expect(data.source_name).toBeUndefined();
      expect(data.source_url).toBeUndefined();
    });

    it('updates the existing candidate when the extracted fields differ, without touching sources', async () => {
      const existing = {
        uid: 'candidate-1',
        first_name: 'Jane',
        last_name: 'Doe',
        skills: ['JavaScript'],
      };
      prisma.candidate.findFirst.mockResolvedValue(existing);
      const updated = { ...existing, skills: ['TypeScript'] };
      prisma.candidate.update.mockResolvedValue(updated);

      const result = await (service as any).upsertCandidate(
        buildCandidateFields(),
      );

      expect(prisma.candidate.update).toHaveBeenCalledWith({
        where: { uid: 'candidate-1' },
        data: expect.objectContaining({ skills: ['TypeScript'] }),
        include: { experience: true, education: true },
      });
      const data = prisma.candidate.update.mock.calls[0][0].data;
      expect(data.sources).toBeUndefined();
      expect(result).toBe(updated);
    });

    it('returns the existing candidate without updating when nothing has changed', async () => {
      const existing = {
        uid: 'candidate-1',
        first_name: 'Jane',
        last_name: 'Doe',
        skills: ['TypeScript'],
      };
      prisma.candidate.findFirst.mockResolvedValue(existing);

      const result = await (service as any).upsertCandidate(
        buildCandidateFields(),
      );

      expect(prisma.candidate.update).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('creates a new candidate without a dedup lookup when source_url is missing', async () => {
      const fields = buildCandidateFields({ source_url: undefined });
      const created = { uid: 'candidate-2', ...fields };
      prisma.candidate.create.mockResolvedValue(created);

      const result = await (service as any).upsertCandidate(fields);

      expect(prisma.candidate.findFirst).not.toHaveBeenCalled();
      expect(prisma.candidate.create).toHaveBeenCalled();
      expect(result).toBe(created);
    });

    it('converts current_role_start_date into a Date object', async () => {
      prisma.candidate.create.mockResolvedValue({ uid: 'candidate-3' });

      await (service as any).upsertCandidate(
        buildCandidateFields({
          current_role_start_date: '2024-01-15T00:00:00.000Z',
        }),
      );

      const data = prisma.candidate.create.mock.calls[0][0].data;
      expect(data.current_role_start_date).toEqual(
        new Date('2024-01-15T00:00:00.000Z'),
      );
    });
  });

  describe('upsertRoleResult', () => {
    const match = {
      candidate: buildCandidateFields(),
      summary: 'Strong match',
      reasoning: 'Matches on required skills and location.',
      skills_matched: ['TypeScript'],
      score: 85,
    };
    const scoreResult = {
      score: 72,
      breakdown: [
        {
          category: 'required_skills',
          weight: 30,
          earned: 30,
          applicable: true,
        },
      ],
    };

    it('creates a role_result linking the candidate, role, and filter when none exists', async () => {
      const created = { uid: 'result-1' };
      prisma.role_result.create.mockResolvedValue(created);

      const result = await (service as any).upsertRoleResult(
        'role-1',
        'filter-1',
        'candidate-1',
        match,
        123,
        scoreResult,
      );

      expect(prisma.role_result.findFirst).toHaveBeenCalledWith({
        where: { role_id: 'role-1', candidate_uid: 'candidate-1' },
      });
      expect(prisma.role_result.create).toHaveBeenCalledWith({
        data: {
          role_id: 'role-1',
          filter_id: 'filter-1',
          candidate_uid: 'candidate-1',
          summary: 'Strong match',
          reasoning: 'Matches on required skills and location.',
          skills_matched: ['TypeScript'],
          ai_score: 85,
          score: 72,
          metadata: scoreResult.breakdown,
          tokens_used: 123,
        },
      });
      expect(result).toBe(created);
    });

    it('updates the existing role_result (including its filter_id) when one already exists', async () => {
      const existing = { uid: 'result-1' };
      prisma.role_result.findFirst.mockResolvedValue(existing);
      const updated = { uid: 'result-1', score: 72 };
      prisma.role_result.update.mockResolvedValue(updated);

      const result = await (service as any).upsertRoleResult(
        'role-1',
        'filter-1',
        'candidate-1',
        match,
        123,
        scoreResult,
      );

      expect(prisma.role_result.update).toHaveBeenCalledWith({
        where: { uid: 'result-1' },
        data: {
          role_id: 'role-1',
          filter_id: 'filter-1',
          candidate_uid: 'candidate-1',
          summary: 'Strong match',
          reasoning: 'Matches on required skills and location.',
          skills_matched: ['TypeScript'],
          ai_score: 85,
          score: 72,
          metadata: scoreResult.breakdown,
          tokens_used: 123,
        },
        include: { candidate: true },
      });
      expect(result).toBe(updated);
    });
  });

  describe('search', () => {
    it('fetches the saved filter, runs the search against it, and stamps filter_id on each role_result', async () => {
      const role = buildRole();
      const storedFilter = buildStoredFilter({ title: 'Fullstack Developer' });
      prisma.role_filters.findFirst.mockResolvedValue(storedFilter);

      const items = [
        { title: 'Jane Doe', link: 'https://linkedin.com/in/jane' },
      ];
      googleSearchService.search.mockResolvedValue(items);

      const match = {
        candidate: buildCandidateFields(),
        summary: 'Strong match',
        reasoning: 'Matches on required skills and location.',
        skills_matched: ['TypeScript'],
        score: 85,
      };
      geminiService.formatCandidates.mockResolvedValue({
        matches: [match],
        tokensUsed: 100,
      });

      const candidate = { uid: 'candidate-1', skills: ['TypeScript'] };
      prisma.candidate.create.mockResolvedValue(candidate);
      const scoreResult = {
        score: 72,
        breakdown: [
          {
            category: 'required_skills',
            weight: 30,
            earned: 30,
            applicable: true,
          },
        ],
      };
      candidateScoringService.scoreCandidate.mockReturnValue(scoreResult);
      const roleResult = { uid: 'result-1' };
      prisma.role_result.create.mockResolvedValue(roleResult);

      const results = await service.search('filter-1', role as any);

      expect(prisma.role_filters.findFirst).toHaveBeenCalledWith({
        where: { uid: 'filter-1', role_id: 'role-1' },
        include: { filter_location_cities: true },
      });
      expect(googleSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Fullstack Developer' }),
      );
      expect(geminiService.formatCandidates).toHaveBeenCalledWith(
        items,
        expect.objectContaining({ title: 'Fullstack Developer' }),
      );
      expect(candidateScoringService.scoreCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Fullstack Developer' }),
        candidate,
      );
      expect(prisma.role_result.create).toHaveBeenCalledWith({
        data: {
          role_id: 'role-1',
          filter_id: 'filter-1',
          candidate_uid: 'candidate-1',
          summary: 'Strong match',
          reasoning: 'Matches on required skills and location.',
          skills_matched: ['TypeScript'],
          ai_score: 85,
          score: 72,
          metadata: scoreResult.breakdown,
          tokens_used: 100,
        },
      });
      expect(results).toEqual([roleResult]);
    });

    it('throws a 404 RequestException when the filter does not belong to the role', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(null);

      const error = await captureError(
        service.search('filter-1', buildRole() as any),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.getStatus()).toBe(404);
      expect(googleSearchService.search).not.toHaveBeenCalled();
    });
  });

  describe('deepSearchCandidate', () => {
    it('returns the candidate unchanged when already enriched', async () => {
      const existing = buildCandidateRecord({ enriched_at: new Date() });
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(existing);

      const result = await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(googleSearchService.searchCandidate).not.toHaveBeenCalled();
      expect(prisma.candidate.update).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('re-runs the search even when already enriched if force is true', async () => {
      const existing = buildCandidateRecord({ enriched_at: new Date() });
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(existing);
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
      ]);
      geminiService.enrichCandidate.mockResolvedValue({
        enrichment: { email: 'jane@example.com' },
        tokensUsed: 10,
      });
      const updated = buildCandidateRecord({ email: 'jane@example.com' });
      prisma.candidate.update.mockResolvedValue(updated);

      const result = await service.deepSearchCandidate(
        'candidate-1',
        'role-1',
        true,
      );

      expect(googleSearchService.searchCandidate).toHaveBeenCalledWith(
        existing,
      );
      expect(result).toBe(updated);
    });

    it('still skips when there is no name to search on, even if force is true', async () => {
      const existing = buildCandidateRecord({
        first_name: null,
        last_name: null,
        enriched_at: new Date(),
      });
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(existing);

      const result = await service.deepSearchCandidate(
        'candidate-1',
        'role-1',
        true,
      );

      expect(googleSearchService.searchCandidate).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('returns the candidate unchanged when there is no name to search on', async () => {
      const existing = buildCandidateRecord({
        first_name: null,
        last_name: null,
      });
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(existing);

      const result = await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(googleSearchService.searchCandidate).not.toHaveBeenCalled();
      expect(prisma.candidate.update).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('marks enriched_at without calling Gemini when the deep search finds nothing', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      googleSearchService.searchCandidate.mockResolvedValue([]);
      const updated = buildCandidateRecord({ enriched_at: new Date() });
      prisma.candidate.update.mockResolvedValue(updated);

      const result = await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate.update).toHaveBeenCalledWith({
        where: { uid: 'candidate-1' },
        data: { enriched_at: expect.any(Date) },
        include: { experience: true, education: true, sources: true },
      });
      expect(geminiService.enrichCandidate).not.toHaveBeenCalled();
      expect(result).toBe(updated);
    });

    it('overwrites scalar fields with newly-found values', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord({ email: null, current_company: 'OldCo' }),
      );
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
      ]);
      geminiService.enrichCandidate.mockResolvedValue({
        enrichment: { email: 'jane@example.com', current_company: 'NewCo' },
        tokensUsed: 10,
      });
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate.update).toHaveBeenCalledWith({
        where: { uid: 'candidate-1' },
        data: expect.objectContaining({
          email: 'jane@example.com',
          current_company: 'NewCo',
          enriched_at: expect.any(Date),
        }),
        include: {
          experience: true,
          education: true,
          sources: true,
          role_results: { where: { role_id: 'role-1' } },
        },
      });
    });

    it('unions list fields instead of overwriting them', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord({ skills: ['TypeScript'] }),
      );
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
      ]);
      geminiService.enrichCandidate.mockResolvedValue({
        enrichment: { skills: ['TypeScript', 'NestJS'] },
        tokensUsed: 10,
      });
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate.update).toHaveBeenCalledWith({
        where: { uid: 'candidate-1' },
        data: expect.objectContaining({ skills: ['TypeScript', 'NestJS'] }),
        include: {
          experience: true,
          education: true,
          sources: true,
          role_results: { where: { role_id: 'role-1' } },
        },
      });
    });

    it('creates additional candidate_source rows (main: false) for newly-found platforms', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
      ]);
      geminiService.enrichCandidate.mockResolvedValue({
        enrichment: {
          additional_sources: [
            {
              title: 'Jane Doe - GitHub',
              name: 'GitHub',
              url: 'https://github.com/janedoe',
            },
          ],
        },
        tokensUsed: 10,
      });
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate_source.createMany).toHaveBeenCalledWith({
        data: [
          {
            candidate_id: 'candidate-1',
            title: 'Jane Doe - GitHub',
            source: 'GitHub',
            url: 'https://github.com/janedoe',
            main: false,
            type: 'SEARCH',
          },
        ],
      });
    });

    it('does not call candidate_source.createMany when no additional sources are found', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
      ]);
      geminiService.enrichCandidate.mockResolvedValue({
        enrichment: {},
        tokensUsed: 10,
      });
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate_source.createMany).not.toHaveBeenCalled();
    });

    it('creates candidate_experience rows only for entries with a start_date', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
      ]);
      geminiService.enrichCandidate.mockResolvedValue({
        enrichment: {
          experience: [
            {
              company_name: 'TechCorp',
              role: 'Engineer',
              start_date: '2021-01-01',
            },
            { company_name: 'NoDateCo', role: 'Intern' },
          ],
        },
        tokensUsed: 10,
      });
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate_experience.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            candidate_id: 'candidate-1',
            comapany_name: 'TechCorp',
            role: 'Engineer',
            start_date: new Date('2021-01-01'),
          }),
        ],
      });
    });

    it('does not call candidate_experience.createMany when no work history is extracted', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
      ]);
      geminiService.enrichCandidate.mockResolvedValue({
        enrichment: {},
        tokensUsed: 10,
      });
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate_experience.createMany).not.toHaveBeenCalled();
    });

    it('creates candidate_education rows only for entries with a start_date', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
      ]);
      geminiService.enrichCandidate.mockResolvedValue({
        enrichment: {
          education: [
            {
              institution_name: 'University of Oxford',
              institution_type: 'UNIVERSITY',
              start_date: '2016-09-01',
            },
            {
              institution_name: 'No Date University',
              institution_type: 'UNIVERSITY',
            },
          ],
        },
        tokensUsed: 10,
      });
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate_education.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            candidate_id: 'candidate-1',
            institution_name: 'University of Oxford',
            institution_type: 'UNIVERSITY',
            start_date: new Date('2016-09-01'),
          }),
        ],
      });
    });

    it('does not call candidate_education.createMany when no education history is extracted', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
      ]);
      geminiService.enrichCandidate.mockResolvedValue({
        enrichment: {},
        tokensUsed: 10,
      });
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate_education.createMany).not.toHaveBeenCalled();
    });
  });
});
