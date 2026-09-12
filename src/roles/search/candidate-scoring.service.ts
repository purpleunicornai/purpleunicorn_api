import { Injectable } from '@nestjs/common';
import { RoleFilterDto } from '../dto/role_filter.dto';
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
}

export interface CandidateScoreResult {
  score: number;
  breakdown: CandidateScoreCategory[];
}

// Required skills lead the weighting; optional skills sit below both
// education and location/eligibility, per how this role expects candidates
// to be prioritized. Every category is independently skippable ("not
// applicable") when the role filter didn't specify anything for it, so an
// unspecified criterion never drags a candidate's score down — only ones
// the filter actually cares about do.
const WEIGHTS = {
  requiredSkills: 30,
  experienceYears: 15,
  currentRoleTenure: 10,
  education: 15,
  languages: 5,
  location: 15,
  optionalSkills: 5,
  diversity: 5,
} as const;

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

@Injectable()
export class CandidateScoringService {
  scoreCandidate(
    filter: RoleFilterDto,
    candidate: CandidateWithHistory,
  ): CandidateScoreResult {
    const breakdown: CandidateScoreCategory[] = [
      this.scoreListOverlap(
        'required_skills',
        WEIGHTS.requiredSkills,
        filter.required_skills,
        candidate.skills,
      ),
      this.scoreListOverlap(
        'optional_skills',
        WEIGHTS.optionalSkills,
        filter.optional_skills,
        candidate.skills,
      ),
      this.scoreExperienceYears(filter, candidate),
      this.scoreCurrentRoleTenure(filter, candidate),
      this.scoreEducation(filter, candidate),
      this.scoreLanguages(filter, candidate),
      this.scoreLocation(filter, candidate),
      this.scoreListOverlap(
        'diversity',
        WEIGHTS.diversity,
        filter.diversity,
        candidate.diversity,
      ),
    ];

    const applicable = breakdown.filter((entry) => entry.applicable);
    const totalWeight = applicable.reduce(
      (sum, entry) => sum + entry.weight,
      0,
    );
    const totalEarned = applicable.reduce(
      (sum, entry) => sum + entry.earned,
      0,
    );
    const score =
      totalWeight > 0 ? Math.round((totalEarned / totalWeight) * 100) : 0;

    return { score, breakdown };
  }

  // Shared by required_skills, optional_skills, and diversity: what fraction
  // of the filter's list turns up (case-insensitively) in the candidate's.
  private scoreListOverlap(
    category: string,
    weight: number,
    required: string[],
    available: string[],
  ): CandidateScoreCategory {
    if (required.length === 0) {
      return { category, weight, earned: 0, applicable: false };
    }
    const availableSet = new Set(
      available.map((value) => this.normalize(value)),
    );
    const matched = required.filter((value) =>
      availableSet.has(this.normalize(value)),
    ).length;
    return {
      category,
      weight,
      earned: (matched / required.length) * weight,
      applicable: true,
    };
  }

  private scoreExperienceYears(
    filter: RoleFilterDto,
    candidate: CandidateWithHistory,
  ): CandidateScoreCategory {
    const category = 'experience_years';
    const weight = WEIGHTS.experienceYears;
    if (!filter.experience_min_yrs && !filter.experience_max_yrs) {
      return { category, weight, earned: 0, applicable: false };
    }
    const years = candidate.experience_years ?? 0;
    return {
      category,
      weight,
      earned: this.scoreAgainstMin(years, filter.experience_min_yrs, weight),
      applicable: true,
    };
  }

  private scoreCurrentRoleTenure(
    filter: RoleFilterDto,
    candidate: CandidateWithHistory,
  ): CandidateScoreCategory {
    const category = 'current_role_tenure';
    const weight = WEIGHTS.currentRoleTenure;
    if (!filter.current_role_min_yrs && !filter.current_role_max_yrs) {
      return { category, weight, earned: 0, applicable: false };
    }
    const years = this.currentTenureYears(candidate.experience);
    return {
      category,
      weight,
      earned: this.scoreAgainstMin(years, filter.current_role_min_yrs, weight),
      applicable: true,
    };
  }

  // Tenure is measured from the most recently started open-ended (no
  // end_date) experience entry — that's the candidate's current role. A
  // candidate with no open-ended entry on file scores 0 here: we simply
  // don't know how long they've been in their current role.
  private currentTenureYears(experience: candidate_experience[]): number {
    const openEntries = experience.filter((entry) => entry.end_date === null);
    if (openEntries.length === 0) return 0;

    const mostRecent = openEntries.reduce((latest, entry) =>
      entry.start_date > latest.start_date ? entry : latest,
    );
    return (Date.now() - mostRecent.start_date.getTime()) / MS_PER_YEAR;
  }

  // Full credit once `actual` meets `min`; below it, credit falls off
  // linearly to 0. A min of 0 (unset) means "no floor" — full credit.
  private scoreAgainstMin(actual: number, min: number, weight: number): number {
    if (min <= 0 || actual >= min) return weight;
    return Math.max(0, (actual / min) * weight);
  }

  private scoreEducation(
    filter: RoleFilterDto,
    candidate: CandidateWithHistory,
  ): CandidateScoreCategory {
    const category = 'education';
    const weight = WEIGHTS.education;
    const {
      education_levels,
      education_institution,
      education_excluded_institutions,
    } = filter;

    if (
      education_levels.length === 0 &&
      education_institution.length === 0 &&
      education_excluded_institutions.length === 0
    ) {
      return { category, weight, earned: 0, applicable: false };
    }

    const institutionNames = candidate.education.map((entry) =>
      this.normalize(entry.institution_name),
    );
    const isExcluded = education_excluded_institutions.some((name) =>
      institutionNames.some((candidateName) =>
        candidateName.includes(this.normalize(name)),
      ),
    );
    if (isExcluded) {
      return { category, weight, earned: 0, applicable: true };
    }

    const fractions: number[] = [];
    if (education_levels.length > 0) {
      const degrees = candidate.education.map((entry) =>
        this.normalize(entry.degree ?? ''),
      );
      const matched = education_levels.filter((level) =>
        degrees.some((degree) => degree.includes(this.normalize(level))),
      ).length;
      fractions.push(matched / education_levels.length);
    }
    if (education_institution.length > 0) {
      const matched = education_institution.filter((name) =>
        institutionNames.some((candidateName) =>
          candidateName.includes(this.normalize(name)),
        ),
      ).length;
      fractions.push(matched / education_institution.length);
    }

    // Only exclusions were configured and none matched: nothing left to
    // penalize on, so this counts as a clean pass.
    const fraction =
      fractions.length > 0
        ? fractions.reduce((sum, value) => sum + value, 0) / fractions.length
        : 1;
    return { category, weight, earned: fraction * weight, applicable: true };
  }

  private scoreLanguages(
    filter: RoleFilterDto,
    candidate: CandidateWithHistory,
  ): CandidateScoreCategory {
    const category = 'languages';
    const weight = WEIGHTS.languages;
    const { required_languages, optional_languages } = filter;

    if (required_languages.length === 0 && optional_languages.length === 0) {
      return { category, weight, earned: 0, applicable: false };
    }

    const availableSet = new Set(
      candidate.languages.map((value) => this.normalize(value)),
    );
    const requiredFraction = required_languages.length
      ? required_languages.filter((lang) =>
          availableSet.has(this.normalize(lang)),
        ).length / required_languages.length
      : null;
    const optionalFraction = optional_languages.length
      ? optional_languages.filter((lang) =>
          availableSet.has(this.normalize(lang)),
        ).length / optional_languages.length
      : null;

    let earned: number;
    if (requiredFraction !== null && optionalFraction !== null) {
      earned = (requiredFraction * 0.7 + optionalFraction * 0.3) * weight;
    } else if (requiredFraction !== null) {
      earned = requiredFraction * weight;
    } else {
      earned = (optionalFraction as number) * weight;
    }

    return { category, weight, earned, applicable: true };
  }

  private scoreLocation(
    filter: RoleFilterDto,
    candidate: CandidateWithHistory,
  ): CandidateScoreCategory {
    const category = 'location_eligibility';
    const weight = WEIGHTS.location;
    const checks: number[] = [];

    if (filter.country_code) {
      const matches =
        candidate.current_location_country_code === filter.country_code ||
        candidate.open_to_relocation === true;
      checks.push(matches ? 1 : 0);
    }
    if (filter.remote_work) {
      checks.push(candidate.open_to_remote_work === true ? 1 : 0);
    }
    if (filter.work_authorization_required) {
      checks.push(candidate.current_work_authorization_status ? 1 : 0);
    }

    if (checks.length === 0) {
      return { category, weight, earned: 0, applicable: false };
    }
    const fraction =
      checks.reduce((sum, value) => sum + value, 0) / checks.length;
    return { category, weight, earned: fraction * weight, applicable: true };
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }
}
