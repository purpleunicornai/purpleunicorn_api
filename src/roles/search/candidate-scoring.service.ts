import { Injectable } from '@nestjs/common';
import { ParsedFilterRow, ParsedRoleFilters } from './role-filter-parser';
import {
  candidate,
  candidate_experience,
  candidate_education,
} from '../../generated/prisma/client';

export type CandidateWithHistory = candidate & {
  experience: candidate_experience[];
  education: candidate_education[];
};

export interface CandidateScoreCategory {
  category: string;
  weight: number;
  earned: number;
  applicable: boolean;
  filterId: string;
}

export interface CandidateScoreResult {
  score: number;
  disqualified: boolean;
  breakdown: CandidateScoreCategory[];
}

interface ScoredRow {
  category: string;
  fraction: number;
  priority: 'ESSENTIAL' | 'OPTIONAL';
  nonNegotiable: boolean;
  filterId: string;
}

const ESSENTIAL_BUCKET_WEIGHT = 80;
const OPTIONAL_BUCKET_WEIGHT = 20;

@Injectable()
export class CandidateScoringService {
  scoreCandidate(
    filters: ParsedRoleFilters,
    candidate: CandidateWithHistory,
  ): CandidateScoreResult {
    const rows: ScoredRow[] = [
      ...filters.skills.map((row) =>
        this.scoreRow(
          'skills',
          row,
          this.fractionListOverlap(row.value, candidate.skills),
        ),
      ),
      ...filters.languages.map((row) =>
        this.scoreRow(
          'languages',
          row,
          this.fractionListOverlap(row.value, candidate.languages),
        ),
      ),
      ...filters.jobTitles.map((row) =>
        this.scoreRow('job_titles', row, this.fractionJobTitle(row, candidate)),
      ),
      ...filters.companies.map((row) =>
        this.scoreRow('companies', row, this.fractionCompanies(row, candidate)),
      ),
      ...filters.education.map((row) =>
        this.scoreRow('education', row, this.fractionEducation(row, candidate)),
      ),
      ...(filters.location
        ? [
            this.scoreRow(
              'location',
              filters.location,
              this.fractionLocation(filters.location, candidate),
            ),
          ]
        : []),
      ...(filters.industry
        ? [
            this.scoreRow(
              'industry',
              filters.industry,
              this.fractionIndustry(filters.industry, candidate),
            ),
          ]
        : []),
    ];

    const disqualified = rows.some(
      (row) => row.nonNegotiable && row.fraction < 1,
    );

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
        weight,
        earned: row.fraction * weight,
        applicable: true,
        filterId: row.filterId,
      };
    });

    const score = disqualified
      ? 0
      : Math.round(breakdown.reduce((sum, entry) => sum + entry.earned, 0));

    return { score, disqualified, breakdown };
  }

  private scoreRow<T>(
    category: string,
    row: ParsedFilterRow<T>,
    fraction: number,
  ): ScoredRow {
    return {
      category,
      fraction,
      priority: row.priority,
      nonNegotiable: row.nonNegotiable,
      filterId: row.filterId,
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
    candidate: CandidateWithHistory,
  ): number {
    if (!candidate.current_title) return 0;
    const currentTitle = this.normalize(candidate.current_title);
    return row.value.titles.some(
      (title) => this.normalize(title) === currentTitle,
    )
      ? 1
      : 0;
  }

  private fractionCompanies(
    row: ParsedFilterRow<{ names: string[]; type: 'include' | 'exclude' }>,
    candidate: CandidateWithHistory,
  ): number {
    const candidateCompanies = candidate.experience.map((entry) =>
      this.normalize(entry.company_name),
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
    candidate: CandidateWithHistory,
  ): number {
    const institutionNames = candidate.education.map((entry) =>
      this.normalize(entry.institution_name),
    );
    const matchesInstitution = row.value.institutions.some((name) =>
      institutionNames.some((candidateName) =>
        candidateName.includes(this.normalize(name)),
      ),
    );

    if (row.value.institutionType === 'exclude' && matchesInstitution) return 0;

    if (row.value.qualifications.length === 0) return 1;

    const degrees = candidate.education.map((entry) =>
      this.normalize(entry.degree ?? ''),
    );
    const matched = row.value.qualifications.filter((qualification) =>
      degrees.some((degree) => degree.includes(this.normalize(qualification))),
    ).length;
    return matched / row.value.qualifications.length;
  }

  private fractionLocation(
    row: ParsedFilterRow<{
      countryCode: string;
      remoteWork: boolean;
      workAuthorizationRequired: boolean;
    }>,
    candidate: CandidateWithHistory,
  ): number {
    const checks: number[] = [];

    if (row.value.countryCode) {
      const matches =
        candidate.current_location_country_code === row.value.countryCode ||
        candidate.open_to_relocation === true;
      checks.push(matches ? 1 : 0);
    }
    if (row.value.remoteWork) {
      checks.push(candidate.open_to_remote_work === true ? 1 : 0);
    }
    if (row.value.workAuthorizationRequired) {
      checks.push(candidate.current_work_authorization_status ? 1 : 0);
    }

    if (checks.length === 0) return 1;
    return checks.reduce((sum, value) => sum + value, 0) / checks.length;
  }

  // The candidate model has no first-class industry signal today, so an
  // industry filter is always applicable but never earns credit — scored
  // explicitly as 0 rather than left out, so a recruiter can see it was
  // considered rather than silently skipped.
  private fractionIndustry(
    _row: ParsedFilterRow<string>,
    _candidate: CandidateWithHistory,
  ): number {
    return 0;
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }
}
