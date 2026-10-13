import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SearchService } from './search.service';
import { GoogleSearchService } from '../../services/google-search/google-search.service';
import { GeminiService } from '../../services/gemini/gemini.service';
import { PageFetchService } from '../../services/page-fetch/page-fetch.service';
import { CandidateScoringService } from './candidate-scoring.service';
import { ExistingCandidateSearchService } from './existing-candidate-search.service';
import { GithubSearchService } from '../../services/github/github-search.service';
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

function collectEvents(
  observable: Observable<MessageEvent>,
): Promise<MessageEvent[]> {
  return new Promise((resolve, reject) => {
    const events: MessageEvent[] = [];
    observable.subscribe({
      next: (event) => events.push(event),
      error: reject,
      complete: () => resolve(events),
    });
  });
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

function buildFilterItem(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'item-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    role_filter_id: 'filter-1',
    category: 'skills',
    value: null,
    list_value: ['React', 'Node.js'],
    priority: 'ESSENTIAL',
    non_negotiable: false,
    children: [],
    ...overrides,
  };
}

function buildStoredFilterSet(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'filter-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    role_id: 'role-1',
    archived: false,
    archived_at: null,
    search_run_date: null,
    metadata: null,
    role_filter_items: [buildFilterItem()],
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
    scoreKnownCandidates: jest
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

function buildExistingCandidateSearchService(): jest.Mocked<ExistingCandidateSearchService> {
  return {
    findCandidates: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<ExistingCandidateSearchService>;
}

function buildGithubSearchService(): jest.Mocked<GithubSearchService> {
  return {
    search: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<GithubSearchService>;
}

function buildPrisma() {
  return {
    role_filters: {
      findFirst: jest.fn(),
      update: jest.fn(),
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
  let existingCandidateSearchService: jest.Mocked<ExistingCandidateSearchService>;
  let githubSearchService: jest.Mocked<GithubSearchService>;
  let prisma: ReturnType<typeof buildPrisma>;
  let service: SearchService;

  beforeEach(() => {
    googleSearchService = buildGoogleSearchService();
    geminiService = buildGeminiService();
    pageFetchService = buildPageFetchService();
    candidateScoringService = buildCandidateScoringService();
    existingCandidateSearchService = buildExistingCandidateSearchService();
    githubSearchService = buildGithubSearchService();
    prisma = buildPrisma();
    service = new SearchService(
      googleSearchService,
      geminiService,
      pageFetchService,
      candidateScoringService,
      existingCandidateSearchService,
      githubSearchService,
      prisma as unknown as PrismaService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRoleFilters', () => {
    it('fetches the non-archived filter set for the role, with its items and their children', async () => {
      const filterSet = buildStoredFilterSet();
      prisma.role_filters.findFirst.mockResolvedValue(filterSet);

      const result = await (service as any).getRoleFilters('role-1');

      expect(prisma.role_filters.findFirst).toHaveBeenCalledWith({
        where: { role_id: 'role-1', archived: false },
        include: { role_filter_items: { include: { children: true } } },
      });
      expect(result).toBe(filterSet);
    });

    it('throws a 404 RequestException when there is no non-archived filter set for the role', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(null);

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
          OR: [
            {
              sources: { some: { url: 'https://www.linkedin.com/in/janedoe' } },
            },
            {
              first_name: { equals: 'Jane', mode: 'insensitive' },
              last_name: { equals: 'Doe', mode: 'insensitive' },
            },
          ],
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

    it('creates a new candidate without a dedup lookup when there is no source_url and no name to match on', async () => {
      const fields = buildCandidateFields({
        source_url: undefined,
        first_name: undefined,
        last_name: undefined,
      });
      const created = { uid: 'candidate-2', ...fields };
      prisma.candidate.create.mockResolvedValue(created);

      const result = await (service as any).upsertCandidate(fields);

      expect(prisma.candidate.findFirst).not.toHaveBeenCalled();
      expect(prisma.candidate.create).toHaveBeenCalled();
      expect(result).toBe(created);
    });

    it('matches an existing candidate by first+last name when source_url is missing', async () => {
      const fields = buildCandidateFields({ source_url: undefined });
      const existing = {
        uid: 'candidate-1',
        first_name: 'Jane',
        last_name: 'Doe',
        skills: ['TypeScript'],
      };
      prisma.candidate.findFirst.mockResolvedValue(existing);

      const result = await (service as any).upsertCandidate(fields);

      expect(prisma.candidate.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            {
              first_name: { equals: 'Jane', mode: 'insensitive' },
              last_name: { equals: 'Doe', mode: 'insensitive' },
            },
          ],
        },
        include: { experience: true, education: true },
      });
      expect(prisma.candidate.update).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('matches an existing candidate by first+last name even when the extracted source_url does not match any known source (e.g. the same person found on a different platform)', async () => {
      const existing = {
        uid: 'candidate-1',
        first_name: 'Jane',
        last_name: 'Doe',
        skills: ['TypeScript'],
      };
      prisma.candidate.findFirst.mockResolvedValue(existing);
      const updated = { ...existing, skills: ['TypeScript', 'React'] };
      prisma.candidate.update.mockResolvedValue(updated);

      const result = await (service as any).upsertCandidate(
        buildCandidateFields({
          source_url: 'https://github.com/janedoe',
          skills: ['TypeScript', 'React'],
        }),
      );

      expect(prisma.candidate.create).not.toHaveBeenCalled();
      expect(result).toBe(updated);
    });

    it('matches by source_url only (no OR clause for name) when first_name or last_name is missing', async () => {
      prisma.candidate.create.mockResolvedValue({ uid: 'candidate-1' });

      await (service as any).upsertCandidate(
        buildCandidateFields({ first_name: undefined }),
      );

      expect(prisma.candidate.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            {
              sources: { some: { url: 'https://www.linkedin.com/in/janedoe' } },
            },
          ],
        },
        include: { experience: true, education: true },
      });
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
        },
        {
          category: 'location',
          weight: 20,
          earned: 10,
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
        'Google',
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
          disqualified: false,
          tokens_used: 123,
          sources: ['Google'],
          ai_platform: 'Gemini',
          ai_model: 'gemini-2.5-flash',
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
            role_filter_id: 'filter-1',
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
        'filter-1',
        'candidate-1',
        match,
        123,
        scoreResult,
        'GitHub',
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
          disqualified: false,
          tokens_used: 123,
          sources: ['GitHub'],
          ai_platform: 'Gemini',
          ai_model: 'gemini-2.5-flash',
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
            role_filter_id: 'filter-1',
            category: 'location',
            weight: 20,
            applicable: true,
            score: 10,
          },
        ],
      });
      expect(result).toBe(updated);
    });

    it('rounds a fractional breakdown weight so a full match never scores higher than its own weight (e.g. 80/3 essential rows)', async () => {
      const created = { uid: 'result-1' };
      prisma.role_result.create.mockResolvedValue(created);
      const fractionalWeight = 80 / 3; // 26.666...
      const fullMatchScoreResult = {
        score: 27,
        disqualified: false,
        breakdown: [
          {
            category: 'job_titles',
            weight: fractionalWeight,
            earned: fractionalWeight, // fraction === 1, a full match
            applicable: true,
          },
        ],
      };

      await (service as any).upsertRoleResult(
        'role-1',
        'filter-1',
        'candidate-1',
        match,
        123,
        fullMatchScoreResult,
        'Google',
      );

      const breakdownData =
        prisma.role_result_score_breakdown.createMany.mock.calls[0][0].data;
      expect(breakdownData[0].weight).toBe(27);
      expect(breakdownData[0].score).toBe(27);
      expect(breakdownData[0].score).toBeLessThanOrEqual(
        breakdownData[0].weight,
      );
    });
  });

  describe('search', () => {
    it('fetches the saved filter set for the role, runs the search against it, and stamps each role_result', async () => {
      const role = buildRole();
      const filterSet = buildStoredFilterSet({
        role_filter_items: [
          buildFilterItem({
            category: 'skills',
            list_value: ['React', 'Node.js'],
          }),
        ],
      });
      prisma.role_filters.findFirst.mockResolvedValue(filterSet);

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
          },
        ],
      };
      candidateScoringService.scoreCandidate.mockReturnValue(scoreResult);
      const roleResult = { uid: 'result-1' };
      prisma.role_result.create.mockResolvedValue(roleResult);

      const results = await service.search(
        'role-1',
        role as any,
        'user-1',
        'Jane Admin',
      );

      expect(prisma.role_filters.findFirst).toHaveBeenCalledWith({
        where: { role_id: 'role-1', archived: false },
        include: { role_filter_items: { include: { children: true } } },
      });
      expect(googleSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          skills: [
            {
              value: ['React', 'Node.js'],
              priority: 'ESSENTIAL',
              nonNegotiable: false,
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
          filter_id: 'filter-1',
          candidate_uid: 'candidate-1',
          summary: 'Strong match',
          reasoning: 'Matches on required skills and location.',
          skills_matched: ['TypeScript'],
          ai_score: 85,
          score: 72,
          disqualified: false,
          tokens_used: 100,
          sources: ['Google'],
          ai_platform: 'Gemini',
          ai_model: 'gemini-2.5-flash',
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
      expect(prisma.role_filters.update).toHaveBeenCalledWith({
        where: { uid: 'filter-1' },
        data: {
          search_run_date: expect.any(Date),
          search_run_by: 'Jane Admin',
          search_run_by_id: 'user-1',
        },
      });
      expect(results).toEqual([roleResult]);
    });

    it('forces score to 0 and marks disqualified when the candidate fails a non-negotiable filter', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
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

      await service.search('role-1', role as any, 'user-1', 'Jane Admin');

      expect(prisma.role_result.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ score: 0, disqualified: true }),
      });
    });

    it('stamps search_run_date on the filter set even when no candidates are found', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      googleSearchService.search.mockResolvedValue([]);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
      });

      await service.search('role-1', role as any, 'user-1', 'Jane Admin');

      expect(prisma.role_filters.update).toHaveBeenCalledWith({
        where: { uid: 'filter-1' },
        data: {
          search_run_date: expect.any(Date),
          search_run_by: 'Jane Admin',
          search_run_by_id: 'user-1',
        },
      });
    });

    it('throws a 404 RequestException when the role has no saved filter set', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(null);

      const error = await captureError(
        service.search('role-1', buildRole() as any, 'user-1', 'Jane Admin'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.getStatus()).toBe(404);
      expect(googleSearchService.search).not.toHaveBeenCalled();
    });

    it('splits a large result set into batches and calls Gemini once per batch, saving each batch as it completes', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      const items = Array.from({ length: 45 }, (_, i) => ({
        title: `Candidate ${i}`,
        link: `https://linkedin.com/in/candidate-${i}`,
      }));
      googleSearchService.search.mockResolvedValue(items);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
      });

      await service.search('role-1', role as any, 'user-1', 'Jane Admin');

      expect(geminiService.formatCandidates).toHaveBeenCalledTimes(3);
      expect(geminiService.formatCandidates).toHaveBeenNthCalledWith(
        1,
        items.slice(0, 20),
        expect.anything(),
      );
      expect(geminiService.formatCandidates).toHaveBeenNthCalledWith(
        2,
        items.slice(20, 40),
        expect.anything(),
      );
      expect(geminiService.formatCandidates).toHaveBeenNthCalledWith(
        3,
        items.slice(40, 45),
        expect.anything(),
      );
    });

    it('does not call Gemini at all when there are no search results, but still stamps search_run_date once', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      googleSearchService.search.mockResolvedValue([]);

      await service.search('role-1', role as any, 'user-1', 'Jane Admin');

      expect(geminiService.formatCandidates).not.toHaveBeenCalled();
      expect(prisma.role_filters.update).toHaveBeenCalledTimes(1);
      expect(prisma.role_filters.update).toHaveBeenCalledWith({
        where: { uid: 'filter-1' },
        data: {
          search_run_date: expect.any(Date),
          search_run_by: 'Jane Admin',
          search_run_by_id: 'user-1',
        },
      });
    });

    it('stamps search_run_date exactly once even when multiple batches are processed', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      const items = Array.from({ length: 25 }, (_, i) => ({
        title: `Candidate ${i}`,
        link: `https://linkedin.com/in/candidate-${i}`,
      }));
      googleSearchService.search.mockResolvedValue(items);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
      });

      await service.search('role-1', role as any, 'user-1', 'Jane Admin');

      expect(prisma.role_filters.update).toHaveBeenCalledTimes(1);
    });

    it('merges GitHub results in with the Google results before formatting candidates', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      const googleItem = {
        title: 'Jane Doe',
        link: 'https://linkedin.com/in/jane',
      };
      const githubItem = {
        title: 'janedoe - GitHub',
        link: 'https://github.com/janedoe',
      };
      googleSearchService.search.mockResolvedValue([googleItem]);
      githubSearchService.search.mockResolvedValue([githubItem]);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
      });

      await service.search('role-1', role as any, 'user-1', 'Jane Admin');

      expect(githubSearchService.search).toHaveBeenCalledWith(
        expect.anything(),
      );
      expect(geminiService.formatCandidates).toHaveBeenCalledWith(
        [googleItem, githubItem],
        expect.anything(),
      );
    });

    it('records which engine found each candidate on the saved role_result', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      googleSearchService.search.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://linkedin.com/in/jane' },
      ]);
      githubSearchService.search.mockResolvedValue([
        { title: 'janedoe - GitHub', link: 'https://github.com/janedoe' },
      ]);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [
          {
            candidate: buildCandidateFields({
              source_url: 'https://linkedin.com/in/jane',
            }),
            summary: 'Google match',
            reasoning: 'Found via Google.',
            skills_matched: [],
            score: 70,
          },
          {
            candidate: buildCandidateFields({
              source_url: 'https://github.com/janedoe',
            }),
            summary: 'GitHub match',
            reasoning: 'Found via GitHub.',
            skills_matched: [],
            score: 70,
          },
        ],
        tokensUsed: 100,
      });
      prisma.candidate.create
        .mockResolvedValueOnce({ uid: 'candidate-google' })
        .mockResolvedValueOnce({ uid: 'candidate-github' });
      prisma.role_result.create
        .mockResolvedValueOnce({ uid: 'result-google' })
        .mockResolvedValueOnce({ uid: 'result-github' });

      await service.search('role-1', role as any, 'user-1', 'Jane Admin');

      const calls = prisma.role_result.create.mock.calls;
      expect(calls[0][0].data.sources).toEqual(['Google']);
      expect(calls[1][0].data.sources).toEqual(['GitHub']);
    });

    it('scores and saves existing database candidates alongside freshly-found ones', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      googleSearchService.search.mockResolvedValue([]);

      const knownCandidate = { uid: 'known-1', skills: ['TypeScript'] };
      existingCandidateSearchService.findCandidates.mockResolvedValue([
        knownCandidate,
      ] as any);
      candidateScoringService.scoreCandidate.mockReturnValue({
        score: 72,
        disqualified: false,
        breakdown: [
          { category: 'skills', weight: 80, earned: 57.6, applicable: true },
        ],
      });
      geminiService.scoreKnownCandidates.mockResolvedValue({
        matches: [
          {
            candidate_uid: 'known-1',
            summary: 'Already on file, strong fit.',
            reasoning: 'Has the required skill from a prior search.',
            skills_matched: ['TypeScript'],
            score: 80,
          },
        ],
        tokensUsed: 60,
      });
      prisma.role_result.create.mockResolvedValue({ uid: 'result-known-1' });

      const results = await service.search(
        'role-1',
        role as any,
        'user-1',
        'Jane Admin',
      );

      expect(
        existingCandidateSearchService.findCandidates,
      ).toHaveBeenCalledWith('role-1', expect.anything());
      expect(geminiService.scoreKnownCandidates).toHaveBeenCalledWith(
        [knownCandidate],
        expect.anything(),
      );
      expect(prisma.role_result.create).toHaveBeenCalledWith({
        data: {
          role_id: 'role-1',
          filter_id: 'filter-1',
          candidate_uid: 'known-1',
          summary: 'Already on file, strong fit.',
          reasoning: 'Has the required skill from a prior search.',
          skills_matched: ['TypeScript'],
          ai_score: 80,
          score: 72,
          disqualified: false,
          tokens_used: 60,
          sources: ['Database'],
          ai_platform: 'Gemini',
          ai_model: 'gemini-2.5-flash',
        },
      });
      expect(results).toEqual([{ uid: 'result-known-1' }]);
    });

    it('does not call Gemini for existing candidates when the DB pool is empty', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      googleSearchService.search.mockResolvedValue([]);
      existingCandidateSearchService.findCandidates.mockResolvedValue([]);

      await service.search('role-1', role as any, 'user-1', 'Jane Admin');

      expect(geminiService.scoreKnownCandidates).not.toHaveBeenCalled();
    });

    it('excludes disqualified or zero-scoring existing candidates before calling Gemini', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      googleSearchService.search.mockResolvedValue([]);

      const zeroScoreCandidate = { uid: 'known-zero' };
      const disqualifiedCandidate = { uid: 'known-disqualified' };
      existingCandidateSearchService.findCandidates.mockResolvedValue([
        zeroScoreCandidate,
        disqualifiedCandidate,
      ] as any);
      candidateScoringService.scoreCandidate.mockImplementation(
        (_filters, candidate: any) =>
          candidate.uid === 'known-disqualified'
            ? { score: 90, disqualified: true, breakdown: [] }
            : { score: 0, disqualified: false, breakdown: [] },
      );

      await service.search('role-1', role as any, 'user-1', 'Jane Admin');

      expect(geminiService.scoreKnownCandidates).not.toHaveBeenCalled();
    });

    it('ranks the existing-candidate pool by deterministic score and caps it at the batch size before calling Gemini', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      googleSearchService.search.mockResolvedValue([]);

      const pool = Array.from({ length: 25 }, (_, i) => ({
        uid: `known-${i}`,
        rank: i,
      }));
      existingCandidateSearchService.findCandidates.mockResolvedValue(
        pool as any,
      );
      candidateScoringService.scoreCandidate.mockImplementation(
        (_filters, candidate: any) => ({
          score: candidate.rank,
          disqualified: false,
          breakdown: [],
        }),
      );

      await service.search('role-1', role as any, 'user-1', 'Jane Admin');

      const [sentCandidates] = geminiService.scoreKnownCandidates.mock.calls[0];
      expect(sentCandidates).toHaveLength(20);
      expect(sentCandidates[0].uid).toBe('known-24');
      expect(sentCandidates[19].uid).toBe('known-5');
    });

    it('skips a known candidate whose uid Gemini did not return a match for', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      googleSearchService.search.mockResolvedValue([]);
      existingCandidateSearchService.findCandidates.mockResolvedValue([
        { uid: 'known-1' },
      ] as any);
      candidateScoringService.scoreCandidate.mockReturnValue({
        score: 50,
        disqualified: false,
        breakdown: [],
      });
      geminiService.scoreKnownCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 10,
      });

      const results = await service.search(
        'role-1',
        role as any,
        'user-1',
        'Jane Admin',
      );

      expect(prisma.role_result.create).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });
  });

  describe('streamSearch', () => {
    it('merges GitHub results in with the Google results before formatting candidates', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      const googleItem = {
        title: 'Jane Doe',
        link: 'https://linkedin.com/in/jane',
      };
      const githubItem = {
        title: 'janedoe - GitHub',
        link: 'https://github.com/janedoe',
      };
      googleSearchService.search.mockResolvedValue([googleItem]);
      githubSearchService.search.mockResolvedValue([githubItem]);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
      });

      await collectEvents(
        service.streamSearch('role-1', 'user-1', 'Jane Admin'),
      );

      expect(geminiService.formatCandidates).toHaveBeenCalledWith(
        [googleItem, githubItem],
        expect.anything(),
      );
    });

    it('emits a progress event per batch and a final done event with every saved result', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      const items = Array.from({ length: 25 }, (_, i) => ({
        title: `Candidate ${i}`,
        link: `https://linkedin.com/in/candidate-${i}`,
      }));
      googleSearchService.search.mockResolvedValue(items);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
      });

      const events = await collectEvents(
        service.streamSearch('role-1', 'user-1', 'Jane Admin'),
      );

      expect(geminiService.formatCandidates).toHaveBeenCalledTimes(2);
      const progressEvents = events.filter((e) => {
        const data = e.data as { stage?: string; status?: string };
        return (
          e.type === 'stage' &&
          data.stage === 'formating candidates' &&
          data.status === 'progress'
        );
      });
      expect(progressEvents).toEqual([
        {
          type: 'stage',
          data: {
            stage: 'formating candidates',
            status: 'progress',
            completed: 1,
            total: 2,
            results: [],
          },
        },
        {
          type: 'stage',
          data: {
            stage: 'formating candidates',
            status: 'progress',
            completed: 2,
            total: 2,
            results: [],
          },
        },
      ]);

      const doneEvent = events[events.length - 1];
      expect(doneEvent.type).toBe('done');
      expect(prisma.role_filters.update).toHaveBeenCalledTimes(1);
    });

    it("includes each batch's own saved candidates in its progress event, not just the counts", async () => {
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      googleSearchService.search.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://linkedin.com/in/jane' },
      ]);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [
          {
            candidate: buildCandidateFields(),
            summary: 'Strong match',
            reasoning: 'Matches on required skills.',
            skills_matched: ['TypeScript'],
            score: 85,
          },
        ],
        tokensUsed: 100,
      });
      prisma.candidate.create.mockResolvedValue({ uid: 'candidate-1' });
      prisma.role_result.create.mockResolvedValue({ uid: 'result-1' });

      const events = await collectEvents(
        service.streamSearch('role-1', 'user-1', 'Jane Admin'),
      );

      const progressEvent = events.find((e) => {
        const data = e.data as { stage?: string; status?: string };
        return (
          e.type === 'stage' &&
          data.stage === 'formating candidates' &&
          data.status === 'progress'
        );
      });
      expect((progressEvent?.data as any).results).toEqual([
        { uid: 'result-1' },
      ]);
    });

    it('emits an error event and completes without a done event when an upstream step throws', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(null);

      const events = await collectEvents(
        service.streamSearch('role-1', 'user-1', 'Jane Admin'),
      );

      expect(events.some((e) => e.type === 'error')).toBe(true);
      expect(events.some((e) => e.type === 'done')).toBe(false);
      const errorEvent = events.find((e) => e.type === 'error');
      const data = errorEvent?.data as { message?: string } | undefined;
      expect(data?.message).toBe('Role filter not found');
    });

    it('does not call Gemini and still stamps search_run_date once when there are no search results', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      googleSearchService.search.mockResolvedValue([]);

      const events = await collectEvents(
        service.streamSearch('role-1', 'user-1', 'Jane Admin'),
      );

      expect(geminiService.formatCandidates).not.toHaveBeenCalled();
      expect(prisma.role_filters.update).toHaveBeenCalledTimes(1);
      expect(events.some((e) => e.type === 'done')).toBe(true);
    });

    it('emits a searching-existing-candidates stage and includes those matches in the final result', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      googleSearchService.search.mockResolvedValue([]);
      existingCandidateSearchService.findCandidates.mockResolvedValue([
        { uid: 'known-1' },
      ] as any);
      candidateScoringService.scoreCandidate.mockReturnValue({
        score: 60,
        disqualified: false,
        breakdown: [],
      });
      geminiService.scoreKnownCandidates.mockResolvedValue({
        matches: [
          {
            candidate_uid: 'known-1',
            summary: 'On file already.',
            reasoning: 'Matches on skills.',
            skills_matched: ['TypeScript'],
            score: 70,
          },
        ],
        tokensUsed: 20,
      });
      prisma.role_result.create.mockResolvedValue({ uid: 'result-known-1' });

      const events = await collectEvents(
        service.streamSearch('role-1', 'user-1', 'Jane Admin'),
      );

      const data = events.find(
        (e) =>
          e.type === 'stage' &&
          (e.data as any).stage === 'searching existing candidates' &&
          (e.data as any).status === 'done',
      )?.data as any;
      expect(data?.result).toBe(1);
      expect(data?.results).toEqual([{ uid: 'result-known-1' }]);

      const doneEvent = events[events.length - 1];
      expect((doneEvent.data as any).result).toEqual([
        { uid: 'result-known-1' },
      ]);
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
