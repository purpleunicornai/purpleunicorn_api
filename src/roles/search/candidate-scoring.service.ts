import { Injectable } from '@nestjs/common';
import {
  ParsedCompanies,
  ParsedEducation,
  ParsedExperience,
  ParsedFilterRow,
  ParsedJobTitles,
  ParsedLocation,
  ParsedRoleFilters,
} from './role-filter-parser';
import { WorkType, locationMatters, remoteAllowed } from './work-types';
import {
  candidate,
  candidate_experience,
  candidate_education,
} from '../../generated/prisma/client';
import {
  qualificationAliases,
  sameCountry,
  textContainsTerm,
} from './filter-terms';

export type CandidateWithHistory = candidate & {
  experience: candidate_experience[];
  education: candidate_education[];
};

// One scored filter row. requirement/priority/nonNegotiable say which row
// it was, so a profile can list each criterion as met or missed.
export interface CandidateScoreCategory {
  category: string;
  requirement: string;
  priority: 'ESSENTIAL' | 'OPTIONAL';
  nonNegotiable: boolean;
  weight: number;
  earned: number;
  applicable: boolean;
}

// Facts Gemini read off a search result that have no column on the
// candidate record yet (a fresh search result never has education rows,
// since candidate_education needs a start date a snippet rarely gives).
export interface CandidateMatchEvidence {
  qualifications?: string[];
}

// Everything the fixed algorithm reads about a candidate. Built from the
// candidate record (plus facts Gemini read off the search result), or merged
// with deep research's verified facts. JSON-safe, so a role_result can keep
// the snapshot it was scored from and re-score without stacking.
export type ScoringFacts = {
  skills: string[];
  languages: string[];
  // Current job titles; a job title row matches any of them.
  titles: string[];
  // Employers, current and past.
  companies: string[];
  institutions: string[];
  // Where a qualification like CA(SA) can show up: degrees, fields of study,
  // the headline, the bio, Gemini-read qualifications, cited findings.
  qualificationTexts: string[];
  countryCode: string | null;
  openToRelocation: boolean | null;
  openToRemote: boolean | null;
  workAuthorization: string | null;
  experienceYears: number | null;
};

export function scoringFactsOf(
  candidate: CandidateWithHistory,
  evidence: CandidateMatchEvidence = {},
): ScoringFacts {
  const experience = candidate.experience ?? [];
  const education = candidate.education ?? [];
  return {
    skills: candidate.skills ?? [],
    languages: candidate.languages ?? [],
    titles: candidate.current_title ? [candidate.current_title] : [],
    companies: experience.map((entry) => entry.company_name),
    institutions: education.map((entry) => entry.institution_name),
    qualificationTexts: [
      ...education.flatMap((entry) => [entry.degree, entry.field_of_study]),
      candidate.current_title,
      candidate.summary,
      ...(evidence.qualifications ?? []),
    ].filter((text): text is string => !!text),
    countryCode: candidate.current_location_country_code ?? null,
    openToRelocation: candidate.open_to_relocation ?? null,
    openToRemote: candidate.open_to_remote_work ?? null,
    workAuthorization: candidate.current_work_authorization_status ?? null,
    experienceYears: candidate.experience_years ?? null,
  };
}

// A non-negotiable row the candidate fell short on, named by its filter
// value (e.g. { category: 'education', requirement: 'CA(SA)' }).
export interface MissedRequirement {
  category: string;
  requirement: string;
}

export interface CandidateScoreResult {
  score: number;
  // The weighted sum before a missed non-negotiable zeroes `score`; equal
  // to `score` when not disqualified.
  rawScore: number;
  disqualified: boolean;
  missedNonNegotiables: MissedRequirement[];
  breakdown: CandidateScoreCategory[];
}

interface ScoredRow {
  category: string;
  requirement: string;
  fraction: number;
  priority: 'ESSENTIAL' | 'OPTIONAL';
  nonNegotiable: boolean;
}

// A filter row's value as a recruiter would name it, for "missed" notes.
function describeRequirement(category: string, value: unknown): string {
  switch (category) {
    case 'skills':
    case 'languages':
      return (value as string[]).join(', ');
    case 'job_titles':
      return (value as ParsedJobTitles).titles.join(' / ');
    case 'companies': {
      const { names, type } = value as ParsedCompanies;
      return type === 'exclude'
        ? `not at ${names.join(' / ')}`
        : names.join(' / ');
    }
    case 'education': {
      const { qualifications, institutions, institutionType } =
        value as ParsedEducation;
      if (qualifications.length > 0) return qualifications.join(', ');
      const names = institutions.join(' / ');
      return institutionType === 'exclude' ? `not from ${names}` : names;
    }
    case 'location': {
      const { countryCode, workAuthorizationRequired } =
        value as ParsedLocation;
      const parts = [
        countryCode ? `based in ${countryCode}` : '',
        workAuthorizationRequired ? 'work authorisation' : '',
      ];
      return parts.filter(Boolean).join(' + ') || 'location';
    }
    case 'industry':
      return `${value as string} industry`;
    case 'experience':
      return `${(value as ParsedExperience).minYears}+ years experience`;
    default:
      return category;
  }
}

const ESSENTIAL_BUCKET_WEIGHT = 80;
const OPTIONAL_BUCKET_WEIGHT = 20;

@Injectable()
export class CandidateScoringService {
  scoreCandidate(
    filters: ParsedRoleFilters,
    candidate: CandidateWithHistory,
    evidence: CandidateMatchEvidence = {},
  ): CandidateScoreResult {
    return this.scoreFacts(filters, scoringFactsOf(candidate, evidence));
  }

  scoreFacts(
    filters: ParsedRoleFilters,
    facts: ScoringFacts,
  ): CandidateScoreResult {
    const rows: ScoredRow[] = [
      ...filters.skills.map((row) =>
        this.scoreRow(
          'skills',
          row,
          this.fractionListOverlap(row.value, facts.skills),
        ),
      ),
      ...filters.languages.map((row) =>
        this.scoreRow(
          'languages',
          row,
          this.fractionListOverlap(row.value, facts.languages),
        ),
      ),
      ...filters.jobTitles.map((row) =>
        this.scoreRow('job_titles', row, this.fractionJobTitle(row, facts)),
      ),
      ...filters.companies.map((row) =>
        this.scoreRow('companies', row, this.fractionCompanies(row, facts)),
      ),
      ...filters.education.map((row) =>
        this.scoreRow('education', row, this.fractionEducation(row, facts)),
      ),
      ...(filters.location
        ? [
            this.scoreRow(
              'location',
              filters.location,
              this.fractionLocation(filters.location, facts),
            ),
          ]
        : []),
      ...(filters.industry
        ? [
            this.scoreRow(
              'industry',
              filters.industry,
              // No industry signal on a candidate yet: always applicable,
              // never earns credit, so a recruiter sees it was considered.
              0,
            ),
          ]
        : []),
      ...(filters.experience
        ? [
            this.scoreRow(
              'experience',
              filters.experience,
              this.fractionExperience(filters.experience, facts),
            ),
          ]
        : []),
    ];

    const missedNonNegotiables = rows
      .filter((row) => row.nonNegotiable && row.fraction < 1)
      .map(({ category, requirement }) => ({ category, requirement }));
    const disqualified = missedNonNegotiables.length > 0;

    const essentialRows = rows.filter((row) => row.priority === 'ESSENTIAL');
    const optionalRows = rows.filter((row) => row.priority === 'OPTIONAL');
    const essentialRowWeight =
      essentialRows.length > 0
        ? ESSENTIAL_BUCKET_WEIGHT / essentialRows.length
        : 0;
    const optionalRowWeight =
      optionalRows.length > 0
        ? OPTIONAL_BUCKET_WEIGHT / optionalRows.length
        : 0;

    const breakdown: CandidateScoreCategory[] = rows.map((row) => {
      const weight =
        row.priority === 'ESSENTIAL' ? essentialRowWeight : optionalRowWeight;
      return {
        category: row.category,
        requirement: row.requirement,
        priority: row.priority,
        nonNegotiable: row.nonNegotiable,
        weight,
        earned: row.fraction * weight,
        applicable: true,
      };
    });

    const rawScore = Math.round(
      breakdown.reduce((sum, entry) => sum + entry.earned, 0),
    );
    const score = disqualified ? 0 : rawScore;

    return { score, rawScore, disqualified, missedNonNegotiables, breakdown };
  }

  private scoreRow<T>(
    category: string,
    row: ParsedFilterRow<T>,
    fraction: number,
  ): ScoredRow {
    return {
      category,
      requirement: describeRequirement(category, row.value),
      fraction,
      priority: row.priority,
      nonNegotiable: row.nonNegotiable,
    };
  }

  private fractionListOverlap(required: string[], available: string[]): number {
    if (required.length === 0) return 0;
    const availableSet = new Set(
      available.map((value) => this.normalize(value)),
    );
    const matched = required.filter((value) =>
      availableSet.has(this.normalize(value)),
    ).length;
    return matched / required.length;
  }

  private fractionJobTitle(
    row: ParsedFilterRow<{ titles: string[] }>,
    facts: ScoringFacts,
  ): number {
    const currentTitles = facts.titles.map((title) => this.normalize(title));
    return row.value.titles.some((title) =>
      currentTitles.includes(this.normalize(title)),
    )
      ? 1
      : 0;
  }

  private fractionCompanies(
    row: ParsedFilterRow<{ names: string[]; type: 'include' | 'exclude' }>,
    facts: ScoringFacts,
  ): number {
    const candidateCompanies = facts.companies.map((name) =>
      this.normalize(name),
    );
    const hasMatch = row.value.names.some((name) =>
      candidateCompanies.includes(this.normalize(name)),
    );

    if (row.value.type === 'exclude') return hasMatch ? 0 : 1;
    return hasMatch ? 1 : 0;
  }

  private fractionEducation(
    row: ParsedFilterRow<{
      qualifications: string[];
      institutions: string[];
      institutionType: 'include' | 'exclude';
    }>,
    facts: ScoringFacts,
  ): number {
    const institutionNames = facts.institutions.map((name) =>
      this.normalize(name),
    );
    const matchesInstitution = row.value.institutions.some((name) =>
      institutionNames.some((candidateName) =>
        candidateName.includes(this.normalize(name)),
      ),
    );

    if (row.value.institutionType === 'exclude' && matchesInstitution) return 0;

    if (row.value.qualifications.length === 0) return 1;

    // Designations like CA(SA) usually live in the headline or bio rather
    // than a degree row, and a fresh search result has no education rows at
    // all — so all of these count, matched punctuation-insensitively.
    const texts = facts.qualificationTexts;
    const matched = row.value.qualifications.filter((qualification) =>
      qualificationAliases(qualification).some((alias) =>
        texts.some((text) => textContainsTerm(text, alias)),
      ),
    ).length;
    return matched / row.value.qualifications.length;
  }

  // Where they are: in the country (or willing to relocate) always counts;
  // open to remote work counts too when the role accepts REMOTE. A local
  // candidate is never marked down just because remote is also allowed.
  private fractionLocation(
    row: ParsedFilterRow<{
      countryCode: string;
      remoteWork: boolean;
      workTypes?: WorkType[];
      workAuthorizationRequired: boolean;
    }>,
    facts: ScoringFacts,
  ): number {
    const checks: number[] = [];
    const remote = remoteAllowed(row.value);
    const openToRemote = remote && facts.openToRemote === true;

    if (row.value.countryCode) {
      const matches =
        sameCountry(facts.countryCode, row.value.countryCode) ||
        facts.openToRelocation === true ||
        openToRemote;
      checks.push(matches ? 1 : 0);
    } else if (remote && !locationMatters(row.value)) {
      checks.push(openToRemote ? 1 : 0);
    }
    if (row.value.workAuthorizationRequired) {
      checks.push(facts.workAuthorization ? 1 : 0);
    }

    if (checks.length === 0) return 1;
    return checks.reduce((sum, value) => sum + value, 0) / checks.length;
  }

  // Partial credit scaled to how close the candidate is to the requirement,
  // rather than a binary pass/fail — someone with 8 of a required 10 years
  // still earns most of the row's weight. Capped at 1 so exceeding the
  // minimum never earns more than full credit.
  private fractionExperience(
    row: ParsedFilterRow<{ minYears: number }>,
    facts: ScoringFacts,
  ): number {
    if (row.value.minYears <= 0) return 1;
    const candidateYears = facts.experienceYears ?? 0;
    return Math.min(candidateYears / row.value.minYears, 1);
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }
}
