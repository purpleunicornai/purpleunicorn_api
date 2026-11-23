import type {
  CandidateScoreResult,
  ScoringFacts,
} from '../search/candidate-scoring.service';
import type { ParsedRoleFilters } from '../search/role-filter-parser';
import {
  candidateKey,
  normalizeImageUrl,
  normalizeSkillNames,
  parseLocationFields,
  splitName,
} from '../search/candidate-profile';
import { isLinkedInProfileUrl } from '../search/is-linkedin-profile';
import type { CapturedProfileDto } from './captured-profile.dto';

// How one filter row came out for a captured profile. `partial` is a list
// row (skills, languages) the candidate met some of.
export type CheckOutcome = 'met' | 'partial' | 'missed';

export type CaptureCheck = {
  category: string;
  requirement: string;
  priority: 'ESSENTIAL' | 'OPTIONAL';
  nonNegotiable: boolean;
  outcome: CheckOutcome;
};

// What the extension shows after adding a profile to a role (E7, E8).
export type CaptureScore = {
  roleId: string;
  resultId: string;
  candidateId: string;
  // The profile was already in this role before this request.
  alreadyInRole: boolean;
  shortlisted: boolean;
  score: number;
  disqualified: boolean;
  missedNonNegotiables: string[];
  checks: CaptureCheck[];
  matchedSkills: string[];
  missingSkills: string[];
};

// Every role in the active org a LinkedIn profile is already in (E4, E8).
export type ProfileMembership = {
  candidateId: string | null;
  roles: {
    roleId: string;
    roleName: string;
    projectId: string;
    projectName: string;
    resultId: string;
    score: number | null;
    shortlisted: boolean;
  }[];
};

// The canonical profile URL a capture is stored and matched under.
export function canonicalProfileUrl(slug: string): string {
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}`;
}

// LinkedIn serves one profile at many URLs (www, za., trailing slash), so
// existing sources are matched on the /in/<slug> ending, not equality.
export function profileUrlEndings(slug: string): string[] {
  const path = `/in/${encodeURIComponent(slug)}`;
  return [path, `${path}/`];
}

// The profile's /in/ slug, only for a linkedin.com (or regional subdomain)
// profile page.
export const profileSlug = (url: string): string | undefined =>
  isLinkedInProfileUrl(url) ? candidateKey(url) : undefined;

const trimmed = (value: string | undefined) => value?.trim() || undefined;

// Candidate columns a capture sets. Only fields the page actually showed are
// returned, so an update never blanks what search or research found.
export function capturedCandidateFields(profile: CapturedProfileDto) {
  const currentTitle =
    trimmed(profile.currentTitle) ?? trimmed(profile.headline);
  const currentCompany = trimmed(profile.currentCompany);
  const imageUrl = normalizeImageUrl(profile.imageUrl);
  const skills = normalizeSkillNames(profile.skills);
  const summary = trimmed(profile.about);
  const years = experienceYears(profile);
  return {
    ...splitName(profile.name),
    ...parseLocationFields(profile.location),
    ...(currentTitle ? { current_title: currentTitle } : {}),
    ...(currentCompany ? { current_company: currentCompany } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(summary ? { summary } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(years != null ? { experience_years: years } : {}),
  };
}

// Whole years since the earliest dated role on the page.
export function experienceYears(
  profile: CapturedProfileDto,
  now: Date = new Date(),
): number | null {
  const starts = (profile.experience ?? [])
    .map((entry) => Date.parse(entry.startDate))
    .filter((time) => Number.isFinite(time));
  if (starts.length === 0) return null;
  const years = (now.getTime() - Math.min(...starts)) / (365.25 * 86400000);
  return Math.max(0, Math.floor(years));
}

export function capturedExperienceRows(profile: CapturedProfileDto) {
  return (profile.experience ?? []).map((entry) => ({
    role: entry.title.trim(),
    company_name: entry.company.trim(),
    start_date: new Date(entry.startDate),
    end_date: entry.endDate ? new Date(entry.endDate) : null,
    skills: [],
  }));
}

function institutionType(name: string) {
  if (/universit/i.test(name)) return 'UNIVERSITY' as const;
  if (/college/i.test(name)) return 'COLLEGE' as const;
  if (/school/i.test(name)) return 'HIGH_SCHOOL' as const;
  return 'OTHER' as const;
}

// candidate_education needs a start date; rows without one are skipped.
export function capturedEducationRows(profile: CapturedProfileDto) {
  return (profile.education ?? []).flatMap((entry) =>
    entry.startDate
      ? [
          {
            institution_name: entry.institution.trim(),
            institution_type: institutionType(entry.institution),
            degree: trimmed(entry.degree) ?? null,
            field_of_study: trimmed(entry.fieldOfStudy) ?? null,
            start_date: new Date(entry.startDate),
            end_date: entry.endDate ? new Date(entry.endDate) : null,
          },
        ]
      : [],
  );
}

function outcomeOf(earned: number, weight: number): CheckOutcome {
  if (weight > 0 && earned >= weight - 1e-9) return 'met';
  return earned > 0 ? 'partial' : 'missed';
}

// The extension's view of one fixed-algorithm score: each applicable filter
// row as met, partial or missed, plus which required skills the profile
// shows. Pure, so the controller spec and the service share it.
export function captureView(
  filters: ParsedRoleFilters,
  facts: ScoringFacts,
  result: CandidateScoreResult,
): Pick<
  CaptureScore,
  | 'score'
  | 'disqualified'
  | 'missedNonNegotiables'
  | 'checks'
  | 'matchedSkills'
  | 'missingSkills'
> {
  const have = new Set(facts.skills.map((skill) => skill.trim().toLowerCase()));
  const wanted = [...new Set(filters.skills.flatMap((row) => row.value))];
  return {
    score: result.score,
    disqualified: result.disqualified,
    missedNonNegotiables: result.missedNonNegotiables.map(
      (missed) => missed.requirement,
    ),
    checks: result.breakdown
      .filter((row) => row.applicable)
      .map((row) => ({
        category: row.category,
        requirement: row.requirement,
        priority: row.priority,
        nonNegotiable: row.nonNegotiable,
        outcome: outcomeOf(row.earned, row.weight),
      })),
    matchedSkills: wanted.filter((skill) =>
      have.has(skill.trim().toLowerCase()),
    ),
    missingSkills: wanted.filter(
      (skill) => !have.has(skill.trim().toLowerCase()),
    ),
  };
}
