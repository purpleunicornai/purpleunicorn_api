import { ParsedRoleFilters } from './role-filter-parser';
import {
  countryName,
  isKnownWrongCountry,
  qualificationAliases,
  resolveRegionNames,
  sameCountry,
  textContainsTerm,
} from './filter-terms';

// The library loads its data with a dynamic import that Jest's VM can't run
// (same reason countries.service.spec mocks it); the real call is checked
// against Node in the commit's verification script.
jest.mock('@countrystatecity/countries', () => ({
  getStateByCode: jest.fn((countryCode: string, stateCode: string) =>
    Promise.resolve(
      countryCode === 'ZA' && stateCode === 'WC'
        ? { name: 'Western Cape' }
        : undefined,
    ),
  ),
}));

describe('filter-terms', () => {
  it('expands CA(SA) however it is typed', () => {
    for (const typed of ['CA(SA)', 'CA (SA)', 'ca sa']) {
      expect(qualificationAliases(typed)).toEqual([
        'CA(SA)',
        'Chartered Accountant',
        'SAICA',
      ]);
    }
    expect(qualificationAliases('MBA')).toEqual(['MBA']);
  });

  it('matches terms on word boundaries, ignoring punctuation', () => {
    expect(textContainsTerm('Finance Manager | CA (SA)', 'CA(SA)')).toBe(true);
    expect(textContainsTerm('Based in Casablanca', 'CA(SA)')).toBe(false);
    expect(textContainsTerm(null, 'CA(SA)')).toBe(false);
  });

  it('maps ISO codes to country names and compares either form', () => {
    expect(countryName('ZA')).toBe('South Africa');
    expect(countryName('nope')).toBeUndefined();
    expect(sameCountry('za', 'ZA')).toBe(true);
    expect(sameCountry('South Africa', 'ZA')).toBe(true);
    expect(sameCountry('US', 'ZA')).toBe(false);
    expect(sameCountry(null, 'ZA')).toBe(false);
  });

  it('flags only a known, different country when the location is required', () => {
    const filters = (
      priority: 'ESSENTIAL' | 'OPTIONAL',
      remoteWork = false,
    ): ParsedRoleFilters => ({
      jobTitles: [],
      skills: [],
      languages: [],
      companies: [],
      education: [],
      location: {
        value: {
          countryCode: 'ZA',
          regions: [],
          remoteWork,
          workAuthorizationRequired: false,
        },
        priority,
        nonNegotiable: false,
      },
    });

    expect(isKnownWrongCountry(filters('ESSENTIAL'), 'US', false)).toBe(true);
    expect(isKnownWrongCountry(filters('ESSENTIAL'), 'za', false)).toBe(false);
    expect(
      isKnownWrongCountry(filters('ESSENTIAL'), 'South Africa', null),
    ).toBe(false);
    expect(isKnownWrongCountry(filters('ESSENTIAL'), null, false)).toBe(false);
    expect(isKnownWrongCountry(filters('ESSENTIAL'), 'US', true)).toBe(false);
    expect(isKnownWrongCountry(filters('OPTIONAL'), 'US', false)).toBe(false);
    expect(isKnownWrongCountry(filters('ESSENTIAL', true), 'US', false)).toBe(
      false,
    );
  });

  it('resolves stored province codes to names and passes city names through', async () => {
    await expect(
      resolveRegionNames({
        countryCode: 'ZA',
        regions: [
          { type: 'province', value: 'WC' },
          { type: 'province', value: 'Cape Town' },
        ],
        remoteWork: false,
        workAuthorizationRequired: false,
      }),
    ).resolves.toEqual(['Western Cape', 'Cape Town']);
  });
});
