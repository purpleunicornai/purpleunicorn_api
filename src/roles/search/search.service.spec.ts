import { SearchService } from './search.service';
import { GoogleSearchService } from '../../services/google-search/google-search.service';
import { GeminiService } from '../../services/gemini/gemini.service';
import { PageFetchService } from '../../services/page-fetch/page-fetch.service';
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

function buildStoredFilterRow(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'filter-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    role_id: 'role-1',
    category: 'skills',
    value: null,
    list_value: ['React', 'Node.js'],
    priority: 'ESSENTIAL',
    non_negotiable: false,
    archived: false,
    archived_at: null,
    metadata: null,
    children: [],
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

function buildPageFetchService(): jest.Mocked<PageFetchService> {
  return {
    fetchPageText: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<PageFetchService>;
}

function buildCandidateScoringService(): jest.Mocked<CandidateScoringService> {
  return {
    scoreCandidate: jest.fn().mockReturnValue({ score: 0, breakdown: [] }),
  } as unknown as jest.Mocked<CandidateScoringService>;
}

function buildPrisma() {
  return {
    role_filters: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
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
    role_result_score_breakdown: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
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
  let pageFetchService: jest.Mocked<PageFetchService>;
  let candidateScoringService: jest.Mocked<CandidateScoringService>;
  let prisma: ReturnType<typeof buildPrisma>;
  let service: SearchService;

  beforeEach(() => {
    googleSearchService = buildGoogleSearchService();
    geminiService = buildGeminiService();
    pageFetchService = buildPageFetchService();
    candidateScoringService = buildCandidateScoringService();
    prisma = buildPrisma();
    service = new SearchService(
      googleSearchService,
      geminiService,
      pageFetchService,
      candidateScoringService,
      prisma as unknown as PrismaService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRoleFilters', () => {
    it('fetches every non-archived filter row for the role, with their children', async () => {
      const rows = [buildStoredFilterRow()];
      prisma.role_filters.findMany.mockResolvedValue(rows);

      const result = await (service as any).getRoleFilters('role-1');

      expect(prisma.role_filters.findMany).toHaveBeenCalledWith({
        where: { role_id: 'role-1', archived: false },
        include: { children: true },
      });
      expect(result).toBe(rows);
    });

    it('throws a 404 RequestException when there are no non-archived filter rows for the role', async () => {
      prisma.role_filters.findMany.mockResolvedValue([]);

      const error = await captureError(
        (service as any).getRoleFilters('role-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('Role filter not found');
      expect(error.getStatus()).toBe(404);
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

    it('nest-creates a candidate_experience row for the current role when company/title/start_date are known', async () => {
      prisma.candidate.create.mockResolvedValue({ uid: 'candidate-1' });

      await (service as any).upsertCandidate(
        buildCandidateFields({
          current_title: 'Software Engineer',
          current_company: 'Acme',
          current_role_start_date: '2020-01-01',
        }),
      );

      const data = prisma.candidate.create.mock.calls[0][0].data;
      expect(data.experience).toEqual({
        create: [
          {
            company_name: 'Acme',
            role: 'Software Engineer',
            start_date: new Date('2020-01-01T00:00:00.000Z'),
            end_date: null,
            skills: [],
          },
        ],
      });
    });

    it('does not nest-create a candidate_experience row when the current role is incomplete', async () => {
      prisma.candidate.create.mockResolvedValue({ uid: 'candidate-1' });

      await (service as any).upsertCandidate(
        buildCandidateFields({ current_title: 'Software Engineer' }),
      );

      const data = prisma.candidate.create.mock.calls[0][0].data;
      expect(data.experience).toBeUndefined();
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
      disqualified: false,
      breakdown: [
        {
          category: 'skills',
          weight: 60,
          earned: 60,
          applicable: true,
          filterId: 'filter-1',
        },
        {
          category: 'location',
          weight: 20,
          earned: 10,
          applicable: true,
          filterId: 'filter-2',
        },
      ],
    };

    it('creates a role_result linking the candidate, role, and filter when none exists', async () => {
      const created = { uid: 'result-1' };
      prisma.role_result.create.mockResolvedValue(created);

      const result = await (service as any).upsertRoleResult(
        'role-1',
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
          filter_id: null,
          candidate_uid: 'candidate-1',
          summary: 'Strong match',
          reasoning: 'Matches on required skills and location.',
          skills_matched: ['TypeScript'],
          ai_score: 85,
          score: 72,
          disqualified: false,
          tokens_used: 123,
        },
      });
      expect(
        prisma.role_result_score_breakdown.deleteMany,
      ).toHaveBeenCalledWith({
        where: { role_result_id: 'result-1' },
      });
      expect(
        prisma.role_result_score_breakdown.createMany,
      ).toHaveBeenCalledWith({
        data: [
          {
            role_result_id: 'result-1',
            role_filter_id: 'filter-1',
            category: 'skills',
            weight: 60,
            applicable: true,
            score: 60,
          },
          {
            role_result_id: 'result-1',
            role_filter_id: 'filter-2',
            category: 'location',
            weight: 20,
            applicable: true,
            score: 10,
          },
        ],
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
        'candidate-1',
        match,
        123,
        scoreResult,
      );

      expect(prisma.role_result.update).toHaveBeenCalledWith({
        where: { uid: 'result-1' },
        data: {
          role_id: 'role-1',
          filter_id: null,
          candidate_uid: 'candidate-1',
          summary: 'Strong match',
          reasoning: 'Matches on required skills and location.',
          skills_matched: ['TypeScript'],
          ai_score: 85,
          score: 72,
          disqualified: false,
          tokens_used: 123,
        },
        include: { candidate: true },
      });
      expect(
        prisma.role_result_score_breakdown.deleteMany,
      ).toHaveBeenCalledWith({
        where: { role_result_id: 'result-1' },
      });
      expect(
        prisma.role_result_score_breakdown.createMany,
      ).toHaveBeenCalledWith({
        data: [
          {
            role_result_id: 'result-1',
            role_filter_id: 'filter-1',
            category: 'skills',
            weight: 60,
            applicable: true,
            score: 60,
          },
          {
            role_result_id: 'result-1',
            role_filter_id: 'filter-2',
            category: 'location',
            weight: 20,
            applicable: true,
            score: 10,
          },
        ],
      });
      expect(result).toBe(updated);
    });
  });

  describe('search', () => {
    it('fetches the saved filter rows for the role, runs the search against them, and stamps each role_result', async () => {
      const role = buildRole();
      const filterRows = [
        buildStoredFilterRow({
          category: 'skills',
          list_value: ['React', 'Node.js'],
        }),
      ];
      prisma.role_filters.findMany.mockResolvedValue(filterRows);

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
        disqualified: false,
        breakdown: [
          {
            category: 'skills',
            weight: 80,
            earned: 57.6,
            applicable: true,
            filterId: 'filter-1',
          },
        ],
      };
      candidateScoringService.scoreCandidate.mockReturnValue(scoreResult);
      const roleResult = { uid: 'result-1' };
      prisma.role_result.create.mockResolvedValue(roleResult);

      const results = await service.search('role-1', role as any);

      expect(prisma.role_filters.findMany).toHaveBeenCalledWith({
        where: { role_id: 'role-1', archived: false },
        include: { children: true },
      });
      expect(googleSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          skills: [
            {
              value: ['React', 'Node.js'],
              priority: 'ESSENTIAL',
              nonNegotiable: false,
              filterId: 'filter-1',
            },
          ],
        }),
      );
      expect(geminiService.formatCandidates).toHaveBeenCalledWith(
        items,
        expect.anything(),
      );
      expect(candidateScoringService.scoreCandidate).toHaveBeenCalledWith(
        expect.anything(),
        candidate,
      );
      expect(prisma.role_result.create).toHaveBeenCalledWith({
        data: {
          role_id: 'role-1',
          filter_id: null,
          candidate_uid: 'candidate-1',
          summary: 'Strong match',
          reasoning: 'Matches on required skills and location.',
          skills_matched: ['TypeScript'],
          ai_score: 85,
          score: 72,
          disqualified: false,
          tokens_used: 100,
        },
      });
      expect(
        prisma.role_result_score_breakdown.createMany,
      ).toHaveBeenCalledWith({
        data: [
          {
            role_result_id: 'result-1',
            role_filter_id: 'filter-1',
            category: 'skills',
            weight: 80,
            applicable: true,
            score: 58,
          },
        ],
      });
      expect(prisma.role_filters.updateMany).toHaveBeenCalledWith({
        where: { role_id: 'role-1' },
        data: { search_run_date: expect.any(Date) },
      });
      expect(results).toEqual([roleResult]);
    });

    it('forces score to 0 and marks disqualified when the candidate fails a non-negotiable filter', async () => {
      const role = buildRole();
      prisma.role_filters.findMany.mockResolvedValue([buildStoredFilterRow()]);
      googleSearchService.search.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://linkedin.com/in/jane' },
      ]);
      const match = {
        candidate: buildCandidateFields(),
        summary: 'Weak match',
        reasoning: 'Missing a required criterion.',
        skills_matched: [],
        score: 20,
      };
      geminiService.formatCandidates.mockResolvedValue({
        matches: [match],
        tokensUsed: 50,
      });
      prisma.candidate.create.mockResolvedValue({ uid: 'candidate-1' });
      candidateScoringService.scoreCandidate.mockReturnValue({
        score: 65,
        disqualified: true,
        breakdown: [],
      });
      prisma.role_result.create.mockResolvedValue({ uid: 'result-1' });

      await service.search('role-1', role as any);

      expect(prisma.role_result.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ score: 0, disqualified: true }),
      });
    });

    it('stamps search_run_date on the filters even when no candidates are found', async () => {
      const role = buildRole();
      prisma.role_filters.findMany.mockResolvedValue([buildStoredFilterRow()]);
      googleSearchService.search.mockResolvedValue([]);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
      });

      await service.search('role-1', role as any);

      expect(prisma.role_filters.updateMany).toHaveBeenCalledWith({
        where: { role_id: 'role-1' },
        data: { search_run_date: expect.any(Date) },
      });
    });

    it('throws a 404 RequestException when the role has no saved filter rows', async () => {
      prisma.role_filters.findMany.mockResolvedValue([]);

      const error = await captureError(
        service.search('role-1', buildRole() as any),
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

    it('fetches page content for each search result and attaches it before calling Gemini', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
        { title: 'Jane Doe', link: 'https://www.linkedin.com/in/janedoe' },
      ]);
      pageFetchService.fetchPageText.mockImplementation((url: string) =>
        Promise.resolve(
          url === 'https://github.com/janedoe' ? 'GitHub bio text' : undefined,
        ),
      );
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(pageFetchService.fetchPageText).toHaveBeenCalledWith(
        'https://github.com/janedoe',
      );
      expect(pageFetchService.fetchPageText).toHaveBeenCalledWith(
        'https://www.linkedin.com/in/janedoe',
      );
      expect(geminiService.enrichCandidate).toHaveBeenCalledWith(
        [
          {
            title: 'Jane Doe',
            link: 'https://github.com/janedoe',
            page_content: 'GitHub bio text',
          },
          {
            title: 'Jane Doe',
            link: 'https://www.linkedin.com/in/janedoe',
            page_content: undefined,
          },
        ],
        expect.anything(),
      );
    });

    it('creates a synthesized current-role experience entry when enrichment finds the current role but no detailed history', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
      ]);
      geminiService.enrichCandidate.mockResolvedValue({
        enrichment: {
          current_company: 'Acme',
          current_title: 'Senior Engineer',
          current_role_start_date: '2021-03-01',
        },
        tokensUsed: 10,
      });
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate_experience.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            candidate_id: 'candidate-1',
            company_name: 'Acme',
            role: 'Senior Engineer',
            start_date: new Date('2021-03-01'),
            end_date: null,
          }),
        ],
      });
    });

    it('does not add a synthesized current-role entry when enrichment already extracted it', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
      ]);
      geminiService.enrichCandidate.mockResolvedValue({
        enrichment: {
          current_company: 'Acme',
          current_title: 'Senior Engineer',
          current_role_start_date: '2021-03-01',
          experience: [
            {
              company_name: 'Acme',
              role: 'Senior Engineer',
              start_date: '2021-03-01',
            },
          ],
        },
        tokensUsed: 10,
      });
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate_experience.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            company_name: 'Acme',
            role: 'Senior Engineer',
          }),
        ],
      });
      expect(
        prisma.candidate_experience.createMany.mock.calls[0][0].data,
      ).toHaveLength(1);
    });

    it('falls back to the existing candidate current role fields when enrichment omits them', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord({
          current_company: 'Acme',
          current_title: 'Senior Engineer',
          current_role_start_date: new Date('2021-03-01T00:00:00.000Z'),
        }),
      );
      googleSearchService.searchCandidate.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://github.com/janedoe' },
      ]);
      geminiService.enrichCandidate.mockResolvedValue({
        enrichment: { email: 'jane@example.com' },
        tokensUsed: 10,
      });
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate_experience.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            company_name: 'Acme',
            role: 'Senior Engineer',
            start_date: new Date('2021-03-01T00:00:00.000Z'),
          }),
        ],
      });
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
            company_name: 'TechCorp',
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
