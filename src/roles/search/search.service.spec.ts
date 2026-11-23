import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SearchPageStageEvent, SearchService } from './search.service';
import { VertexSearchService } from '../../services/vertex/vertex-search.service';
import { GeminiService } from '../../services/gemini/gemini.service';
import {
  CandidateScoringService,
  scoringFactsOf,
} from './candidate-scoring.service';
import { parseRoleFilters } from './role-filter-parser';
import { ExistingCandidateSearchService } from './existing-candidate-search.service';
import { GithubSearchService } from '../../services/github/github-search.service';
import { PrismaService } from '../../common/database/prisma.service';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import type { GeminiUsage } from '../../services/gemini/gemini-usage';
import {
  encodeSearchPageToken,
  parseSearchPageToken,
} from './search-page-token';
import { reasoningServiceFor } from '../../services/reasoning/reasoning.testing';
import { DEFAULT_REASONING_MODEL } from '../../services/reasoning/reasoning-model';

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

function buildVertexSearchService(): jest.Mocked<VertexSearchService> {
  return {
    search: jest.fn().mockResolvedValue([]),
    searchRolePage: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      skippedDuplicates: 0,
      filteredOutByLocation: 0,
    }),
  } as unknown as jest.Mocked<VertexSearchService>;
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
    scoreCandidates: jest.fn().mockResolvedValue({ scores: [], tokensUsed: 0 }),
    researchCandidate: jest.fn(),
    expandSearchTerms: jest.fn(),
  } as unknown as jest.Mocked<GeminiService>;
}

function buildCandidateScoringService(): jest.Mocked<CandidateScoringService> {
  const real = new CandidateScoringService();
  return {
    scoreCandidate: jest.fn().mockReturnValue({
      score: 0,
      rawScore: 0,
      disqualified: false,
      missedNonNegotiables: [],
      breakdown: [],
    }),
    // The real fixed algorithm, so research re-scores are exercised for real.
    scoreFacts: jest.fn(
      (...args: Parameters<CandidateScoringService['scoreFacts']>) =>
        real.scoreFacts(...args),
    ),
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
      findUnique: jest.fn(),
      update: jest.fn(),
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
      findMany: jest.fn().mockResolvedValue([]),
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
  let vertexSearchService: jest.Mocked<VertexSearchService>;
  let geminiService: jest.Mocked<GeminiService>;
  let candidateScoringService: jest.Mocked<CandidateScoringService>;
  let existingCandidateSearchService: jest.Mocked<ExistingCandidateSearchService>;
  let githubSearchService: jest.Mocked<GithubSearchService>;
  let prisma: ReturnType<typeof buildPrisma>;
  let service: SearchService;

  beforeEach(() => {
    vertexSearchService = buildVertexSearchService();
    geminiService = buildGeminiService();
    candidateScoringService = buildCandidateScoringService();
    existingCandidateSearchService = buildExistingCandidateSearchService();
    githubSearchService = buildGithubSearchService();
    prisma = buildPrisma();
    service = new SearchService(
      vertexSearchService,
      reasoningServiceFor(geminiService),
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

    it("never replaces a stored photo with LinkedIn's placeholder", async () => {
      const existing = {
        uid: 'candidate-1',
        first_name: 'Jane',
        last_name: 'Doe',
        skills: ['TypeScript'],
        image_url: 'https://media.licdn.com/jane.jpg',
      };
      prisma.candidate.findFirst.mockResolvedValue(existing);

      const result = await (service as any).upsertCandidate(
        buildCandidateFields({
          image_url:
            'https://static.licdn.com/aero-v1/sc/h/1c5u578iilxfi4m4dvc4q810q',
        }),
      );

      expect(prisma.candidate.update).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it("doesn't save LinkedIn's placeholder on a new candidate", async () => {
      prisma.candidate.create.mockResolvedValue({ uid: 'candidate-2' });

      await (service as any).upsertCandidate(
        buildCandidateFields({
          image_url:
            'https://static.licdn.com/aero-v1/sc/h/1c5u578iilxfi4m4dvc4q810q',
        }),
      );

      expect(
        prisma.candidate.create.mock.calls[0][0].data.image_url,
      ).toBeUndefined();
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
      rawScore: 72,
      disqualified: false,
      missedNonNegotiables: [],
      breakdown: [
        {
          category: 'skills',
          requirement: 'TypeScript',
          priority: 'ESSENTIAL' as const,
          nonNegotiable: false,
          weight: 60,
          earned: 60,
          applicable: true,
        },
        {
          category: 'location',
          requirement: 'based in ZA',
          priority: 'ESSENTIAL' as const,
          nonNegotiable: false,
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
        'Vertex',
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
          pre_disqualification_score: null,
          disqualified_reasons: [],
          tokens_used: 123,
          sources: ['Vertex'],
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
            metadata: {
              requirement: 'TypeScript',
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          },
          {
            role_result_id: 'result-1',
            role_filter_id: 'filter-1',
            category: 'location',
            weight: 20,
            applicable: true,
            score: 10,
            metadata: {
              requirement: 'based in ZA',
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
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
          pre_disqualification_score: null,
          disqualified_reasons: [],
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
            metadata: {
              requirement: 'TypeScript',
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          },
          {
            role_result_id: 'result-1',
            role_filter_id: 'filter-1',
            category: 'location',
            weight: 20,
            applicable: true,
            score: 10,
            metadata: {
              requirement: 'based in ZA',
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          },
        ],
      });
      expect(result).toBe(updated);
    });

    it("records this result's share of the scoring call's Gemini usage", async () => {
      prisma.role_result.create.mockResolvedValue({ uid: 'result-1' });
      const share = { inputTokens: 500, outputTokens: 80, totalTokens: 580 };

      await (service as any).upsertRoleResult(
        'role-1',
        'filter-1',
        'candidate-1',
        match,
        580,
        scoreResult,
        'Vertex',
        share,
      );

      const { data } = prisma.role_result.create.mock.calls[0][0];
      expect(data.metadata).toEqual({
        geminiUsage: { scoring: { ...share, calls: 1 } },
      });
    });

    it('adds a re-score to the recorded usage and keeps deep research findings and usage', async () => {
      const research = {
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
        calls: 1,
      };
      const findings = [
        { fact: 'Speaks on IFRS 17', sourceUrl: 'https://x.dev' },
      ];
      prisma.role_result.findFirst.mockResolvedValue({
        uid: 'result-1',
        metadata: {
          missing: ['Old note'],
          findings,
          identityConfidence: 'high',
          geminiUsage: {
            scoring: {
              inputTokens: 500,
              outputTokens: 80,
              totalTokens: 580,
              calls: 1,
            },
            research,
          },
        },
      });
      prisma.role_result.update.mockResolvedValue({ uid: 'result-1' });

      await (service as any).upsertRoleResult(
        'role-1',
        'filter-1',
        'candidate-1',
        match,
        600,
        scoreResult,
        'Vertex',
        { inputTokens: 520, outputTokens: 80, totalTokens: 600 },
      );

      const { data } = prisma.role_result.update.mock.calls[0][0];
      expect(data.metadata).toEqual({
        findings,
        identityConfidence: 'high',
        geminiUsage: {
          scoring: {
            inputTokens: 1020,
            outputTokens: 160,
            totalTokens: 1180,
            calls: 2,
          },
          research,
        },
      });
    });

    it('rounds a fractional breakdown weight so a full match never scores higher than its own weight (e.g. 80/3 essential rows)', async () => {
      const created = { uid: 'result-1' };
      prisma.role_result.create.mockResolvedValue(created);
      const fractionalWeight = 80 / 3; // 26.666...
      const fullMatchScoreResult = {
        score: 27,
        rawScore: 27,
        disqualified: false,
        missedNonNegotiables: [],
        breakdown: [
          {
            category: 'job_titles',
            requirement: 'Finance Manager',
            priority: 'ESSENTIAL' as const,
            nonNegotiable: false,
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
        'Vertex',
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
      vertexSearchService.search.mockResolvedValue(items);

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
        usage: null,
      });

      const candidate = { uid: 'candidate-1', skills: ['TypeScript'] };
      prisma.candidate.create.mockResolvedValue(candidate);
      const scoreResult = {
        score: 72,
        rawScore: 72,
        disqualified: false,
        missedNonNegotiables: [],
        breakdown: [
          {
            category: 'skills',
            requirement: 'TypeScript',
            priority: 'ESSENTIAL' as const,
            nonNegotiable: false,
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
        role,
        'user-1',
        'Jane Admin',
      );

      expect(prisma.role_filters.findFirst).toHaveBeenCalledWith({
        where: { role_id: 'role-1', archived: false },
        include: { role_filter_items: { include: { children: true } } },
      });
      expect(vertexSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          skills: [
            {
              value: ['React', 'Node.js'],
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
        }),
        'Fullstack Developer',
        null,
      );
      expect(geminiService.formatCandidates).toHaveBeenCalledWith(
        items,
        expect.anything(),
        { model: DEFAULT_REASONING_MODEL.model },
      );
      expect(candidateScoringService.scoreCandidate).toHaveBeenCalledWith(
        expect.anything(),
        candidate,
        { qualifications: undefined },
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
          pre_disqualification_score: null,
          disqualified_reasons: [],
          tokens_used: 100,
          sources: ['Vertex'],
          ai_platform: 'Gemini',
          ai_model: 'gemini-2.5-flash',
          // The search snapshot a later deep research re-scores from.
          metadata: {
            searchEvidence: expect.objectContaining({
              skills: ['TypeScript'],
            }),
            searchScore: {
              score: 72,
              rawScore: 72,
              disqualified: false,
              disqualifiedReasons: [],
            },
          },
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
            metadata: {
              requirement: 'TypeScript',
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          },
        ],
      });
      expect(prisma.role_filters.updateMany).toHaveBeenCalledWith({
        where: { role_id: 'role-1', archived: false },
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
      vertexSearchService.search.mockResolvedValue([
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
        usage: null,
      });
      prisma.candidate.create.mockResolvedValue({ uid: 'candidate-1' });
      candidateScoringService.scoreCandidate.mockReturnValue({
        score: 0,
        rawScore: 65,
        disqualified: true,
        missedNonNegotiables: [
          { category: 'education', requirement: 'CA(SA)' },
        ],
        breakdown: [],
      });
      prisma.role_result.create.mockResolvedValue({ uid: 'result-1' });

      await service.search('role-1', role, 'user-1', 'Jane Admin');

      expect(prisma.role_result.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          score: 0,
          disqualified: true,
          pre_disqualification_score: 65,
          disqualified_reasons: ['CA(SA)'],
        }),
      });
    });

    it('does not save a new candidate known to be outside an essential country', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(
        buildStoredFilterSet({
          role_filter_items: [
            buildFilterItem(),
            buildFilterItem({
              uid: 'item-loc',
              category: 'location',
              value: 'ZA',
              list_value: [],
            }),
          ],
        }),
      );
      vertexSearchService.search.mockResolvedValue([
        { title: 'Jane Doe', link: 'https://linkedin.com/in/jane' },
      ]);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [
          {
            candidate: buildCandidateFields({
              current_location_country_code: 'US',
              open_to_relocation: false,
            }),
            summary: 'US based',
            reasoning: 'Wrong country.',
            skills_matched: [],
            score: 70,
          },
        ],
        tokensUsed: 50,
        usage: null,
      });

      await service.search('role-1', role, 'user-1', 'Jane Admin');

      expect(prisma.candidate.create).not.toHaveBeenCalled();
      expect(prisma.role_result.create).not.toHaveBeenCalled();
    });

    it('skips a batch Gemini fails on and still saves the other batches', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      vertexSearchService.search.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => ({
          title: `Candidate ${i}`,
          link: `https://linkedin.com/in/c${i}`,
        })),
      );
      geminiService.formatCandidates
        .mockRejectedValueOnce(new Error('Gemini timeout'))
        .mockResolvedValueOnce({
          matches: [
            {
              candidate: buildCandidateFields(),
              summary: 'Good',
              reasoning: 'Fits.',
              skills_matched: [],
              score: 80,
            },
          ],
          tokensUsed: 10,
          usage: null,
        });
      prisma.candidate.create.mockResolvedValue({ uid: 'candidate-1' });
      candidateScoringService.scoreCandidate.mockReturnValue({
        score: 70,
        rawScore: 70,
        disqualified: false,
        missedNonNegotiables: [],
        breakdown: [],
      });
      prisma.role_result.create.mockResolvedValue({ uid: 'result-1' });

      const results = await service.search(
        'role-1',
        role,
        'user-1',
        'Jane Admin',
      );

      expect(geminiService.formatCandidates).toHaveBeenCalledTimes(2);
      expect(results).toEqual([{ uid: 'result-1' }]);
      expect(prisma.role_filters.updateMany).toHaveBeenCalled();
    });

    it('stamps search_run_date on the filter set even when no candidates are found', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      vertexSearchService.search.mockResolvedValue([]);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
        usage: null,
      });

      await service.search('role-1', role, 'user-1', 'Jane Admin');

      expect(prisma.role_filters.updateMany).toHaveBeenCalledWith({
        where: { role_id: 'role-1', archived: false },
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
        service.search('role-1', buildRole(), 'user-1', 'Jane Admin'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.getStatus()).toBe(404);
      expect(vertexSearchService.search).not.toHaveBeenCalled();
    });

    it('splits a large result set into batches and calls Gemini once per batch, saving each batch as it completes', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      const items = Array.from({ length: 45 }, (_, i) => ({
        title: `Candidate ${i}`,
        link: `https://linkedin.com/in/candidate-${i}`,
      }));
      vertexSearchService.search.mockResolvedValue(items);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
        usage: null,
      });

      await service.search('role-1', role, 'user-1', 'Jane Admin');

      expect(geminiService.formatCandidates).toHaveBeenCalledTimes(3);
      expect(geminiService.formatCandidates).toHaveBeenNthCalledWith(
        1,
        items.slice(0, 20),
        expect.anything(),
        { model: DEFAULT_REASONING_MODEL.model },
      );
      expect(geminiService.formatCandidates).toHaveBeenNthCalledWith(
        2,
        items.slice(20, 40),
        expect.anything(),
        { model: DEFAULT_REASONING_MODEL.model },
      );
      expect(geminiService.formatCandidates).toHaveBeenNthCalledWith(
        3,
        items.slice(40, 45),
        expect.anything(),
        { model: DEFAULT_REASONING_MODEL.model },
      );
    });

    it('does not call Gemini at all when there are no search results, but still stamps search_run_date once', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      vertexSearchService.search.mockResolvedValue([]);

      await service.search('role-1', role, 'user-1', 'Jane Admin');

      expect(geminiService.formatCandidates).not.toHaveBeenCalled();
      expect(prisma.role_filters.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.role_filters.updateMany).toHaveBeenCalledWith({
        where: { role_id: 'role-1', archived: false },
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
      vertexSearchService.search.mockResolvedValue(items);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
        usage: null,
      });

      await service.search('role-1', role, 'user-1', 'Jane Admin');

      expect(prisma.role_filters.updateMany).toHaveBeenCalledTimes(1);
    });

    it('merges GitHub results in with the Vertex results before formatting candidates', async () => {
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
      vertexSearchService.search.mockResolvedValue([googleItem]);
      githubSearchService.search.mockResolvedValue([githubItem]);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
        usage: null,
      });

      await service.search('role-1', role, 'user-1', 'Jane Admin');

      expect(githubSearchService.search).toHaveBeenCalledWith(
        expect.anything(),
      );
      expect(geminiService.formatCandidates).toHaveBeenCalledWith(
        [googleItem, githubItem],
        expect.anything(),
        { model: DEFAULT_REASONING_MODEL.model },
      );
    });

    it('records which engine found each candidate on the saved role_result', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      vertexSearchService.search.mockResolvedValue([
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
        usage: null,
      });
      prisma.candidate.create
        .mockResolvedValueOnce({ uid: 'candidate-google' })
        .mockResolvedValueOnce({ uid: 'candidate-github' });
      prisma.role_result.create
        .mockResolvedValueOnce({ uid: 'result-google' })
        .mockResolvedValueOnce({ uid: 'result-github' });

      await service.search('role-1', role, 'user-1', 'Jane Admin');

      const calls = prisma.role_result.create.mock.calls;
      expect(calls[0][0].data.sources).toEqual(['Vertex']);
      expect(calls[1][0].data.sources).toEqual(['GitHub']);
    });

    it('scores and saves existing database candidates alongside freshly-found ones', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      vertexSearchService.search.mockResolvedValue([]);

      const knownCandidate = { uid: 'known-1', skills: ['TypeScript'] };
      existingCandidateSearchService.findCandidates.mockResolvedValue([
        knownCandidate,
      ] as any);
      candidateScoringService.scoreCandidate.mockReturnValue({
        score: 72,
        rawScore: 72,
        disqualified: false,
        missedNonNegotiables: [],
        breakdown: [
          {
            category: 'skills',
            requirement: 'TypeScript',
            priority: 'ESSENTIAL' as const,
            nonNegotiable: false,
            weight: 80,
            earned: 57.6,
            applicable: true,
          },
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
        usage: null,
      });
      prisma.role_result.create.mockResolvedValue({ uid: 'result-known-1' });

      const results = await service.search(
        'role-1',
        role,
        'user-1',
        'Jane Admin',
      );

      expect(
        existingCandidateSearchService.findCandidates,
      ).toHaveBeenCalledWith('role-1', expect.anything());
      expect(geminiService.scoreKnownCandidates).toHaveBeenCalledWith(
        [knownCandidate],
        expect.anything(),
        { model: DEFAULT_REASONING_MODEL.model },
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
          pre_disqualification_score: null,
          disqualified_reasons: [],
          tokens_used: 60,
          sources: ['Database'],
          ai_platform: 'Gemini',
          ai_model: 'gemini-2.5-flash',
          metadata: expect.objectContaining({
            searchScore: expect.objectContaining({ score: 72 }),
          }),
        },
      });
      expect(results).toEqual([{ uid: 'result-known-1' }]);
    });

    it('does not call Gemini for existing candidates when the DB pool is empty', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      vertexSearchService.search.mockResolvedValue([]);
      existingCandidateSearchService.findCandidates.mockResolvedValue([]);

      await service.search('role-1', role, 'user-1', 'Jane Admin');

      expect(geminiService.scoreKnownCandidates).not.toHaveBeenCalled();
    });

    it('excludes disqualified or zero-scoring existing candidates before calling Gemini', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      vertexSearchService.search.mockResolvedValue([]);

      const zeroScoreCandidate = { uid: 'known-zero' };
      const disqualifiedCandidate = { uid: 'known-disqualified' };
      existingCandidateSearchService.findCandidates.mockResolvedValue([
        zeroScoreCandidate,
        disqualifiedCandidate,
      ] as any);
      candidateScoringService.scoreCandidate.mockImplementation(
        (_filters, candidate: any) =>
          candidate.uid === 'known-disqualified'
            ? {
                score: 0,
                rawScore: 90,
                disqualified: true,
                missedNonNegotiables: [
                  { category: 'skills', requirement: 'TypeScript' },
                ],
                breakdown: [],
              }
            : {
                score: 0,
                rawScore: 0,
                disqualified: false,
                missedNonNegotiables: [],
                breakdown: [],
              },
      );

      await service.search('role-1', role, 'user-1', 'Jane Admin');

      expect(geminiService.scoreKnownCandidates).not.toHaveBeenCalled();
    });

    it('ranks the existing-candidate pool by deterministic score and caps it at the batch size before calling Gemini', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      vertexSearchService.search.mockResolvedValue([]);

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
          rawScore: candidate.rank,
          disqualified: false,
          missedNonNegotiables: [],
          breakdown: [],
        }),
      );

      await service.search('role-1', role, 'user-1', 'Jane Admin');

      const [sentCandidates] = geminiService.scoreKnownCandidates.mock.calls[0];
      expect(sentCandidates).toHaveLength(20);
      expect(sentCandidates[0].uid).toBe('known-24');
      expect(sentCandidates[19].uid).toBe('known-5');
    });

    it('skips a known candidate whose uid Gemini did not return a match for', async () => {
      const role = buildRole();
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      vertexSearchService.search.mockResolvedValue([]);
      existingCandidateSearchService.findCandidates.mockResolvedValue([
        { uid: 'known-1' },
      ] as any);
      candidateScoringService.scoreCandidate.mockReturnValue({
        score: 50,
        rawScore: 50,
        disqualified: false,
        missedNonNegotiables: [],
        breakdown: [],
      });
      geminiService.scoreKnownCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 10,
        usage: null,
      });

      const results = await service.search(
        'role-1',
        role,
        'user-1',
        'Jane Admin',
      );

      expect(prisma.role_result.create).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('stamps the current non-archived filter set by role_id, not the filter_id captured when the search started (so a filter edit mid-search cannot land the stamp on a now-archived row)', async () => {
      const role = buildRole();
      // The filter set active when this search started.
      prisma.role_filters.findFirst.mockResolvedValue(
        buildStoredFilterSet({ uid: 'filter-stale' }),
      );
      vertexSearchService.search.mockResolvedValue([]);

      await service.search('role-1', role, 'user-1', 'Jane Admin');

      // Never targets the stale uid captured at the start of the search.
      expect(prisma.role_filters.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ uid: 'filter-stale' }),
        }),
      );
      expect(prisma.role_filters.updateMany).toHaveBeenCalledWith({
        where: { role_id: 'role-1', archived: false },
        data: {
          search_run_date: expect.any(Date),
          search_run_by: 'Jane Admin',
          search_run_by_id: 'user-1',
        },
      });
    });
  });

  describe('streamSearch', () => {
    it('merges GitHub results in with the Vertex results before formatting candidates', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      const googleItem = {
        title: 'Jane Doe',
        link: 'https://linkedin.com/in/jane',
      };
      const githubItem = {
        title: 'janedoe - GitHub',
        link: 'https://github.com/janedoe',
      };
      vertexSearchService.search.mockResolvedValue([googleItem]);
      githubSearchService.search.mockResolvedValue([githubItem]);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
        usage: null,
      });

      await collectEvents(
        service.streamSearch('role-1', 'user-1', 'Jane Admin'),
      );

      expect(geminiService.formatCandidates).toHaveBeenCalledWith(
        [googleItem, githubItem],
        expect.anything(),
        { model: DEFAULT_REASONING_MODEL.model },
      );
    });

    it('emits a progress event per batch and a final done event with every saved result', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      const items = Array.from({ length: 25 }, (_, i) => ({
        title: `Candidate ${i}`,
        link: `https://linkedin.com/in/candidate-${i}`,
      }));
      vertexSearchService.search.mockResolvedValue(items);
      geminiService.formatCandidates.mockResolvedValue({
        matches: [],
        tokensUsed: 0,
        usage: null,
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
      expect(prisma.role_filters.updateMany).toHaveBeenCalledTimes(1);
    });

    it("includes each batch's own saved candidates in its progress event, not just the counts", async () => {
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      vertexSearchService.search.mockResolvedValue([
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
        usage: null,
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
      vertexSearchService.search.mockResolvedValue([]);

      const events = await collectEvents(
        service.streamSearch('role-1', 'user-1', 'Jane Admin'),
      );

      expect(geminiService.formatCandidates).not.toHaveBeenCalled();
      expect(prisma.role_filters.updateMany).toHaveBeenCalledTimes(1);
      expect(events.some((e) => e.type === 'done')).toBe(true);
    });

    it('emits a searching-existing-candidates stage and includes those matches in the final result', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      vertexSearchService.search.mockResolvedValue([]);
      existingCandidateSearchService.findCandidates.mockResolvedValue([
        { uid: 'known-1' },
      ] as any);
      candidateScoringService.scoreCandidate.mockReturnValue({
        score: 60,
        rawScore: 60,
        disqualified: false,
        missedNonNegotiables: [],
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
        usage: null,
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

  describe('saved criterion expansions', () => {
    const expansions = {
      version: 1,
      generatedAt: '2026-11-06T09:00:00.000Z',
      model: 'gemini-2.5-flash',
      byCategory: {
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
      },
    };
    const savedFilterSet = () =>
      buildStoredFilterSet({ metadata: { criterionExpansions: expansions } });

    it('search() runs Vertex with the expansions saved on the filter set, without a new AI expansion', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(savedFilterSet());

      await service.search('role-1', buildRole(), 'user-1', 'Jane Admin');

      expect(vertexSearchService.search).toHaveBeenCalledWith(
        expect.anything(),
        'Fullstack Developer',
        expansions,
      );
      expect(geminiService.expandSearchTerms).not.toHaveBeenCalled();
    });

    it('streamSearch() runs Vertex with the same saved expansions, without a new AI expansion', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(savedFilterSet());

      await collectEvents(
        service.streamSearch('role-1', 'user-1', 'Jane Admin', 'Founder'),
      );

      expect(vertexSearchService.search).toHaveBeenCalledWith(
        expect.anything(),
        'Founder',
        expansions,
      );
      expect(geminiService.expandSearchTerms).not.toHaveBeenCalled();
    });

    it('falls back to the literal search when the saved metadata is not a valid expansion block', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(
        buildStoredFilterSet({
          metadata: { criterionExpansions: { ...expansions, version: 2 } },
        }),
      );

      await collectEvents(
        service.streamSearch('role-1', 'user-1', 'Jane Admin', 'Founder'),
      );

      expect(vertexSearchService.search).toHaveBeenCalledWith(
        expect.anything(),
        'Founder',
        null,
      );
    });
  });

  describe('deepSearchCandidate', () => {
    const emptyResearch = (
      candidate: Record<string, unknown> = {},
      usage: GeminiUsage | null = null,
    ) => ({
      summary: '',
      findings: [],
      identityConfidence: 'low' as const,
      identityReason: 'none',
      score: 0,
      reasoning: '',
      sources: [],
      searchQueries: [],
      candidate,
      verified: { record: null, qualifications: [] },
      usage,
    });

    beforeEach(() => {
      prisma.role_filters.findFirst.mockResolvedValue(buildStoredFilterSet());
      geminiService.researchCandidate.mockResolvedValue(emptyResearch());
    });

    it('returns the candidate unchanged when already enriched', async () => {
      const existing = buildCandidateRecord({ enriched_at: new Date() });
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(existing);

      const result = await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(geminiService.researchCandidate).not.toHaveBeenCalled();
      expect(prisma.candidate.update).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('re-runs the search even when already enriched if force is true', async () => {
      const existing = buildCandidateRecord({ enriched_at: new Date() });
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(existing);
      geminiService.researchCandidate.mockResolvedValue(
        emptyResearch({ email: 'jane@example.com' }),
      );
      const updated = buildCandidateRecord({ email: 'jane@example.com' });
      prisma.candidate.update.mockResolvedValue(updated);

      const result = await service.deepSearchCandidate(
        'candidate-1',
        'role-1',
        true,
      );

      expect(geminiService.researchCandidate).toHaveBeenCalled();
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

      expect(geminiService.researchCandidate).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('returns the candidate unchanged when there is no name to search on', async () => {
      const existing = buildCandidateRecord({
        first_name: null,
        last_name: null,
      });
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(existing);

      const result = await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(geminiService.researchCandidate).not.toHaveBeenCalled();
      expect(prisma.candidate.update).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('calls grounded research with the candidate name and LinkedIn url', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord({
          current_title: 'Engineer',
          current_company: 'Acme',
        }),
      );
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(geminiService.researchCandidate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          name: 'Jane Doe',
          headline: 'Engineer',
          company: 'Acme',
          linkedinUrl: 'https://www.linkedin.com/in/janedoe',
        }),
        { model: DEFAULT_REASONING_MODEL.model },
      );
    });

    it("adds each research run's Gemini usage to the result, keeping its scoring usage and match notes", async () => {
      const scoring = {
        inputTokens: 300,
        outputTokens: 40,
        totalTokens: 340,
        calls: 1,
      };
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord({
          role_results: [
            {
              uid: 'result-1',
              sources: [],
              metadata: {
                matchedBy: 'location',
                geminiUsage: {
                  scoring,
                  research: {
                    inputTokens: 1000,
                    outputTokens: 200,
                    totalTokens: 1200,
                    calls: 1,
                  },
                },
              },
            },
          ],
        }),
      );
      prisma.candidate.update.mockResolvedValue({});
      geminiService.researchCandidate.mockResolvedValue(
        emptyResearch(
          {},
          { inputTokens: 900, outputTokens: 100, totalTokens: 1000 },
        ),
      );

      await service.deepSearchCandidate('candidate-1', 'role-1', true);

      expect(prisma.role_result.update).toHaveBeenCalledWith({
        where: { uid: 'result-1' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            matchedBy: 'location',
            geminiUsage: {
              scoring,
              research: {
                inputTokens: 1900,
                outputTokens: 300,
                totalTokens: 2200,
                calls: 2,
              },
            },
          }),
        }),
      });
    });

    it('records no research usage when Gemini did not report it', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord({
          role_results: [{ uid: 'result-1', sources: [], metadata: null }],
        }),
      );
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1', true);

      const { data } = prisma.role_result.update.mock.calls[0][0];
      expect(data.metadata).not.toHaveProperty('geminiUsage');
    });

    it('uses a RocketReach profile found alongside: empty contact fields, title/employer/country facts, and the raw profile', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord({
          email: 'known@example.com',
          phone: null,
          rocketreach_profile_id: null,
          role_results: [{ uid: 'result-1', sources: [], metadata: null }],
        }),
      );
      prisma.candidate.update.mockResolvedValue({});
      const person = {
        id: 77,
        status: 'complete',
        current_title: 'Staff Engineer',
        current_employer: 'Initech',
        country_code: 'gb',
        recommended_email: 'jane@initech.com',
        phones: [{ number: '+44 20 0000 0000', recommended: true }],
      };

      await service.deepSearchCandidate('candidate-1', 'role-1', true, {
        rocketReach: Promise.resolve(person),
      });

      const candidateData = prisma.candidate.update.mock.calls[0][0].data;
      expect(candidateData).toMatchObject({
        rocketreach_profile_id: '77',
        phone: '+44 20 0000 0000',
        contact_info_last_updated: expect.any(Date),
      });
      // A stored email is never replaced.
      expect(candidateData).not.toHaveProperty('email');
      expect(
        prisma.role_result.update.mock.calls[0][0].data.metadata,
      ).toMatchObject({
        rocketReach: { profile: person, fetchedAt: expect.any(String) },
        researchEvidence: {
          titles: ['Staff Engineer'],
          companies: ['Initech'],
          countryCode: 'GB',
        },
      });
    });

    describe('re-scoring after research', () => {
      // The stored filter set has one ESSENTIAL skills row: React, Node.js.
      const verifiedNode = () => ({
        ...emptyResearch(),
        findings: [
          {
            fact: 'Builds Node.js services at Acme.',
            sourceUrl: 'https://acme.dev',
          },
        ],
        identityConfidence: 'high' as const,
        verified: { record: { skills: ['Node.js'] }, qualifications: [] },
      });
      const lastUpdate = () =>
        prisma.role_result.update.mock.calls.at(-1)[0].data;

      beforeEach(() => {
        prisma.candidate.update.mockResolvedValue({});
      });

      it("re-runs the fixed algorithm with research's verified facts, keeping the search score and marking changed rows", async () => {
        prisma.candidate.findUniqueOrThrow.mockResolvedValue(
          buildCandidateRecord({
            skills: ['React'],
            role_results: [
              { uid: 'result-1', sources: [], metadata: null, score: 40 },
            ],
          }),
        );
        geminiService.researchCandidate.mockResolvedValue(verifiedNode());

        await service.deepSearchCandidate('candidate-1', 'role-1', true);

        expect(lastUpdate()).toMatchObject({
          score: 80,
          disqualified: false,
          pre_disqualification_score: null,
          disqualified_reasons: [],
          ai_score: 0,
          metadata: {
            searchScore: {
              score: 40,
              rawScore: 40,
              disqualified: false,
              disqualifiedReasons: [],
            },
            searchEvidence: expect.objectContaining({ skills: ['React'] }),
            researchEvidence: expect.objectContaining({ skills: ['Node.js'] }),
          },
        });
        expect(
          prisma.role_result_score_breakdown.createMany,
        ).toHaveBeenCalledWith({
          data: [
            expect.objectContaining({
              category: 'skills',
              score: 80,
              metadata: expect.objectContaining({ researchBefore: 40 }),
            }),
          ],
        });
      });

      it('re-scores from the stored search snapshot on a re-run, so research never stacks', async () => {
        prisma.candidate.findUniqueOrThrow.mockResolvedValue(
          buildCandidateRecord({
            skills: ['React'],
            role_results: [
              { uid: 'result-1', sources: [], metadata: null, score: 40 },
            ],
          }),
        );
        geminiService.researchCandidate.mockResolvedValue(verifiedNode());
        await service.deepSearchCandidate('candidate-1', 'role-1', true);
        const first = lastUpdate();

        // The first run wrote Node.js onto the candidate record itself.
        prisma.candidate.findUniqueOrThrow.mockResolvedValue(
          buildCandidateRecord({
            skills: ['React', 'Node.js'],
            role_results: [
              {
                uid: 'result-1',
                sources: [],
                metadata: first.metadata,
                score: first.score,
              },
            ],
          }),
        );
        await service.deepSearchCandidate('candidate-1', 'role-1', true);
        const second = lastUpdate();
        expect(second.score).toBe(80);
        expect(second.metadata.searchScore).toEqual(first.metadata.searchScore);
        expect(second.metadata.searchEvidence).toEqual(
          first.metadata.searchEvidence,
        );

        // A run that finds nothing usable drops back to the search score.
        prisma.candidate.findUniqueOrThrow.mockResolvedValue(
          buildCandidateRecord({
            skills: ['React', 'Node.js'],
            role_results: [
              {
                uid: 'result-1',
                sources: [],
                metadata: second.metadata,
                score: second.score,
              },
            ],
          }),
        );
        geminiService.researchCandidate.mockResolvedValue(emptyResearch());
        await service.deepSearchCandidate('candidate-1', 'role-1', true);
        const third = lastUpdate();
        expect(third.score).toBe(40);
        expect(third.metadata).not.toHaveProperty('researchEvidence');
      });

      it('leaves the score as it was when research found nothing', async () => {
        prisma.candidate.findUniqueOrThrow.mockResolvedValue(
          buildCandidateRecord({
            skills: ['React'],
            role_results: [
              { uid: 'result-1', sources: [], metadata: null, score: 40 },
            ],
          }),
        );

        await service.deepSearchCandidate('candidate-1', 'role-1', true);

        expect(lastUpdate()).toMatchObject({
          score: 40,
          metadata: { searchScore: expect.objectContaining({ score: 40 }) },
        });
        const [{ data: rows }] =
          prisma.role_result_score_breakdown.createMany.mock.calls.at(-1);
        expect(rows[0].metadata).not.toHaveProperty('researchBefore');
      });

      it('re-applies the latest research when a later search re-scores the result', async () => {
        const filters = parseRoleFilters([buildFilterItem()] as any);
        const facts = scoringFactsOf(
          buildCandidateRecord({ skills: ['React'] }) as any,
        );
        const searchResult = new CandidateScoringService().scoreFacts(
          filters,
          facts,
        );
        prisma.role_result.findFirst.mockResolvedValue({
          uid: 'result-1',
          metadata: {
            findings: verifiedNode().findings,
            researchEvidence: { skills: ['Node.js'] },
          },
        });
        prisma.role_result.update.mockResolvedValue({ uid: 'result-1' });

        await (service as any).upsertRoleResult(
          'role-1',
          'filter-1',
          'candidate-1',
          {
            candidate: buildCandidateFields(),
            summary: 'Re-scored',
            reasoning: '',
            skills_matched: [],
            score: 60,
          },
          10,
          searchResult,
          'Vertex',
          null,
          { filters, facts },
        );

        expect(lastUpdate()).toMatchObject({
          score: 80,
          metadata: {
            searchScore: expect.objectContaining({ score: 40 }),
            researchEvidence: { skills: ['Node.js'] },
            findings: verifiedNode().findings,
          },
        });
      });
    });

    it('creates a synthesized current-role experience entry when enrichment finds the current role but no detailed history', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      geminiService.researchCandidate.mockResolvedValue(
        emptyResearch({
          current_company: 'Acme',
          current_title: 'Senior Engineer',
          current_role_start_date: '2021-03-01',
        }),
      );
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
      geminiService.researchCandidate.mockResolvedValue(
        emptyResearch({
          current_company: 'Acme',
          current_title: 'Senior Engineer',
          current_role_start_date: '2021-03-01',
          experience: [
            {
              company_name: 'Acme',
              role: 'Senior Engineer',
              start_date: '2021-03-01',
              skills: [],
            },
          ],
        }),
      );
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
      geminiService.researchCandidate.mockResolvedValue(
        emptyResearch({ email: 'jane@example.com' }),
      );
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
      geminiService.researchCandidate.mockResolvedValue(
        emptyResearch({ email: 'jane@example.com', current_company: 'NewCo' }),
      );
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
      geminiService.researchCandidate.mockResolvedValue(
        emptyResearch({ skills: ['TypeScript', 'NestJS'] }),
      );
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
      geminiService.researchCandidate.mockResolvedValue(
        emptyResearch({
          sources: [
            {
              title: 'Jane Doe - GitHub',
              source: 'GitHub',
              url: 'https://github.com/janedoe',
              main: false,
              type: 'SEARCH',
            },
          ],
        }),
      );
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
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate_source.createMany).not.toHaveBeenCalled();
    });

    it('creates candidate_experience rows only for entries with a start_date', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      geminiService.researchCandidate.mockResolvedValue(
        emptyResearch({
          experience: [
            {
              company_name: 'TechCorp',
              role: 'Engineer',
              start_date: '2021-01-01',
              skills: [],
            },
            { company_name: 'NoDateCo', role: 'Intern', skills: [] },
          ],
        }),
      );
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
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate_experience.createMany).not.toHaveBeenCalled();
    });

    it('creates candidate_education rows only for entries with a start_date', async () => {
      prisma.candidate.findUniqueOrThrow.mockResolvedValue(
        buildCandidateRecord(),
      );
      geminiService.researchCandidate.mockResolvedValue(
        emptyResearch({
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
        }),
      );
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
      prisma.candidate.update.mockResolvedValue({});

      await service.deepSearchCandidate('candidate-1', 'role-1');

      expect(prisma.candidate_education.createMany).not.toHaveBeenCalled();
    });
  });

  describe('runSearchPage', () => {
    const items = (count: number, from = 0) =>
      Array.from({ length: count }, (_, i) => ({
        title: `Candidate ${from + i}`,
        link: `https://linkedin.com/in/candidate-${from + i}`,
        page: 1,
      }));
    const nextToken = encodeSearchPageToken({
      kind: 'single',
      page: 2,
      token: 'vertex-2',
      seen: ['abcdefgh'],
    })!;
    const progressOf = (pagesLoaded: number, token: string | null) => ({
      searchProgress: {
        version: 1,
        pagesLoaded,
        nextPageToken: token,
        estimatedTotal: 1240,
        status: 'running',
        error: null,
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
    });
    const withMetadata = (metadata: Record<string, unknown>) => {
      prisma.role_filters.findFirst.mockResolvedValue(
        buildStoredFilterSet({ metadata }),
      );
      prisma.role_filters.findUnique.mockResolvedValue({ metadata });
    };
    const run = (
      hooks: Parameters<SearchService['runSearchPage']>[5] = {},
      roleName?: string,
    ) => {
      const events: SearchPageStageEvent[] = [];
      const outcome = service.runSearchPage(
        'role-1',
        'filter-1',
        'user-1',
        'Jane Admin',
        roleName,
        {
          ...hooks,
          onStage: (event) => {
            events.push(event);
          },
        },
      );
      return { events, outcome };
    };
    const stages = (events: SearchPageStageEvent[]) =>
      events.map((e) => `${e.stage}:${e.status}`);
    const savedMetadata = () =>
      prisma.role_filters.update.mock.calls[0][0].data.metadata;

    it('runs page 1 with existing candidates and GitHub, scores in batches of 10 and saves the resume token', async () => {
      withMetadata({ criterionExpansions: null });
      vertexSearchService.searchRolePage.mockResolvedValue({
        items: items(20),
        page: 1,
        nextPageToken: nextToken,
        estimatedTotal: 1240,
        skippedDuplicates: 3,
        filteredOutByLocation: 2,
      });
      githubSearchService.search.mockResolvedValue(items(5, 20));

      const { events, outcome } = run({}, 'Fullstack Developer');

      expect(await outcome).toEqual({
        kind: 'done',
        page: 1,
        hasMore: true,
        estimatedTotal: 1240,
        saved: 0,
        tokensUsed: 0,
      });
      expect(vertexSearchService.searchRolePage).toHaveBeenCalledWith(
        expect.anything(),
        'Fullstack Developer',
        null,
        undefined,
      );
      expect(existingCandidateSearchService.findCandidates).toHaveBeenCalled();
      expect(geminiService.formatCandidates).toHaveBeenCalledTimes(3);
      expect(stages(events)).toEqual([
        'preparing:started',
        'preparing:done',
        'searching:started',
        'searching:done',
        'scoring:started',
        'scoring:progress',
        'scoring:progress',
        'scoring:progress',
        'ranking:started',
        'ranking:done',
      ]);
      expect(events[3]).toEqual({
        stage: 'searching',
        status: 'done',
        page: 1,
        found: 25,
        estimatedTotal: 1240,
        skippedDuplicates: 3,
      });
      expect(savedMetadata()).toEqual({
        criterionExpansions: null,
        searchProgress: expect.objectContaining({
          version: 1,
          pagesLoaded: 1,
          nextPageToken: nextToken,
          estimatedTotal: 1240,
        }),
      });
      expect(prisma.role_filters.updateMany).toHaveBeenCalledTimes(1);
    });

    it('continues from the stored token without re-running existing candidates or GitHub', async () => {
      withMetadata(progressOf(3, nextToken));
      vertexSearchService.searchRolePage.mockResolvedValue({
        items: items(4),
        page: 4,
        nextPageToken: undefined,
        skippedDuplicates: 0,
        filteredOutByLocation: 0,
      });

      const { outcome } = run();

      expect(await outcome).toEqual(
        expect.objectContaining({ kind: 'done', page: 4, hasMore: false }),
      );
      expect(vertexSearchService.searchRolePage).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        null,
        parseSearchPageToken(nextToken),
      );
      expect(
        existingCandidateSearchService.findCandidates,
      ).not.toHaveBeenCalled();
      expect(githubSearchService.search).not.toHaveBeenCalled();
      expect(savedMetadata().searchProgress).toEqual(
        expect.objectContaining({
          pagesLoaded: 4,
          nextPageToken: null,
          // Vertex gave no estimate this time, so the last one is kept.
          estimatedTotal: 1240,
          // The job, not the page, decides how the run ends.
          status: 'running',
        }),
      );
    });

    it('starts at page 1 when progress was reset to nothing loaded', async () => {
      withMetadata(progressOf(0, null));

      const { outcome } = run();

      expect(await outcome).toEqual(
        expect.objectContaining({ kind: 'done', page: 1 }),
      );
      expect(vertexSearchService.searchRolePage).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        null,
        undefined,
      );
      expect(existingCandidateSearchService.findCandidates).toHaveBeenCalled();
    });

    it('does no search work once every page is loaded', async () => {
      withMetadata(progressOf(5, null));

      const { events, outcome } = run();

      expect(await outcome).toEqual({
        kind: 'done',
        page: 5,
        hasMore: false,
        estimatedTotal: 1240,
        saved: 0,
        tokensUsed: 0,
      });
      expect(events).toEqual([]);
      expect(vertexSearchService.searchRolePage).not.toHaveBeenCalled();
      expect(prisma.role_filters.update).not.toHaveBeenCalled();
    });

    it('stops before the next batch when asked, leaving the token where it was', async () => {
      withMetadata(progressOf(1, nextToken));
      vertexSearchService.searchRolePage.mockResolvedValue({
        items: items(20),
        page: 2,
        nextPageToken: 'later',
        skippedDuplicates: 0,
        filteredOutByLocation: 0,
      });
      let stop = false;
      geminiService.formatCandidates.mockImplementation(() => {
        stop = true;
        return Promise.resolve({ matches: [], tokensUsed: 0, usage: null });
      });

      const { outcome } = run({ shouldStop: () => Promise.resolve(stop) });

      expect(await outcome).toEqual({ kind: 'stopped' });
      expect(geminiService.formatCandidates).toHaveBeenCalledTimes(1);
      expect(prisma.role_filters.update).not.toHaveBeenCalled();
      expect(prisma.role_filters.updateMany).not.toHaveBeenCalled();
    });

    it('does nothing for a job whose filter set has been replaced', async () => {
      withMetadata({});

      const outcome = await service.runSearchPage(
        'role-1',
        'filter-old',
        'user-1',
        'Jane Admin',
        undefined,
      );

      expect(outcome).toEqual({ kind: 'superseded' });
      expect(vertexSearchService.searchRolePage).not.toHaveBeenCalled();
    });

    it('reports saved existing candidates by id as they land, and counts them and their tokens when done', async () => {
      withMetadata({});
      existingCandidateSearchService.findCandidates.mockResolvedValue([
        { uid: 'known-1' },
      ] as any);
      candidateScoringService.scoreCandidate.mockReturnValue({
        score: 60,
        rawScore: 60,
        disqualified: false,
        missedNonNegotiables: [],
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
        usage: null,
      });
      prisma.role_result.create.mockResolvedValue({
        uid: 'result-known-1',
        tokens_used: 20,
      });

      const { events, outcome } = run();

      expect(await outcome).toEqual(
        expect.objectContaining({ saved: 1, tokensUsed: 20 }),
      );
      expect(events[1]).toEqual({
        stage: 'preparing',
        status: 'done',
        page: 1,
        savedIds: ['result-known-1'],
      });
    });

    it('throws when the role has no filter set', async () => {
      prisma.role_filters.findFirst.mockResolvedValue(null);

      await expect(run().outcome).rejects.toThrow('Role filter not found');
    });
  });

  describe('saveSearchProgress', () => {
    it('patches the stored progress and keeps the rest of the metadata', async () => {
      prisma.role_filters.findUnique.mockResolvedValue({
        metadata: {
          criterionExpansions: null,
          searchProgress: {
            version: 1,
            pagesLoaded: 2,
            nextPageToken: 's1.next',
            estimatedTotal: 300,
            status: 'running',
            error: null,
            updatedAt: '2026-11-17T10:00:00.000Z',
          },
        },
      });

      const saved = await service.saveSearchProgress('filter-1', {
        status: 'paused',
      });

      expect(saved).toEqual(
        expect.objectContaining({
          pagesLoaded: 2,
          nextPageToken: 's1.next',
          status: 'paused',
        }),
      );
      expect(prisma.role_filters.update).toHaveBeenCalledWith({
        where: { uid: 'filter-1' },
        data: {
          metadata: { criterionExpansions: null, searchProgress: saved },
        },
      });
    });
  });
});
