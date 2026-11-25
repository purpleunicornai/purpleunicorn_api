import { broadenFilters } from './broaden-filters';
import { buildSearchQuery } from './build-search-query';
import { ParsedFilterRow, ParsedRoleFilters } from './role-filter-parser';

const row = <T>(
  value: T,
  priority: 'ESSENTIAL' | 'OPTIONAL' = 'ESSENTIAL',
  nonNegotiable = false,
): ParsedFilterRow<T> => ({ value, priority, nonNegotiable });

const filters = (over: Partial<ParsedRoleFilters> = {}): ParsedRoleFilters => ({
  jobTitles: [row({ titles: ['Head of Design'], option: 'main_title' })],
  location: row({
    countryCode: 'ZA',
    regions: [],
    remoteWork: false,
    workAuthorizationRequired: false,
  }),
  skills: [],
  languages: [],
  companies: [],
  education: [],
  ...over,
});

describe('broadenFilters', () => {
  it('keeps titles, location and non-negotiables and drops the other essentials from the query', () => {
    const strict = filters({
      skills: [
        row(['Adobe Creative Suite']),
        row(['Figma'], 'ESSENTIAL', true),
      ],
      education: [
        row({
          qualifications: ['Degree in Design'],
          institutions: [],
          institutionType: 'include',
        }),
      ],
      companies: [row({ names: ['Acme'], type: 'exclude' })],
    });

    const query = buildSearchQuery(broadenFilters(strict)!);

    expect(query).toContain('"Head of Design"');
    expect(query).toContain('"South Africa"');
    expect(query).toContain('"Figma"');
    expect(query).toContain('-"Acme"');
    expect(query).not.toContain('Adobe');
    expect(query).not.toContain('Degree');
    expect(query.length).toBeLessThan(buildSearchQuery(strict).length);
  });

  it('is null when nothing would widen, so there is nothing deeper to look at', () => {
    expect(broadenFilters(filters())).toBeNull();
    expect(
      broadenFilters(filters({ skills: [row(['Figma'], 'OPTIONAL')] })),
    ).toBeNull();
    expect(
      broadenFilters(filters({ skills: [row(['Figma'], 'ESSENTIAL', true)] })),
    ).toBeNull();
  });
});
