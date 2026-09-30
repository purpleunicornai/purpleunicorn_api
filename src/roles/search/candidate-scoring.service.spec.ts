import {
  CandidateScoringService,
  CandidateScoreCategory,
} from './candidate-scoring.service';
import { RoleFilterDto } from '../dto/role_filter.dto';
import {
  candidate,
  candidate_experience,
  candidate_education,
} from '../../generated/prisma/client';

type CandidateWithHistory = candidate & {
  experience: candidate_experience[];
  education: candidate_education[];
};

function buildFilter(overrides: Partial<RoleFilterDto> = {}): RoleFilterDto {
  return {
    title: 'Fullstack Developer',
    alternative_titles: [],
    title_levels: [],
    roles: [],
    current_role_min_yrs: 0,
    current_role_max_yrs: 0,
    current_role_tenure_yrs: 0,
    country_code: '',
    remote_work: false,
    work_authorization_required: false,
    filter_location_cities: [],
    experience_min_yrs: 0,
    experience_max_yrs: 0,
    required_skills: [],
    optional_skills: [],
    education_levels: [],
    education_institution: [],
    education_excluded_institutions: [],
    education_graduation_min_yr: null,
    education_graduation_max_yr: null,
    required_languages: [],
    optional_languages: [],
    career_growth: [],
    security_clearance_required: [],
    diversity: [],
    other_experience: [],
    sites: [],
    filter_companies: [],
    metadata: { original_prompt: '', refined_prompt: '', complete: false },
    ...overrides,
  };
}

function buildCandidate(
  overrides: Partial<CandidateWithHistory> = {},
): CandidateWithHistory {
  return {
    uid: 'candidate-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    first_name: 'Jane',
    last_name: 'Doe',
    email: null,
    phone: null,
    country_calling_code: null,
    contact_info_last_updated: null,
    rocketreach_profile_id: null,
    current_location_city: null,
    current_location_country_code: null,
    current_location_postal_code: null,
    open_to_relocation: null,
    open_to_remote_work: null,
    current_work_authorization_status: null,
    experience_years: null,
    experience_roles: [],
    current_title: null,
    current_company: null,
    current_salary: null,
    current_salary_currency: null,
    current_role_start_date: null,
    skills: [],
    languages: [],
    diversity: [],
    summary: null,
    image_url: null,
    enriched_at: null,
    experience: [],
    education: [],
    ...overrides,
  };
}

function buildExperience(
  overrides: Partial<candidate_experience> = {},
): candidate_experience {
  return {
    uid: 'experience-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    candidate_id: 'candidate-1',
    company_name: 'TechCorp',
    company_location: null,
    role: 'Engineer',
    start_date: new Date('2020-01-01T00:00:00.000Z'),
    end_date: null,
    responsibilities: null,
    skills: [],
    ...overrides,
  };
}

function buildEducation(
  overrides: Partial<candidate_education> = {},
): candidate_education {
  return {
    uid: 'education-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    candidate_id: 'candidate-1',
    institution_name: 'University of Oxford',
    institution_type: 'UNIVERSITY',
    institution_location: null,
    degree: "Bachelor's Degree",
    field_of_study: 'Computer Science',
    start_date: new Date('2016-09-01T00:00:00.000Z'),
    end_date: new Date('2020-06-18T00:00:00.000Z'),
    summary: null,
    additional_info: null,
    ...overrides,
  };
}

function findCategory(
  breakdown: CandidateScoreCategory[],
  category: string,
): CandidateScoreCategory | undefined {
  return breakdown.find((entry) => entry.category === category);
}

describe('CandidateScoringService', () => {
  let service: CandidateScoringService;

  beforeEach(() => {
    service = new CandidateScoringService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('scoreCandidate', () => {
    it('scores 100 when every applicable category is fully matched', () => {
      const filter = buildFilter({ required_skills: ['TypeScript'] });
      const candidate = buildCandidate({ skills: ['TypeScript'] });

      const result = service.scoreCandidate(filter, candidate);

      expect(result.score).toBe(100);
    });

    it('scores 0 when the only applicable category is fully missed', () => {
      const filter = buildFilter({ required_skills: ['TypeScript'] });
      const candidate = buildCandidate({ skills: [] });

      const result = service.scoreCandidate(filter, candidate);

      expect(result.score).toBe(0);
    });

    it('excludes categories the filter did not specify from the score, rather than penalizing them', () => {
      const filter = buildFilter({ required_skills: ['TypeScript'] });
      // Nothing else set on the filter: no optional_skills, no experience
      // range, no education/language/location/diversity criteria.
      const candidate = buildCandidate({ skills: ['TypeScript'] });

      const result = service.scoreCandidate(filter, candidate);

      expect(result.score).toBe(100);
      expect(result.breakdown.filter((entry) => entry.applicable)).toHaveLength(
        1,
      );
    });

    it('rounds the final score to the nearest whole number', () => {
      const filter = buildFilter({
        required_skills: ['TypeScript', 'AWS', 'Docker'],
      });
      const candidate = buildCandidate({ skills: ['TypeScript'] });

      const result = service.scoreCandidate(filter, candidate);

      expect(Number.isInteger(result.score)).toBe(true);
      expect(result.score).toBe(33);
    });

    it('weights required skills above optional skills', () => {
      const filter = buildFilter({
        required_skills: ['TypeScript'],
        optional_skills: ['GraphQL'],
      });

      const meetsRequired = service.scoreCandidate(
        filter,
        buildCandidate({ skills: ['TypeScript'] }),
      );
      const meetsOptional = service.scoreCandidate(
        filter,
        buildCandidate({ skills: ['GraphQL'] }),
      );

      expect(meetsRequired.score).toBeGreaterThan(meetsOptional.score);
    });
  });

  describe('required_skills category', () => {
    it('is not applicable when the filter has no required skills', () => {
      const filter = buildFilter({ required_skills: [] });
      const candidate = buildCandidate();

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'required_skills')).toEqual(
        expect.objectContaining({ applicable: false, earned: 0 }),
      );
    });

    it('awards partial credit proportional to how many required skills match, case-insensitively', () => {
      const filter = buildFilter({
        required_skills: ['TypeScript', 'AWS'],
      });
      const candidate = buildCandidate({ skills: ['typescript'] });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'required_skills')).toEqual(
        expect.objectContaining({ weight: 30, earned: 15, applicable: true }),
      );
    });
  });

  describe('optional_skills category', () => {
    it('is not applicable when the filter has no optional skills', () => {
      const filter = buildFilter({ optional_skills: [] });
      const candidate = buildCandidate();

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'optional_skills')).toEqual(
        expect.objectContaining({ applicable: false, earned: 0 }),
      );
    });

    it('awards full credit when every optional skill matches', () => {
      const filter = buildFilter({ optional_skills: ['GraphQL', 'Docker'] });
      const candidate = buildCandidate({ skills: ['GraphQL', 'Docker'] });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'optional_skills')).toEqual(
        expect.objectContaining({ weight: 5, earned: 5, applicable: true }),
      );
    });
  });

  describe('experience_years category', () => {
    it('is not applicable when neither min nor max experience is set', () => {
      const filter = buildFilter({
        experience_min_yrs: 0,
        experience_max_yrs: 0,
      });
      const candidate = buildCandidate();

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'experience_years')).toEqual(
        expect.objectContaining({ applicable: false }),
      );
    });

    it('awards full credit when the candidate is within range', () => {
      const filter = buildFilter({
        experience_min_yrs: 2,
        experience_max_yrs: 5,
      });
      const candidate = buildCandidate({ experience_years: 3 });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'experience_years')).toEqual(
        expect.objectContaining({ weight: 15, earned: 15, applicable: true }),
      );
    });

    it('does not penalize a candidate for having more experience than the max', () => {
      const filter = buildFilter({
        experience_min_yrs: 2,
        experience_max_yrs: 5,
      });
      const candidate = buildCandidate({ experience_years: 20 });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'experience_years')).toEqual(
        expect.objectContaining({ earned: 15 }),
      );
    });

    it('gives linear partial credit below the minimum', () => {
      const filter = buildFilter({
        experience_min_yrs: 4,
        experience_max_yrs: 0,
      });
      const candidate = buildCandidate({ experience_years: 2 });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'experience_years')).toEqual(
        expect.objectContaining({ earned: 7.5 }),
      );
    });
  });

  describe('current_role_tenure category', () => {
    it('is not applicable when neither current-role min nor max is set', () => {
      const filter = buildFilter({
        current_role_min_yrs: 0,
        current_role_max_yrs: 0,
      });
      const candidate = buildCandidate();

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'current_role_tenure')).toEqual(
        expect.objectContaining({ applicable: false }),
      );
    });

    it('awards full credit using the most recent open-ended experience entry', () => {
      const filter = buildFilter({ current_role_min_yrs: 2 });
      const candidate = buildCandidate({
        experience: [
          buildExperience({
            start_date: new Date(Date.now() - 5 * 365.25 * 24 * 60 * 60 * 1000),
            end_date: null,
          }),
        ],
      });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'current_role_tenure')).toEqual(
        expect.objectContaining({ weight: 10, earned: 10, applicable: true }),
      );
    });

    it('scores 0 when the candidate has no open-ended experience entry', () => {
      const filter = buildFilter({ current_role_min_yrs: 2 });
      const candidate = buildCandidate({
        experience: [
          buildExperience({
            start_date: new Date('2015-01-01T00:00:00.000Z'),
            end_date: new Date('2018-01-01T00:00:00.000Z'),
          }),
        ],
      });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'current_role_tenure')).toEqual(
        expect.objectContaining({ earned: 0, applicable: true }),
      );
    });

    it('ignores closed-out roles and uses the most recently started open-ended entry', () => {
      const filter = buildFilter({ current_role_min_yrs: 1 });
      const candidate = buildCandidate({
        experience: [
          buildExperience({
            start_date: new Date('2010-01-01T00:00:00.000Z'),
            end_date: new Date('2015-01-01T00:00:00.000Z'),
          }),
          buildExperience({
            start_date: new Date(Date.now() - 3 * 365.25 * 24 * 60 * 60 * 1000),
            end_date: null,
          }),
        ],
      });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'current_role_tenure')).toEqual(
        expect.objectContaining({ earned: 10 }),
      );
    });
  });

  describe('education category', () => {
    it('is not applicable when the filter has no education criteria', () => {
      const filter = buildFilter({
        education_levels: [],
        education_institution: [],
        education_excluded_institutions: [],
      });
      const candidate = buildCandidate();

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'education')).toEqual(
        expect.objectContaining({ applicable: false }),
      );
    });

    it('matches degree text against education_levels, case-insensitively', () => {
      const filter = buildFilter({ education_levels: ["bachelor's"] });
      const candidate = buildCandidate({
        education: [buildEducation({ degree: "Bachelor's Degree" })],
      });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'education')).toEqual(
        expect.objectContaining({ weight: 15, earned: 15, applicable: true }),
      );
    });

    it('matches institution name against education_institution via substring', () => {
      const filter = buildFilter({ education_institution: ['Oxford'] });
      const candidate = buildCandidate({
        education: [
          buildEducation({ institution_name: 'University of Oxford' }),
        ],
      });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'education')).toEqual(
        expect.objectContaining({ earned: 15, applicable: true }),
      );
    });

    it('zeroes the category when the candidate attended an excluded institution', () => {
      const filter = buildFilter({
        education_institution: ['Oxford'],
        education_excluded_institutions: ['Excluded University'],
      });
      const candidate = buildCandidate({
        education: [
          buildEducation({ institution_name: 'Excluded University' }),
        ],
      });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'education')).toEqual(
        expect.objectContaining({ earned: 0, applicable: true }),
      );
    });

    it('averages the levels and institution fractions when both are specified', () => {
      const filter = buildFilter({
        education_levels: ["bachelor's"],
        education_institution: ['Oxford'],
      });
      const candidate = buildCandidate({
        education: [
          buildEducation({
            degree: "Bachelor's Degree",
            institution_name: 'Some Other School',
          }),
        ],
      });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'education')).toEqual(
        expect.objectContaining({ earned: 7.5 }),
      );
    });
  });

  describe('languages category', () => {
    it('is not applicable when the filter has no language criteria', () => {
      const filter = buildFilter({
        required_languages: [],
        optional_languages: [],
      });
      const candidate = buildCandidate();

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'languages')).toEqual(
        expect.objectContaining({ applicable: false }),
      );
    });

    it('scores entirely on required languages when only required is set', () => {
      const filter = buildFilter({ required_languages: ['English'] });
      const candidate = buildCandidate({ languages: ['English'] });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'languages')).toEqual(
        expect.objectContaining({ weight: 5, earned: 5, applicable: true }),
      );
    });

    it('scores entirely on optional languages when only optional is set', () => {
      const filter = buildFilter({ optional_languages: ['Spanish'] });
      const candidate = buildCandidate({ languages: [] });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'languages')).toEqual(
        expect.objectContaining({ earned: 0, applicable: true }),
      );
    });

    it('weights required 70% and optional 30% when both are set', () => {
      const filter = buildFilter({
        required_languages: ['English'],
        optional_languages: ['Spanish'],
      });
      const candidate = buildCandidate({ languages: ['English'] });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'languages')).toEqual(
        expect.objectContaining({ earned: 3.5 }),
      );
    });
  });

  describe('location_eligibility category', () => {
    it('is not applicable when the filter has no location/remote/work-auth requirement', () => {
      const filter = buildFilter({
        country_code: '',
        remote_work: false,
        work_authorization_required: false,
      });
      const candidate = buildCandidate();

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'location_eligibility')).toEqual(
        expect.objectContaining({ applicable: false }),
      );
    });

    it('awards credit when the candidate is located in the required country', () => {
      const filter = buildFilter({ country_code: 'GB' });
      const candidate = buildCandidate({
        current_location_country_code: 'GB',
      });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'location_eligibility')).toEqual(
        expect.objectContaining({ weight: 15, earned: 15, applicable: true }),
      );
    });

    it('awards credit when the candidate is elsewhere but open to relocation', () => {
      const filter = buildFilter({ country_code: 'GB' });
      const candidate = buildCandidate({
        current_location_country_code: 'US',
        open_to_relocation: true,
      });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'location_eligibility')).toEqual(
        expect.objectContaining({ earned: 15 }),
      );
    });

    it('averages multiple active sub-checks', () => {
      const filter = buildFilter({
        country_code: 'GB',
        remote_work: true,
      });
      const candidate = buildCandidate({
        current_location_country_code: 'GB',
        open_to_remote_work: false,
      });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'location_eligibility')).toEqual(
        expect.objectContaining({ earned: 7.5 }),
      );
    });

    it('checks for a work authorization status on file when required', () => {
      const filter = buildFilter({ work_authorization_required: true });
      const withStatus = service.scoreCandidate(
        filter,
        buildCandidate({ current_work_authorization_status: 'Citizen' }),
      );
      const withoutStatus = service.scoreCandidate(
        filter,
        buildCandidate({ current_work_authorization_status: null }),
      );

      expect(
        findCategory(withStatus.breakdown, 'location_eligibility')?.earned,
      ).toBe(15);
      expect(
        findCategory(withoutStatus.breakdown, 'location_eligibility')?.earned,
      ).toBe(0);
    });
  });

  describe('diversity category', () => {
    it('is not applicable when the filter has no diversity criteria', () => {
      const filter = buildFilter({ diversity: [] });
      const candidate = buildCandidate();

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'diversity')).toEqual(
        expect.objectContaining({ applicable: false }),
      );
    });

    it('awards partial credit proportional to how many diversity tags match', () => {
      const filter = buildFilter({
        diversity: ['Veteran', 'Underrepresented'],
      });
      const candidate = buildCandidate({ diversity: ['Veteran'] });

      const result = service.scoreCandidate(filter, candidate);

      expect(findCategory(result.breakdown, 'diversity')).toEqual(
        expect.objectContaining({ weight: 5, earned: 2.5, applicable: true }),
      );
    });
  });
});
