import { z } from 'zod';
import type { CandidateResearch } from '../../services/gemini/gemini.service';
import type { RocketReachPerson } from '../../services/rocket-reach/rocket-reach.service';
import type {
  CandidateScoreCategory,
  CandidateScoreResult,
  CandidateScoringService,
  ScoringFacts,
} from './candidate-scoring.service';
import type { ParsedRoleFilters } from './role-filter-parser';

// Facts deep research verified. A missing key means research didn't say, so
// the search-time value stands.
export type ResearchFacts = Partial<ScoringFacts>;

// The fixed algorithm's result from search evidence alone, kept so the UI
// can say "Updated after research, was 74".
export type SearchScore = {
  score: number;
  rawScore: number;
  disqualified: boolean;
  disqualifiedReasons: string[];
};

const scoringFactsSchema = z.object({
  skills: z.array(z.string()),
  languages: z.array(z.string()),
  titles: z.array(z.string()),
  companies: z.array(z.string()),
  institutions: z.array(z.string()),
  qualificationTexts: z.array(z.string()),
  countryCode: z.string().nullable(),
  openToRelocation: z.boolean().nullable(),
  openToRemote: z.boolean().nullable(),
  workAuthorization: z.string().nullable(),
  experienceYears: z.number().nullable(),
}) satisfies z.ZodType<ScoringFacts>;

const searchScoreSchema = z.object({
  score: z.number(),
  rawScore: z.number(),
  disqualified: z.boolean(),
  disqualifiedReasons: z.array(z.string()),
}) satisfies z.ZodType<SearchScore>;

export const parseScoringFacts = (value: unknown): ScoringFacts | null =>
  scoringFactsSchema.safeParse(value).data ?? null;

export const parseResearchFacts = (value: unknown): ResearchFacts | null =>
  scoringFactsSchema.partial().safeParse(value).data ?? null;

export const parseSearchScore = (value: unknown): SearchScore | null =>
  searchScoreSchema.safeParse(value).data ?? null;

export const searchScoreOf = (result: CandidateScoreResult): SearchScore => ({
  score: result.score,
  rawScore: result.rawScore,
  disqualified: result.disqualified,
  disqualifiedReasons: result.missedNonNegotiables.map(
    (missed) => missed.requirement,
  ),
});

const isText = (value: string | null | undefined): value is string =>
  !!value?.trim();

// Only what research's own structured output states (never the search
// profile it was seeded with), and nothing when research couldn't tie its
// findings to this person: a low-confidence match may be someone else.
export function researchFactsOf(
  research: CandidateResearch,
): ResearchFacts | null {
  if (research.identityConfidence === 'low') return null;
  const record = research.verified.record;
  const experience = record?.experience ?? [];
  const education = record?.education ?? [];

  const facts: ResearchFacts = {
    skills: (record?.skills ?? []).filter(isText),
    languages: (record?.languages ?? []).filter(isText),
    titles: [record?.current_title].filter(isText),
    companies: [
      record?.current_company,
      ...experience.map((entry) => entry.company_name),
    ].filter(isText),
    institutions: education
      .map((entry) => entry.institution_name)
      .filter(isText),
    // Cited findings count here only: "Qualified as CA(SA) in 2015" is
    // evidence of the designation, matched the same way a headline is.
    qualificationTexts: [
      ...research.verified.qualifications,
      ...education.flatMap((entry) => [entry.degree, entry.field_of_study]),
      record?.current_title,
      ...research.findings.map((finding) => finding.fact),
    ].filter(isText),
  };
  if (isText(record?.current_location_country_code)) {
    facts.countryCode = record.current_location_country_code;
  }
  if (record?.open_to_relocation !== undefined) {
    facts.openToRelocation = record.open_to_relocation;
  }
  if (record?.open_to_remote_work !== undefined) {
    facts.openToRemote = record.open_to_remote_work;
  }
  if (isText(record?.current_work_authorization_status)) {
    facts.workAuthorization = record.current_work_authorization_status;
  }
  if (record?.experience_years !== undefined) {
    facts.experienceYears = record.experience_years;
  }
  return facts;
}

// a, then b's entries a doesn't have (case-insensitive).
const union = (a: string[], b: string[] = []) => {
  const seen = new Set(a.map((value) => value.trim().toLowerCase()));
  return [
    ...a,
    ...b.filter((value) => {
      const key = value.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
};

// Where a RocketReach profile fits the scoring facts: current title,
// employers (current and past) and country. Its contact details and skill
// tags aren't scoring evidence. RocketReach matched this person by profile
// id, LinkedIn url, email or name plus employer, so unlike a low-confidence
// research read it's taken as theirs.
export function rocketReachFactsOf(
  person: RocketReachPerson | undefined,
): ResearchFacts | null {
  if (!person) return null;
  const facts: ResearchFacts = {
    titles: [person.current_title].filter(isText),
    companies: union(
      [],
      [
        person.current_employer,
        ...(person.job_history ?? []).map(
          (job) => job.company_name ?? job.company,
        ),
      ].filter(isText),
    ),
  };
  if (isText(person.country_code)) {
    facts.countryCode = person.country_code.toUpperCase();
  }
  return facts;
}

// Research's own facts lead; another source's add list entries and fill
// only the scalars research didn't state.
export function combineResearchFacts(
  research: ResearchFacts | null,
  extra: ResearchFacts | null,
): ResearchFacts | null {
  if (!research || !extra) return research ?? extra;
  const combined: ResearchFacts = { ...extra, ...research };
  for (const key of LIST_FACTS) {
    if (research[key] || extra[key]) {
      combined[key] = union(research[key] ?? [], extra[key]);
    }
  }
  return combined;
}

const LIST_FACTS = [
  'skills',
  'languages',
  'titles',
  'companies',
  'institutions',
  'qualificationTexts',
] as const;

// Lists are unioned, so research adds what it found and never erases what
// the search showed. A scalar research states replaces the search-time one
// (where they're based, years of experience): it's the more targeted read.
export function mergeFacts(
  search: ScoringFacts,
  research: ResearchFacts,
): ScoringFacts {
  return {
    skills: union(search.skills, research.skills),
    languages: union(search.languages, research.languages),
    titles: union(search.titles, research.titles),
    companies: union(search.companies, research.companies),
    institutions: union(search.institutions, research.institutions),
    qualificationTexts: union(
      search.qualificationTexts,
      research.qualificationTexts,
    ),
    countryCode: research.countryCode ?? search.countryCode,
    openToRelocation: research.openToRelocation ?? search.openToRelocation,
    openToRemote: research.openToRemote ?? search.openToRemote,
    workAuthorization: research.workAuthorization ?? search.workAuthorization,
    experienceYears: research.experienceYears ?? search.experienceYears,
  };
}

// Each row's points from search evidence alone, where research changed
// them; null where it didn't.
export function researchChanges(
  search: CandidateScoreCategory[],
  final: CandidateScoreCategory[],
): (number | null)[] {
  return final.map((row, index) => {
    const before = search[index];
    const sameRow =
      before?.category === row.category &&
      before.requirement === row.requirement;
    return sameRow && Math.abs(before.earned - row.earned) > 1e-9
      ? before.earned
      : null;
  });
}

export type ResearchRescore = {
  // From search evidence alone.
  search: CandidateScoreResult;
  // Search evidence plus the latest research; what role_result.score shows.
  final: CandidateScoreResult;
  // Per final breakdown row, see researchChanges.
  researchBefore: (number | null)[];
};

// Re-scores from the search snapshot plus only the latest research, so a
// re-run replaces earlier research rather than stacking on it. Gemini only
// supplies evidence; the number is always the fixed algorithm's.
export function rescoreWithResearch(
  scorer: Pick<CandidateScoringService, 'scoreFacts'>,
  filters: ParsedRoleFilters,
  searchFacts: ScoringFacts,
  researchFacts: ResearchFacts | null,
  search: CandidateScoreResult = scorer.scoreFacts(filters, searchFacts),
): ResearchRescore {
  if (!researchFacts) {
    return {
      search,
      final: search,
      researchBefore: search.breakdown.map(() => null),
    };
  }
  const final = scorer.scoreFacts(
    filters,
    mergeFacts(searchFacts, researchFacts),
  );
  return {
    search,
    final,
    researchBefore: researchChanges(search.breakdown, final.breakdown),
  };
}

// Results saved before searchEvidence was kept have no record of which
// qualifications the search snippet showed. An education row that earned
// full credit then showed all of them, so they count as search evidence.
export function legacyQualifications(
  rows: {
    category: string;
    weight: number;
    score: number;
    metadata: unknown;
  }[],
): string[] {
  return rows.flatMap((row) => {
    const requirement = (row.metadata as { requirement?: unknown } | null)
      ?.requirement;
    return row.category === 'education' &&
      row.weight > 0 &&
      row.score >= row.weight &&
      typeof requirement === 'string'
      ? requirement.split(', ').filter(isText)
      : [];
  });
}
