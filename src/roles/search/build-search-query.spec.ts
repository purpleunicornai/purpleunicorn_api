import { LINKEDIN_PROFILE_SITE } from '../../common/constants/google';
import { buildSearchQuery, planSearchQueries } from './build-search-query';
import { CriterionExpansions } from './criterion-expansions';
import { ParsedRoleFilters } from './role-filter-parser';

const sitesGroup = LINKEDIN_PROFILE_SITE;

function emptyFilters(
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

function essential<T>(value: T) {
  return { priority: 'ESSENTIAL' as const, nonNegotiable: false, value };
}

function optional<T>(value: T, nonNegotiable = false) {
  return { priority: 'OPTIONAL' as const, nonNegotiable, value };
}

describe('buildSearchQuery', () => {
  it('always leads with the LinkedIn profile site filter', () => {
    expect(buildSearchQuery(emptyFilters())).toBe(sitesGroup);
  });

  it('builds one quoted-OR group per mandatory filter, space-joined', () => {
    expect(
      buildSearchQuery(
        emptyFilters({
          jobTitles: [
            essential({
              titles: ['engineer', 'BEng'],
              option: 'main_title',
            }),
          ],
          industry: essential('Fintech'),
        }),
      ),
    ).toBe(`${sitesGroup} ("engineer" OR "BEng") ("Fintech")`);
  });

  it('uses resolved region names and adds "remote" when remote_work is set', () => {
    expect(
      buildSearchQuery(
        emptyFilters({
          location: essential({
            countryCode: 'ZA',
            regions: [{ type: 'province', value: 'GP' }],
            remoteWork: true,
            workAuthorizationRequired: false,
          }),
        }),
        { regionNames: ['Gauteng'] },
      ),
    ).toBe(`${sitesGroup} ("Gauteng" OR "remote")`);
  });

  it('falls back to the country name when no region is named', () => {
    expect(
      buildSearchQuery(
        emptyFilters({
          location: essential({
            countryCode: 'ZA',
            regions: [],
            remoteWork: false,
            workAuthorizationRequired: false,
          }),
        }),
      ),
    ).toBe(`${sitesGroup} ("South Africa")`);
  });

  it('excludes OPTIONAL filters unless flagged non_negotiable', () => {
    expect(
      buildSearchQuery(
        emptyFilters({
          skills: [optional(['React']), optional(['TypeScript'], true)],
        }),
      ),
    ).toBe(`${sitesGroup} ("TypeScript")`);
  });

  it('negates excluded companies instead of OR-grouping them', () => {
    expect(
      buildSearchQuery(
        emptyFilters({
          companies: [
            essential({ names: ['Acme', 'Globex'], type: 'exclude' }),
          ],
        }),
      ),
    ).toBe(`${sitesGroup} -"Acme" -"Globex"`);
  });

  it('splits education into a qualifications group and an institutions group, with aliases', () => {
    expect(
      buildSearchQuery(
        emptyFilters({
          education: [
            essential({
              qualifications: ['CA (SA)'],
              institutions: ['Wits', 'UJ'],
              institutionType: 'include',
            }),
          ],
        }),
      ),
    ).toBe(
      `${sitesGroup} ("CA(SA)" OR "Chartered Accountant" OR "SAICA") ("Wits" OR "UJ")`,
    );
  });

  it('omits experience minYears and optional location or education', () => {
    expect(
      buildSearchQuery(
        emptyFilters({
          location: optional({
            countryCode: 'ZA',
            regions: [{ type: 'city', value: 'Cape Town' }],
            remoteWork: false,
            workAuthorizationRequired: false,
          }),
          education: [
            optional({
              qualifications: ['CA (SA)'],
              institutions: [],
              institutionType: 'include',
            }),
          ],
          experience: essential({ minYears: 5 }),
        }),
      ),
    ).toBe(sitesGroup);
  });

  it('can build a location-only or remote-only clause', () => {
    const filters = emptyFilters({
      location: essential({
        countryCode: 'ZA',
        regions: [{ type: 'city', value: 'Cape Town' }],
        remoteWork: true,
        workAuthorizationRequired: false,
      }),
    });

    expect(buildSearchQuery(filters, { locationMode: 'location' })).toBe(
      `${sitesGroup} ("Cape Town")`,
    );
    expect(buildSearchQuery(filters, { locationMode: 'remote' })).toBe(
      `${sitesGroup} ("remote")`,
    );
  });

  it('widens title and skill groups with saved expansions', () => {
    const expansions: CriterionExpansions = {
      version: 1,
      generatedAt: '2026-11-15T12:00:00.000Z',
      model: 'gemini-3.5-flash',
      byCategory: {
        job_titles: [
          {
            seed: 'founder',
            terms: ['founder', 'co-founder', 'entrepreneur'],
          },
        ],
        skills: [
          { seed: 'React Native', terms: ['React Native', 'RN', 'Expo'] },
        ],
      },
    };

    expect(
      buildSearchQuery(
        emptyFilters({
          jobTitles: [essential({ titles: ['founder'], option: 'main_title' })],
          skills: [essential(['React Native'])],
        }),
        { expansions },
      ),
    ).toBe(
      `${sitesGroup} ("founder" OR "co-founder" OR "entrepreneur") ("React Native" OR "RN" OR "Expo")`,
    );
  });

  it('falls back to the role name when no titles are set', () => {
    expect(
      buildSearchQuery(emptyFilters(), { roleName: 'Financial Manager' }),
    ).toBe(`${sitesGroup} ("Financial Manager")`);
  });
});

describe('planSearchQueries', () => {
  const titles: ParsedRoleFilters['jobTitles'] = [
    essential({
      titles: ['React Native Developer'],
      option: 'main_title',
    }),
  ];

  it('splits when remote is allowed and a region is named', () => {
    expect(
      planSearchQueries(
        emptyFilters({
          location: essential({
            countryCode: 'ZA',
            regions: [{ type: 'city', value: 'Cape Town' }],
            remoteWork: true,
            workAuthorizationRequired: false,
          }),
          jobTitles: titles,
        }),
      ),
    ).toEqual({
      kind: 'split',
      locationQuery: `${sitesGroup} ("Cape Town") ("React Native Developer")`,
      remoteQuery: `${sitesGroup} ("remote") ("React Native Developer")`,
    });
  });

  it('keeps a single query when remote is off, no region is named, or location is optional', () => {
    expect(
      planSearchQueries(
        emptyFilters({
          location: essential({
            countryCode: 'ZA',
            regions: [{ type: 'city', value: 'Cape Town' }],
            remoteWork: false,
            workAuthorizationRequired: false,
          }),
          jobTitles: titles,
        }),
      ),
    ).toEqual({
      kind: 'single',
      query: `${sitesGroup} ("Cape Town") ("React Native Developer")`,
    });

    expect(
      planSearchQueries(
        emptyFilters({
          location: essential({
            countryCode: 'ZA',
            regions: [],
            remoteWork: true,
            workAuthorizationRequired: false,
          }),
          jobTitles: titles,
        }),
      ),
    ).toEqual({
      kind: 'single',
      query: `${sitesGroup} ("South Africa" OR "remote") ("React Native Developer")`,
    });

    expect(
      planSearchQueries(
        emptyFilters({
          location: optional({
            countryCode: 'ZA',
            regions: [{ type: 'city', value: 'Cape Town' }],
            remoteWork: true,
            workAuthorizationRequired: false,
          }),
          jobTitles: titles,
        }),
      ),
    ).toEqual({
      kind: 'single',
      query: `${sitesGroup} ("React Native Developer")`,
    });
  });
});

describe('work types in the query', () => {
  const capeTown = (workTypes: ('ONSITE' | 'HYBRID' | 'REMOTE')[]) =>
    emptyFilters({
      location: essential({
        countryCode: 'ZA',
        regions: [{ type: 'city', value: 'Cape Town' }],
        remoteWork: workTypes.includes('REMOTE'),
        workTypes,
        workAuthorizationRequired: false,
      }),
    });

  it.each([[['ONSITE']], [['HYBRID']], [['ONSITE', 'HYBRID']]] as const)(
    'searches the place only, with no remote term, for %j',
    (workTypes) => {
      expect(planSearchQueries(capeTown([...workTypes]))).toEqual({
        kind: 'single',
        query: `${sitesGroup} ("Cape Town")`,
      });
    },
  );

  it('splits location-first when an on-site or hybrid role also allows remote', () => {
    expect(planSearchQueries(capeTown(['HYBRID', 'REMOTE']))).toEqual({
      kind: 'split',
      locationQuery: `${sitesGroup} ("Cape Town")`,
      remoteQuery: `${sitesGroup} ("remote")`,
    });
  });

  it('runs one remote query for a remote-only role, without the place', () => {
    expect(planSearchQueries(capeTown(['REMOTE']))).toEqual({
      kind: 'single',
      query: `${sitesGroup} ("remote")`,
    });
  });

  it('never puts the work types into the query as places', () => {
    const query = buildSearchQuery(capeTown(['ONSITE', 'HYBRID']));

    expect(query).not.toMatch(/ONSITE|HYBRID|on-site|hybrid/i);
  });

  it('keeps the legacy meaning when work types are unspecified', () => {
    const legacy = emptyFilters({
      location: essential({
        countryCode: 'ZA',
        regions: [{ type: 'city', value: 'Cape Town' }],
        remoteWork: true,
        workAuthorizationRequired: false,
      }),
    });

    expect(planSearchQueries(legacy).kind).toBe('split');
  });
});
