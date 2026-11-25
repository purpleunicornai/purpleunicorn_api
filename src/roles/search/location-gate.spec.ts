import {
  countryCodeFromName,
  countryName,
  isOutsideRoleLocation,
} from './location-gate';
import { ParsedFilterRow, ParsedLocation } from './role-filter-parser';

function role(
  overrides: Partial<ParsedLocation> = {},
  row: Partial<ParsedFilterRow<ParsedLocation>> = {},
): ParsedFilterRow<ParsedLocation> {
  return {
    priority: 'ESSENTIAL',
    nonNegotiable: false,
    ...row,
    value: {
      countryCode: 'ZA',
      regions: [{ type: 'city', value: 'Cape Town' }],
      remoteWork: false,
      workAuthorizationRequired: false,
      ...overrides,
    },
  };
}

describe('countryName', () => {
  it('names ISO country codes', () => {
    expect(countryName('ZA')).toBe('South Africa');
    expect(countryName('gb')).toBe('United Kingdom');
    expect(countryName('')).toBeUndefined();
  });
});

describe('countryCodeFromName', () => {
  it('resolves names, aliases and ISO codes', () => {
    expect(countryCodeFromName('South Africa')).toBe('ZA');
    expect(countryCodeFromName('USA')).toBe('US');
    expect(countryCodeFromName('za')).toBe('ZA');
    expect(countryCodeFromName('not a country')).toBeUndefined();
  });
});

describe('isOutsideRoleLocation', () => {
  it('drops a candidate in another named country', () => {
    expect(isOutsideRoleLocation('Austin, Texas, United States', role())).toBe(
      true,
    );
    expect(isOutsideRoleLocation('London, England, UK', role())).toBe(true);
  });

  it('keeps a candidate matching the region or the country', () => {
    expect(isOutsideRoleLocation('Cape Town, Western Cape', role())).toBe(
      false,
    );
    expect(isOutsideRoleLocation('Greater Cape Town Area', role())).toBe(false);
    expect(
      isOutsideRoleLocation('Johannesburg, Gauteng, South Africa', role()),
    ).toBe(false);
  });

  it('matches "Greater X Area" in either direction', () => {
    const london = role({
      countryCode: 'GB',
      regions: [{ type: 'city', value: 'Greater London' }],
    });
    expect(isOutsideRoleLocation('London', london)).toBe(false);
    expect(isOutsideRoleLocation('London Metropolitan Area', london)).toBe(
      false,
    );
    expect(isOutsideRoleLocation('Manchester, England', london)).toBe(false);
    expect(isOutsideRoleLocation('Berlin, Germany', london)).toBe(true);
  });

  it('keeps unknown or ambiguous locations', () => {
    expect(isOutsideRoleLocation(undefined, role())).toBe(false);
    expect(isOutsideRoleLocation('  ', role())).toBe(false);
    expect(isOutsideRoleLocation('San Francisco Bay Area', role())).toBe(false);
    expect(isOutsideRoleLocation('Johannesburg', role())).toBe(false);
  });

  it('does not read US states as countries', () => {
    const us = role({ countryCode: 'US', regions: [] });
    expect(isOutsideRoleLocation('Newark, New Jersey', us)).toBe(false);
    expect(isOutsideRoleLocation('Atlanta, Georgia', us)).toBe(false);
  });

  it('does not match a country inside a longer word', () => {
    // "Oman" sits inside "Romania"; only Romania should count.
    const oman = role({ countryCode: 'OM', regions: [] });
    expect(isOutsideRoleLocation('Bucharest, Romania', oman)).toBe(true);
    const romania = role({ countryCode: 'RO', regions: [] });
    expect(isOutsideRoleLocation('Bucharest, Romania', romania)).toBe(false);
  });

  it('never gates remote, optional, or missing role locations', () => {
    const elsewhere = 'Austin, Texas, United States';
    expect(isOutsideRoleLocation(elsewhere, role({ remoteWork: true }))).toBe(
      false,
    );
    expect(
      isOutsideRoleLocation(elsewhere, role({}, { priority: 'OPTIONAL' })),
    ).toBe(false);
    expect(
      isOutsideRoleLocation(
        elsewhere,
        role({}, { priority: 'OPTIONAL', nonNegotiable: true }),
      ),
    ).toBe(true);
    expect(isOutsideRoleLocation(elsewhere, undefined)).toBe(false);
  });
});

describe('isOutsideRoleLocation with work types', () => {
  it.each([[['ONSITE']], [['HYBRID']]] as const)(
    'drops someone in another country for %j',
    (workTypes) => {
      expect(
        isOutsideRoleLocation(
          'Austin, Texas, United States',
          role({ workTypes: [...workTypes], remoteWork: false }),
        ),
      ).toBe(true);
    },
  );

  it('keeps people anywhere once REMOTE is allowed', () => {
    expect(
      isOutsideRoleLocation(
        'Austin, Texas, United States',
        role({ workTypes: ['ONSITE', 'REMOTE'], remoteWork: true }),
      ),
    ).toBe(false);
  });
});
