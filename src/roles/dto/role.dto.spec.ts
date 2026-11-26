import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  UpdateRoleDto,
  RoleFilterChildResponseDto,
  RoleFilterResponseDto,
  RoleResultScoreBreakdownDto,
  RoleResultSummaryDto,
} from './role.dto';

describe('RoleFilterChildResponseDto', () => {
  it('serializes the boolean column into boolean_value', () => {
    const result = plainToInstance(
      RoleFilterChildResponseDto,
      {
        uid: 'child-1',
        title: 'remote_work',
        value: null,
        list_value: [],
        boolean: true,
      },
      { excludeExtraneousValues: true },
    );
    expect(result.boolean_value).toBe(true);
  });
});

describe('RoleResultSummaryDto', () => {
  it('serializes disqualified on RoleResultSummaryDto', () => {
    const result = plainToInstance(
      RoleResultSummaryDto,
      {
        uid: 'result-1',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        disqualified: true,
      },
      { excludeExtraneousValues: true },
    );
    expect(result.disqualified).toBe(true);
  });
});

describe('RoleResultScoreBreakdownDto', () => {
  it('serializes role_filter_id on RoleResultScoreBreakdownDto', () => {
    const result = plainToInstance(
      RoleResultScoreBreakdownDto,
      {
        uid: 'breakdown-1',
        category: 'skills',
        weight: 80,
        applicable: true,
        score: 80,
        role_filter_id: 'filter-1',
      },
      { excludeExtraneousValues: true },
    );
    expect(result.role_filter_id).toBe('filter-1');
  });

  it('exposes the criterion a row scored, or null on older rows', () => {
    const criterion = {
      requirement: 'CA(SA)',
      priority: 'ESSENTIAL',
      nonNegotiable: true,
    };
    const [scored, legacy] = [criterion, null].map((metadata) =>
      plainToInstance(
        RoleResultScoreBreakdownDto,
        { uid: 'b', category: 'education', weight: 40, score: 0, metadata },
        { excludeExtraneousValues: true },
      ),
    );

    expect(scored.metadata).toEqual(criterion);
    expect(legacy.metadata).toBeNull();
  });
});

describe('RoleFilterResponseDto metadata and work types', () => {
  const metadata = {
    criterionExpansions: {
      version: 1,
      generatedAt: '2026-11-01T10:00:00.000Z',
      model: 'gemini-3.5-flash',
      byCategory: {
        job_titles: [{ seed: 'founder', terms: ['founder', 'co-founder'] }],
      },
    },
  };
  const serialize = (items: unknown[]) =>
    plainToInstance(
      RoleFilterResponseDto,
      {
        uid: 'filter-1',
        created: '2026-11-15T10:00:00.000Z',
        updated: '2026-11-15T10:00:00.000Z',
        archived: false,
        metadata,
        secret: 'not exposed',
        role_filter_items: items,
      },
      { excludeExtraneousValues: true, enableImplicitConversion: true },
    );

  it('passes metadata, criterionExpansions included, through untouched', () => {
    const result = serialize([]);

    expect(result.metadata).toEqual(metadata);
    expect(result).not.toHaveProperty('secret');
  });

  it('exposes work_types on location rows, from the child or the legacy flag', () => {
    const result = serialize([
      {
        uid: 'a',
        category: 'location',
        priority: 'ESSENTIAL',
        non_negotiable: false,
        list_value: [],
        children: [
          {
            uid: 'c1',
            title: 'work_types',
            list_value: ['HYBRID', 'ONSITE'],
            boolean: false,
          },
        ],
      },
      {
        uid: 'b',
        category: 'location',
        priority: 'ESSENTIAL',
        non_negotiable: false,
        list_value: [],
        children: [
          { uid: 'c2', title: 'remote_work', list_value: [], boolean: true },
        ],
      },
      {
        uid: 'c',
        category: 'skills',
        priority: 'ESSENTIAL',
        non_negotiable: false,
        list_value: ['Go'],
        children: [],
      },
    ]);

    expect(result.role_filter_items.map((item) => item.work_types)).toEqual([
      ['ONSITE', 'HYBRID'],
      ['ONSITE', 'REMOTE'],
      [],
    ]);
  });
});

describe('search paging fields', () => {
  it('hides the resume token on the filter set and says whether more pages exist', () => {
    const result = plainToInstance(
      RoleFilterResponseDto,
      {
        uid: 'filter-1',
        role_filter_items: [],
        metadata: {
          searchProgress: {
            version: 1,
            pagesLoaded: 2,
            nextPageToken: 's1.secret',
            estimatedTotal: 300,
            status: 'paused',
            error: null,
            updatedAt: '2026-11-17T10:00:00.000Z',
          },
        },
      },
      { excludeExtraneousValues: true },
    );

    expect(result.metadata).toEqual({
      searchProgress: {
        pagesLoaded: 2,
        hasMore: true,
        estimatedTotal: 300,
        status: 'paused',
        error: null,
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
    });
  });

  it('exposes the page a result was found on and its match notes', () => {
    const result = plainToInstance(
      RoleResultSummaryDto,
      {
        uid: 'result-1',
        page: 3,
        metadata: { matchedBy: 'remote', missing: ['Afrikaans'] },
        tokens_used: 12,
      },
      { excludeExtraneousValues: true },
    );

    expect(result.page).toBe(3);
    expect(result.metadata).toEqual({
      matchedBy: 'remote',
      missing: ['Afrikaans'],
    });
  });

  it('exposes why a result was disqualified and its score before that', () => {
    const result = plainToInstance(
      RoleResultSummaryDto,
      {
        uid: 'result-1',
        score: 0,
        disqualified: true,
        pre_disqualification_score: 64,
        disqualified_reasons: ['CA(SA)'],
      },
      { excludeExtraneousValues: true },
    );

    expect(result.pre_disqualification_score).toBe(64);
    expect(result.disqualified_reasons).toEqual(['CA(SA)']);
  });

  it('exposes the Gemini usage recorded for a result, and the legacy tokens_used share', () => {
    const geminiUsage = {
      scoring: {
        inputTokens: 500,
        outputTokens: 80,
        totalTokens: 580,
        calls: 1,
      },
      research: {
        inputTokens: 1800,
        outputTokens: 950,
        totalTokens: 2750,
        calls: 1,
      },
    };
    const result = plainToInstance(
      RoleResultSummaryDto,
      { uid: 'result-1', tokens_used: 580, metadata: { geminiUsage } },
      { excludeExtraneousValues: true },
    );

    expect(result.metadata?.geminiUsage).toEqual(geminiUsage);
    expect(result.tokens_used).toBe(580);
  });

  it('exposes the search-time score and research markers, but not the scoring snapshots or the raw RocketReach profile', () => {
    const searchScore = {
      score: 74,
      rawScore: 74,
      disqualified: false,
      disqualifiedReasons: [],
    };
    const result = plainToInstance(
      RoleResultSummaryDto,
      {
        uid: 'result-1',
        score: 86,
        metadata: {
          matchedBy: 'location',
          searchScore,
          searchEvidence: { skills: ['React'] },
          researchEvidence: { skills: ['Node.js'] },
          rocketReach: { profile: { id: 1, emails: [] } },
        },
        score_breakdown: [
          {
            uid: 'row-1',
            category: 'skills',
            weight: 80,
            applicable: true,
            score: 80,
            metadata: {
              requirement: 'React, Node.js',
              priority: 'ESSENTIAL',
              nonNegotiable: false,
              researchBefore: 40,
            },
          },
        ],
      },
      { excludeExtraneousValues: true },
    );

    expect(result.metadata).toEqual({ matchedBy: 'location', searchScore });
    expect(result.score_breakdown?.[0].metadata?.researchBefore).toBe(40);
  });

  it("exposes Gemini's ai_score alongside the deterministic score", () => {
    const result = plainToInstance(
      RoleResultSummaryDto,
      { uid: 'result-1', score: 64, ai_score: 72 },
      { excludeExtraneousValues: true },
    );

    expect(result.score).toBe(64);
    expect(result.ai_score).toBe(72);
  });

  it('exposes deep research findings and identity confidence in the match notes', () => {
    const research = {
      findings: [{ fact: 'Speaks on IFRS 17', sourceUrl: 'https://x.dev' }],
      identityConfidence: 'high',
      identityReason: 'Same employer as LinkedIn',
    };
    const result = plainToInstance(
      RoleResultSummaryDto,
      { uid: 'result-1', metadata: { missing: ['Afrikaans'], ...research } },
      { excludeExtraneousValues: true },
    );

    expect(result.metadata).toEqual(
      expect.objectContaining({ missing: ['Afrikaans'], ...research }),
    );
  });
});

describe('UpdateRoleDto', () => {
  const errorsFor = async (body: object) =>
    (await validate(plainToInstance(UpdateRoleDto, body))).map(
      (e) => e.property,
    );

  it('accepts a trimmed name up to 80 and a description up to 500', async () => {
    expect(
      await errorsFor({
        name: `  ${'a'.repeat(80)}  `,
        description: 'd'.repeat(500),
        location: 'Cape Town, ZA',
        seniority: 'Senior',
        hiring_manager: 'Kyle Winter',
      }),
    ).toEqual([]);
  });

  it('rejects a blank name, an 81-character name and a 501-character description', async () => {
    expect(await errorsFor({ name: '   ' })).toEqual(['name']);
    expect(await errorsFor({ name: 'a'.repeat(81) })).toEqual(['name']);
    expect(await errorsFor({ description: 'd'.repeat(501) })).toEqual([
      'description',
    ]);
  });
});
