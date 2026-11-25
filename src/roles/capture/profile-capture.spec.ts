import { CandidateScoringService } from '../search/candidate-scoring.service';
import type { ScoringFacts } from '../search/candidate-scoring.service';
import type { ParsedRoleFilters } from '../search/role-filter-parser';
import type { CapturedProfileDto } from './captured-profile.dto';
import {
  captureView,
  capturedCandidateFields,
  capturedEducationRows,
  experienceYears,
  profileSlug,
} from './profile-capture';

const profile = (
  over: Partial<CapturedProfileDto> = {},
): CapturedProfileDto => ({
  linkedinUrl: 'https://za.linkedin.com/in/thandiwe-nkosi/?trk=x',
  name: 'Thandiwe Nkosi',
  ...over,
});

const facts = (over: Partial<ScoringFacts> = {}): ScoringFacts => ({
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
  ...over,
});

const filters = (over: Partial<ParsedRoleFilters> = {}): ParsedRoleFilters => ({
  jobTitles: [],
  skills: [],
  languages: [],
  companies: [],
  education: [],
  ...over,
});

describe('profileSlug', () => {
  it('reads the same slug from any LinkedIn host, slash or tracking param', () => {
    expect(
      profileSlug('https://za.linkedin.com/in/Thandiwe-Nkosi/?trk=x'),
    ).toBe('thandiwe-nkosi');
    expect(profileSlug('https://www.linkedin.com/in/thandiwe-nkosi')).toBe(
      'thandiwe-nkosi',
    );
  });

  it('rejects pages that are not a profile', () => {
    expect(profileSlug('https://www.linkedin.com/jobs/view/1')).toBeUndefined();
    expect(profileSlug('not a url')).toBeUndefined();
    expect(profileSlug('https://example.com/in/someone')).toBeUndefined();
  });
});

describe('capturedCandidateFields', () => {
  it('maps what the page showed and nothing else', () => {
    expect(
      capturedCandidateFields(
        profile({
          headline: 'Finance Manager at Northvale',
          location: 'Cape Town, Western Cape, South Africa',
          skills: ['IFRS', 'ifrs', 'ReactJS'],
        }),
      ),
    ).toEqual({
      first_name: 'Thandiwe',
      last_name: 'Nkosi',
      current_location_city: 'Cape Town',
      current_location_country_code: 'ZA',
      current_title: 'Finance Manager at Northvale',
      skills: ['ifrs', 'react'],
    });
  });

  it('prefers the current role’s title over the headline', () => {
    expect(
      capturedCandidateFields(
        profile({
          headline: 'Ex-Big4 | CA(SA)',
          currentTitle: 'Finance Manager',
        }),
      ).current_title,
    ).toBe('Finance Manager');
  });

  it('drops LinkedIn’s grey placeholder photo', () => {
    expect(
      capturedCandidateFields(
        profile({ imageUrl: 'https://static.licdn.com/aero-v1/ghost.svg' }),
      ),
    ).not.toHaveProperty('image_url');
  });
});

describe('experienceYears', () => {
  it('counts whole years from the earliest dated role', () => {
    const now = new Date('2026-11-18T00:00:00Z');
    expect(
      experienceYears(
        profile({
          experience: [
            { title: 'A', company: 'X', startDate: '2021-03-01' },
            {
              title: 'B',
              company: 'Y',
              startDate: '2018-01-01',
              endDate: '2021-02-01',
            },
          ],
        }),
        now,
      ),
    ).toBe(8);
    expect(experienceYears(profile(), now)).toBeNull();
  });
});

describe('capturedEducationRows', () => {
  it('skips rows without a start date and guesses the institution type', () => {
    const rows = capturedEducationRows(
      profile({
        education: [
          { institution: 'University of Cape Town', startDate: '2010-01-01' },
          { institution: 'SAICA', degree: 'CA(SA)' },
        ],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      institution_name: 'University of Cape Town',
      institution_type: 'UNIVERSITY',
    });
  });
});

describe('captureView', () => {
  it('lists each applicable row as met, partial or missed, and the skills', () => {
    const roleFilters = filters({
      skills: [
        {
          value: ['IFRS', 'SAP', 'Power BI'],
          priority: 'ESSENTIAL',
          nonNegotiable: false,
        },
      ],
      jobTitles: [
        {
          value: { titles: ['Finance Manager'] } as never,
          priority: 'ESSENTIAL',
          nonNegotiable: true,
        },
      ],
    });
    const candidateFacts = facts({
      skills: ['ifrs', 'sap'],
      titles: ['Treasury Lead'],
    });
    const result = new CandidateScoringService().scoreFacts(
      roleFilters,
      candidateFacts,
    );

    const view = captureView(roleFilters, candidateFacts, result);

    expect(view.matchedSkills).toEqual(['IFRS', 'SAP']);
    expect(view.missingSkills).toEqual(['Power BI']);
    expect(view.checks.map((check) => [check.category, check.outcome])).toEqual(
      [
        ['skills', 'partial'],
        ['job_titles', 'missed'],
      ],
    );
    expect(view.disqualified).toBe(true);
    expect(view.score).toBe(0);
  });
});
