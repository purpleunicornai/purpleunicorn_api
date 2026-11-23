import {
  CandidateScoringService,
  ScoringFacts,
} from './candidate-scoring.service';
import {
  combineResearchFacts,
  legacyQualifications,
  mergeFacts,
  rocketReachFactsOf,
  rescoreWithResearch,
  researchFactsOf,
} from './research-rescore';
import { ParsedRoleFilters } from './role-filter-parser';
import type {
  CandidateResearch,
  ResearchRecord,
} from '../../services/gemini/gemini.service';

const scorer = new CandidateScoringService();

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

function buildFacts(overrides: Partial<ScoringFacts> = {}): ScoringFacts {
  return {
    skills: [],
    languages: [],
    titles: [],
    companies: [],
    institutions: [],
    qualificationTexts: [],
    countryCode: null,
    openToRelocation: null,
    openToRemote: null,
    workAuthorization: null,
    experienceYears: null,
    ...overrides,
  };
}

function buildResearch({
  record = {},
  qualifications = [],
  findings = ['Leads the payments team at Monzo.'],
  identityConfidence = 'high',
}: {
  record?: ResearchRecord | null;
  qualifications?: string[];
  findings?: string[];
  identityConfidence?: CandidateResearch['identityConfidence'];
} = {}): CandidateResearch {
  return {
    summary: '',
    findings: findings.map((fact) => ({
      fact,
      sourceUrl: 'https://example.com',
    })),
    identityConfidence,
    identityReason: '',
    score: 70,
    reasoning: '',
    sources: [],
    searchQueries: [],
    // The search-profile-seeded record: never scoring evidence.
    candidate: { skills: ['Seeded from the search profile'] },
    verified: { record, qualifications },
    usage: null,
  };
}

const skillsRow = {
  value: ['TypeScript', 'Kafka'],
  priority: 'ESSENTIAL' as const,
  nonNegotiable: false,
};

describe('researchFactsOf', () => {
  it('uses nothing when research could not tie its findings to this person', () => {
    expect(
      researchFactsOf(
        buildResearch({
          record: { skills: ['Kafka'] },
          identityConfidence: 'low',
        }),
      ),
    ).toBeNull();
  });

  it("reads research's own structured output and cited findings, not the seeded record", () => {
    const facts = researchFactsOf(
      buildResearch({
        record: {
          skills: ['Kafka'],
          current_company: 'Monzo',
          experience: [{ company_name: 'Revolut', role: 'Engineer' }],
        },
        qualifications: ['CA(SA)'],
        findings: ['Qualified as a chartered accountant in 2015.'],
      }),
    );

    expect(facts?.skills).toEqual(['Kafka']);
    expect(facts?.companies).toEqual(['Monzo', 'Revolut']);
    expect(facts?.qualificationTexts).toEqual([
      'CA(SA)',
      'Qualified as a chartered accountant in 2015.',
    ]);
    // Scalars research didn't state are left to the search evidence.
    expect(facts).not.toHaveProperty('countryCode');
    expect(facts).not.toHaveProperty('experienceYears');
  });
});

describe('mergeFacts', () => {
  it('unions lists without duplicates and lets stated scalars replace search values', () => {
    const merged = mergeFacts(
      buildFacts({ skills: ['TypeScript'], countryCode: 'ZA' }),
      { skills: ['typescript', 'Kafka'], experienceYears: 6 },
    );

    expect(merged.skills).toEqual(['TypeScript', 'Kafka']);
    expect(merged.countryCode).toBe('ZA');
    expect(merged.experienceYears).toBe(6);
  });
});

describe('rescoreWithResearch', () => {
  it('lifts the score when research verifies a missing skill, and marks that row', () => {
    const filters = buildFilters({ skills: [skillsRow] });
    const { search, final, researchBefore } = rescoreWithResearch(
      scorer,
      filters,
      buildFacts({ skills: ['TypeScript'] }),
      researchFactsOf(buildResearch({ record: { skills: ['Kafka'] } })),
    );

    expect(search.score).toBe(40);
    expect(final.score).toBe(80);
    expect(researchBefore).toEqual([40]);
  });

  it('lowers the score when research finds fewer years of experience than the snippet', () => {
    const filters = buildFilters({
      skills: [skillsRow],
      experience: {
        value: { minYears: 8 },
        priority: 'ESSENTIAL',
        nonNegotiable: false,
      },
    });
    const { search, final, researchBefore } = rescoreWithResearch(
      scorer,
      filters,
      buildFacts({ skills: ['TypeScript', 'Kafka'], experienceYears: 10 }),
      researchFactsOf(buildResearch({ record: { experience_years: 4 } })),
    );

    expect(search.score).toBe(80);
    expect(final.score).toBe(60);
    // Only the experience row changed.
    expect(researchBefore).toEqual([null, 40]);
  });

  it('clears a non-negotiable disqualification when research confirms the qualification', () => {
    const filters = buildFilters({
      skills: [skillsRow],
      education: [
        {
          value: {
            qualifications: ['CA(SA)'],
            institutions: [],
            institutionType: 'include',
          },
          priority: 'ESSENTIAL',
          nonNegotiable: true,
        },
      ],
    });
    const { search, final } = rescoreWithResearch(
      scorer,
      filters,
      buildFacts({ skills: ['TypeScript', 'Kafka'] }),
      researchFactsOf(
        buildResearch({ findings: ['Qualified as a CA(SA) with SAICA.'] }),
      ),
    );

    expect(search).toMatchObject({
      disqualified: true,
      score: 0,
      rawScore: 40,
    });
    expect(final).toMatchObject({
      disqualified: false,
      score: 80,
      missedNonNegotiables: [],
    });
  });

  it('newly disqualifies when research places them outside a non-negotiable country', () => {
    const filters = buildFilters({
      skills: [skillsRow],
      location: {
        value: {
          countryCode: 'ZA',
          regions: [],
          remoteWork: false,
          workAuthorizationRequired: false,
        },
        priority: 'ESSENTIAL',
        nonNegotiable: true,
      },
    });
    const { search, final, researchBefore } = rescoreWithResearch(
      scorer,
      filters,
      buildFacts({ skills: ['TypeScript', 'Kafka'], countryCode: 'ZA' }),
      researchFactsOf(
        buildResearch({ record: { current_location_country_code: 'GB' } }),
      ),
    );

    expect(search).toMatchObject({ disqualified: false, score: 80 });
    expect(final).toMatchObject({
      disqualified: true,
      score: 0,
      rawScore: 40,
      missedNonNegotiables: [
        { category: 'location', requirement: 'based in ZA' },
      ],
    });
    expect(researchBefore).toEqual([null, 40]);
  });

  it('is idempotent: re-running scores search evidence plus only the latest research', () => {
    const filters = buildFilters({ skills: [skillsRow] });
    const searchFacts = buildFacts({ skills: ['TypeScript'] });
    const first = researchFactsOf(
      buildResearch({ record: { skills: ['Kafka'] } }),
    );

    const once = rescoreWithResearch(scorer, filters, searchFacts, first);
    const twice = rescoreWithResearch(scorer, filters, searchFacts, first);
    expect(twice).toEqual(once);

    // A later run that no longer finds Kafka drops back; nothing stacks.
    const later = rescoreWithResearch(
      scorer,
      filters,
      searchFacts,
      researchFactsOf(buildResearch({ record: { skills: ['Go'] } })),
    );
    expect(later.final.score).toBe(40);
    expect(later.researchBefore).toEqual([null]);
  });

  it('changes nothing when research only restates the search evidence', () => {
    const filters = buildFilters({ skills: [skillsRow] });
    const searchFacts = buildFacts({
      skills: ['TypeScript'],
      countryCode: 'ZA',
    });
    const { search, final, researchBefore } = rescoreWithResearch(
      scorer,
      filters,
      searchFacts,
      researchFactsOf(
        buildResearch({
          record: {
            skills: ['typescript'],
            current_location_country_code: 'ZA',
          },
        }),
      ),
    );

    expect(final).toEqual(search);
    expect(researchBefore).toEqual([null]);
  });

  it('keeps the search score when research found nothing usable', () => {
    const filters = buildFilters({ skills: [skillsRow] });
    const { search, final } = rescoreWithResearch(
      scorer,
      filters,
      buildFacts({ skills: ['TypeScript'] }),
      researchFactsOf(
        buildResearch({ findings: [], identityConfidence: 'low' }),
      ),
    );

    expect(final).toBe(search);
  });
});

describe('legacyQualifications', () => {
  it('counts qualifications from education rows that earned full credit at search time', () => {
    expect(
      legacyQualifications([
        {
          category: 'education',
          weight: 27,
          score: 27,
          metadata: { requirement: 'CA(SA), BCom' },
        },
        {
          category: 'education',
          weight: 27,
          score: 0,
          metadata: { requirement: 'CFA' },
        },
        {
          category: 'skills',
          weight: 27,
          score: 27,
          metadata: { requirement: 'Excel' },
        },
      ]),
    ).toEqual(['CA(SA)', 'BCom']);
  });
});

describe('RocketReach facts', () => {
  const person = {
    id: 1,
    status: 'complete',
    current_title: 'Head of Finance',
    current_employer: 'Acme',
    job_history: [{ company_name: 'Acme' }, { company: 'Globex' }, {}],
    country_code: 'gb',
    emails: [{ email: 'jane@acme.com' }],
    skills: ['Excel'],
  };

  it('takes title, employers and country only', () => {
    expect(rocketReachFactsOf(person)).toEqual({
      titles: ['Head of Finance'],
      companies: ['Acme', 'Globex'],
      countryCode: 'GB',
    });
    expect(rocketReachFactsOf(undefined)).toBeNull();
  });

  it('adds to research’s lists and fills only the scalars research left unsaid', () => {
    const combined = combineResearchFacts(
      { titles: ['CFO'], companies: ['acme'], countryCode: 'ZA' },
      rocketReachFactsOf(person),
    );

    expect(combined).toEqual({
      titles: ['CFO', 'Head of Finance'],
      companies: ['acme', 'Globex'],
      countryCode: 'ZA',
    });
    expect(combineResearchFacts({ titles: [] }, { countryCode: 'GB' })).toEqual(
      { titles: [], countryCode: 'GB' },
    );
  });

  it('stands alone when research couldn’t confirm the person', () => {
    expect(combineResearchFacts(null, rocketReachFactsOf(person))).toEqual(
      rocketReachFactsOf(person),
    );
    expect(combineResearchFacts(null, null)).toBeNull();
  });
});
