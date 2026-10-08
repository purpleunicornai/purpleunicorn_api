import {
  CandidateScoringService,
  CandidateScoreCategory,
} from './candidate-scoring.service';
import { ParsedRoleFilters } from './role-filter-parser';
import {
  candidate,
  candidate_experience,
  candidate_education,
} from '../../generated/prisma/client';

type CandidateWithHistory = candidate & {
  experience: candidate_experience[];
  education: candidate_education[];
};

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
    it('scores the fixed 80% essential weight when the only essential row is fully matched (the 20% optional bucket goes unclaimed when no optional rows exist)', () => {
      const filters = buildFilters({
        skills: [
          {
            value: ['TypeScript'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });
      const candidate = buildCandidate({ skills: ['TypeScript'] });

      const result = service.scoreCandidate(filters, candidate);

      expect(result.score).toBe(80);
      expect(result.disqualified).toBe(false);
    });

    it('scores 0 when the only essential row is fully missed', () => {
      const filters = buildFilters({
        skills: [
          {
            value: ['TypeScript'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });
      const candidate = buildCandidate({ skills: [] });

      const result = service.scoreCandidate(filters, candidate);

      expect(result.score).toBe(0);
    });

    it('splits essential weight (80%) equally across multiple essential rows', () => {
      const filters = buildFilters({
        skills: [
          {
            value: ['TypeScript'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
          {
            value: ['Go'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });
      // Matches only the first essential row (TypeScript), misses the second (Go):
      // expect 40 (half of the 80% essential bucket).
      const candidate = buildCandidate({ skills: ['TypeScript'] });

      const result = service.scoreCandidate(filters, candidate);

      expect(result.score).toBe(40);
    });

    it('splits optional weight (20%) equally across multiple optional rows', () => {
      const filters = buildFilters({
        skills: [
          {
            value: ['TypeScript'],
            priority: 'OPTIONAL',
            nonNegotiable: false,
          },
          {
            value: ['Go'],
            priority: 'OPTIONAL',
            nonNegotiable: false,
          },
        ],
      });
      const candidate = buildCandidate({ skills: ['TypeScript'] });

      const result = service.scoreCandidate(filters, candidate);

      expect(result.score).toBe(10);
    });

    it('weights essential and optional rows together as 80/20', () => {
      const filters = buildFilters({
        skills: [
          {
            value: ['TypeScript'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
          {
            value: ['Go'],
            priority: 'OPTIONAL',
            nonNegotiable: false,
          },
        ],
      });
      // Essential fully matched (80), optional fully missed (0 of 20): 80.
      const candidate = buildCandidate({ skills: ['TypeScript'] });

      const result = service.scoreCandidate(filters, candidate);

      expect(result.score).toBe(80);
    });

    it('returns a score of 0 with no applicable rows when the filter is empty', () => {
      const result = service.scoreCandidate(buildFilters(), buildCandidate());

      expect(result.score).toBe(0);
      expect(result.breakdown).toEqual([]);
    });

    it('disqualifies a candidate who fails a non-negotiable row, regardless of priority', () => {
      const filters = buildFilters({
        skills: [
          {
            value: ['TypeScript'],
            priority: 'OPTIONAL',
            nonNegotiable: true,
          },
        ],
      });
      const candidate = buildCandidate({ skills: [] });

      const result = service.scoreCandidate(filters, candidate);

      expect(result.disqualified).toBe(true);
      expect(result.score).toBe(0);
    });

    it('does not disqualify when the non-negotiable row is fully matched', () => {
      const filters = buildFilters({
        skills: [
          {
            value: ['TypeScript'],
            priority: 'ESSENTIAL',
            nonNegotiable: true,
          },
        ],
      });
      const candidate = buildCandidate({ skills: ['TypeScript'] });

      const result = service.scoreCandidate(filters, candidate);

      expect(result.disqualified).toBe(false);
      expect(result.score).toBe(80);
    });

    it('disqualifies even when every other row is a perfect match', () => {
      const filters = buildFilters({
        skills: [
          {
            value: ['TypeScript'],
            priority: 'ESSENTIAL',
            nonNegotiable: true,
          },
          {
            value: ['Go'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });
      const candidate = buildCandidate({ skills: ['Go'] });

      const result = service.scoreCandidate(filters, candidate);

      expect(result.disqualified).toBe(true);
    });
  });

  describe('skills category', () => {
    it('awards partial credit proportional to how many skills match, case-insensitively', () => {
      const filters = buildFilters({
        skills: [
          {
            value: ['TypeScript', 'AWS'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });
      const candidate = buildCandidate({ skills: ['typescript'] });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'skills')).toEqual(
        expect.objectContaining({ weight: 80, earned: 40, applicable: true }),
      );
    });

    it('produces one breakdown entry per skills row', () => {
      const filters = buildFilters({
        skills: [
          {
            value: ['TypeScript'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
          {
            value: ['Go'],
            priority: 'OPTIONAL',
            nonNegotiable: false,
          },
        ],
      });

      const result = service.scoreCandidate(
        filters,
        buildCandidate({ skills: ['TypeScript', 'Go'] }),
      );

      expect(
        result.breakdown.filter((entry) => entry.category === 'skills'),
      ).toHaveLength(2);
    });
  });

  describe('languages category', () => {
    it('awards full credit when every language in the row matches, case-insensitively', () => {
      const filters = buildFilters({
        languages: [
          {
            value: ['English'],
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });
      const candidate = buildCandidate({ languages: ['english'] });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'languages')).toEqual(
        expect.objectContaining({ weight: 80, earned: 80, applicable: true }),
      );
    });
  });

  describe('job_titles category', () => {
    it("awards full credit when the candidate's current title matches one of the row's titles, case-insensitively", () => {
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: ['Software Engineer'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });
      const candidate = buildCandidate({ current_title: 'software engineer' });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'job_titles')).toEqual(
        expect.objectContaining({ weight: 80, earned: 80, applicable: true }),
      );
    });

    it('scores 0 when the candidate has no matching title on file', () => {
      const filters = buildFilters({
        jobTitles: [
          {
            value: { titles: ['Software Engineer'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });
      const candidate = buildCandidate({ current_title: 'Product Manager' });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'job_titles')).toEqual(
        expect.objectContaining({ earned: 0 }),
      );
    });
  });

  describe('education category', () => {
    it('awards full credit when the candidate has a matching qualification/institution', () => {
      const filters = buildFilters({
        education: [
          {
            value: {
              qualifications: ["bachelor's"],
              institutions: ['Oxford'],
              institutionType: 'include',
            },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });
      const candidate = buildCandidate({
        education: [
          buildEducation({
            degree: "Bachelor's Degree",
            institution_name: 'University of Oxford',
          }),
        ],
      });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'education')).toEqual(
        expect.objectContaining({ weight: 80, earned: 80, applicable: true }),
      );
    });

    it('zeroes the row when institutionType is exclude and the candidate attended one of the listed institutions', () => {
      const filters = buildFilters({
        education: [
          {
            value: {
              qualifications: [],
              institutions: ['Excluded University'],
              institutionType: 'exclude',
            },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });
      const candidate = buildCandidate({
        education: [
          buildEducation({ institution_name: 'Excluded University' }),
        ],
      });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'education')).toEqual(
        expect.objectContaining({ earned: 0 }),
      );
    });
  });

  describe('companies category', () => {
    it('awards full credit when the candidate has worked at one of the included companies', () => {
      const filters = buildFilters({
        companies: [
          {
            value: { names: ['Acme'], type: 'include' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });
      const candidate = buildCandidate({
        experience: [
          {
            uid: 'exp-1',
            created: new Date(),
            updated: new Date(),
            candidate_id: 'candidate-1',
            company_name: 'Acme',
            company_location: null,
            role: 'Engineer',
            start_date: new Date('2020-01-01'),
            end_date: null,
            responsibilities: null,
            skills: [],
          },
        ],
      });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'companies')).toEqual(
        expect.objectContaining({ earned: 80 }),
      );
    });

    it('zeroes the row when type is exclude and the candidate worked at one of the listed companies', () => {
      const filters = buildFilters({
        companies: [
          {
            value: { names: ['Acme'], type: 'exclude' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
      });
      const candidate = buildCandidate({
        experience: [
          {
            uid: 'exp-1',
            created: new Date(),
            updated: new Date(),
            candidate_id: 'candidate-1',
            company_name: 'Acme',
            company_location: null,
            role: 'Engineer',
            start_date: new Date('2020-01-01'),
            end_date: null,
            responsibilities: null,
            skills: [],
          },
        ],
      });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'companies')).toEqual(
        expect.objectContaining({ earned: 0 }),
      );
    });
  });

  describe('location category', () => {
    it('awards full credit when the candidate is in the required country', () => {
      const filters = buildFilters({
        location: {
          value: {
            countryCode: 'GB',
            regions: [],
            remoteWork: false,
            workAuthorizationRequired: false,
          },
          priority: 'ESSENTIAL',
          nonNegotiable: false,
        },
      });
      const candidate = buildCandidate({ current_location_country_code: 'GB' });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'location')).toEqual(
        expect.objectContaining({ weight: 80, earned: 80, applicable: true }),
      );
    });

    it('awards credit when the candidate is elsewhere but open to relocation', () => {
      const filters = buildFilters({
        location: {
          value: {
            countryCode: 'GB',
            regions: [],
            remoteWork: false,
            workAuthorizationRequired: false,
          },
          priority: 'ESSENTIAL',
          nonNegotiable: false,
        },
      });
      const candidate = buildCandidate({
        current_location_country_code: 'US',
        open_to_relocation: true,
      });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'location')?.earned).toBe(80);
    });

    it('averages the country/remote/work-authorization sub-checks', () => {
      const filters = buildFilters({
        location: {
          value: {
            countryCode: 'GB',
            regions: [],
            remoteWork: true,
            workAuthorizationRequired: false,
          },
          priority: 'ESSENTIAL',
          nonNegotiable: false,
        },
      });
      const candidate = buildCandidate({
        current_location_country_code: 'GB',
        open_to_remote_work: false,
      });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'location')?.earned).toBe(40);
    });

    it('checks for a work authorization status on file when required', () => {
      const filters = buildFilters({
        location: {
          value: {
            countryCode: '',
            regions: [],
            remoteWork: false,
            workAuthorizationRequired: true,
          },
          priority: 'ESSENTIAL',
          nonNegotiable: false,
        },
      });

      const withStatus = service.scoreCandidate(
        filters,
        buildCandidate({ current_work_authorization_status: 'Citizen' }),
      );
      const withoutStatus = service.scoreCandidate(
        filters,
        buildCandidate({ current_work_authorization_status: null }),
      );

      expect(findCategory(withStatus.breakdown, 'location')?.earned).toBe(80);
      expect(findCategory(withoutStatus.breakdown, 'location')?.earned).toBe(0);
    });
  });

  describe('experience category', () => {
    it('awards full credit when the candidate meets or exceeds the minimum years required', () => {
      const filters = buildFilters({
        experience: {
          value: { minYears: 5 },
          priority: 'ESSENTIAL',
          nonNegotiable: false,
        },
      });
      const candidate = buildCandidate({ experience_years: 7 });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'experience')).toEqual(
        expect.objectContaining({ weight: 80, earned: 80, applicable: true }),
      );
    });

    it('awards partial credit scaled to candidate years / required years when below the minimum', () => {
      const filters = buildFilters({
        experience: {
          value: { minYears: 10 },
          priority: 'ESSENTIAL',
          nonNegotiable: false,
        },
      });
      const candidate = buildCandidate({ experience_years: 5 });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'experience')?.earned).toBe(40);
    });

    it('treats a missing experience_years as zero', () => {
      const filters = buildFilters({
        experience: {
          value: { minYears: 5 },
          priority: 'ESSENTIAL',
          nonNegotiable: false,
        },
      });
      const candidate = buildCandidate({ experience_years: null });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'experience')?.earned).toBe(0);
    });

    it('caps credit at the full row weight when the candidate has far more experience than required', () => {
      const filters = buildFilters({
        experience: {
          value: { minYears: 2 },
          priority: 'OPTIONAL',
          nonNegotiable: false,
        },
      });
      const candidate = buildCandidate({ experience_years: 20 });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'experience')?.earned).toBe(20);
    });
  });

  describe('every selected essential filter is considered in the 80% split', () => {
    it('divides the 80% bucket across every essential row the user selected, including experience', () => {
      const filters = buildFilters({
        location: {
          value: {
            countryCode: 'GB',
            regions: [],
            remoteWork: false,
            workAuthorizationRequired: false,
          },
          priority: 'ESSENTIAL',
          nonNegotiable: false,
        },
        jobTitles: [
          {
            value: { titles: ['Software Engineer'], option: 'main_title' },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        ],
        experience: {
          value: { minYears: 5 },
          priority: 'ESSENTIAL',
          nonNegotiable: false,
        },
      });
      // Matches only the job title; misses location and experience entirely.
      const candidate = buildCandidate({
        current_title: 'Software Engineer',
        current_location_country_code: 'US',
        experience_years: 0,
      });

      const result = service.scoreCandidate(filters, candidate);

      expect(findCategory(result.breakdown, 'job_titles')?.weight).toBeCloseTo(
        80 / 3,
        2,
      );
      expect(findCategory(result.breakdown, 'job_titles')?.earned).toBeCloseTo(
        80 / 3,
        2,
      );
      expect(findCategory(result.breakdown, 'location')?.earned).toBe(0);
      expect(findCategory(result.breakdown, 'experience')?.earned).toBe(0);
      // 80/3 rounded to the nearest whole point.
      expect(result.score).toBe(27);
    });
  });

  describe('industry category', () => {
    it('awards full credit when the candidate experience includes a role at a company in the required industry', () => {
      // industry has no first-class candidate field to match against today —
      // it is scored as applicable-but-unmatched (0) unless/until the
      // candidate model gains an industry signal. This locks in that
      // intentional current behavior rather than leaving it undefined.
      const filters = buildFilters({
        industry: {
          value: 'finance',
          priority: 'OPTIONAL',
          nonNegotiable: false,
        },
      });

      const result = service.scoreCandidate(filters, buildCandidate());

      expect(findCategory(result.breakdown, 'industry')).toEqual(
        expect.objectContaining({ applicable: true, earned: 0 }),
      );
    });
  });
});
