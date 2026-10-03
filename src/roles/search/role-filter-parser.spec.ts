import { parseRoleFilters } from './role-filter-parser';
import { role_filters, role_filter_child } from '../../generated/prisma/client';

type RoleFilterRow = role_filters & { children: role_filter_child[] };

function buildChild(
  overrides: Partial<role_filter_child> = {},
): role_filter_child {
  return {
    uid: 'child-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    parent_uid: 'filter-1',
    title: 'some_title',
    value: null,
    list_value: [],
    boolean: false,
    ...overrides,
  };
}

function buildRow(overrides: Partial<RoleFilterRow> = {}): RoleFilterRow {
  return {
    uid: 'filter-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    role_id: 'role-1',
    category: 'skills',
    value: null,
    list_value: [],
    priority: 'ESSENTIAL',
    non_negotiable: false,
    archived: false,
    archived_at: null,
    search_run_date: null,
    metadata: null,
    children: [],
    ...overrides,
  };
}

describe('parseRoleFilters', () => {
  it('parses a location row with sub-region children into countryCode/regions', () => {
    const rows = [
      buildRow({
        uid: 'filter-loc',
        category: 'location',
        value: 'ZA',
        priority: 'ESSENTIAL',
        children: [buildChild({ title: 'province', value: 'GP' })],
      }),
    ];

    const result = parseRoleFilters(rows);

    expect(result.location).toEqual({
      value: {
        countryCode: 'ZA',
        regions: [{ type: 'province', value: 'GP' }],
        remoteWork: false,
        workAuthorizationRequired: false,
      },
      priority: 'ESSENTIAL',
      nonNegotiable: false,
      filterId: 'filter-loc',
    });
  });

  it('reads remote_work and work_authorization booleans from location children', () => {
    const rows = [
      buildRow({
        category: 'location',
        value: 'GB',
        children: [
          buildChild({ title: 'remote_work', boolean: true }),
          buildChild({ title: 'work_authorization', boolean: true }),
        ],
      }),
    ];

    const result = parseRoleFilters(rows);

    expect(result.location?.value.remoteWork).toBe(true);
    expect(result.location?.value.workAuthorizationRequired).toBe(true);
  });

  it('leaves location undefined when there is no location row', () => {
    const result = parseRoleFilters([buildRow({ category: 'skills' })]);

    expect(result.location).toBeUndefined();
  });

  it('parses a job_titles row, defaulting to main_title when no title_option child is present', () => {
    const rows = [
      buildRow({
        uid: 'filter-title',
        category: 'job_titles',
        list_value: ['Head of Engineering'],
        priority: 'ESSENTIAL',
        children: [],
      }),
    ];

    const result = parseRoleFilters(rows);

    expect(result.jobTitles).toEqual([
      {
        value: { titles: ['Head of Engineering'], option: 'main_title' },
        priority: 'ESSENTIAL',
        nonNegotiable: false,
        filterId: 'filter-title',
      },
    ]);
  });

  it('parses an alternative job_titles row from the title_option child', () => {
    const rows = [
      buildRow({
        category: 'job_titles',
        list_value: ['Tech Lead', 'Team Lead'],
        priority: 'OPTIONAL',
        children: [
          buildChild({ title: 'title_option', value: 'alternative_title' }),
        ],
      }),
    ];

    const result = parseRoleFilters(rows);

    expect(result.jobTitles[0].value.option).toBe('alternative_title');
  });

  it('collects multiple job_titles rows (one per priority tier) into the array', () => {
    const rows = [
      buildRow({
        uid: 'f1',
        category: 'job_titles',
        list_value: ['Head of Engineering'],
        priority: 'ESSENTIAL',
      }),
      buildRow({
        uid: 'f2',
        category: 'job_titles',
        list_value: ['Tech Lead'],
        priority: 'OPTIONAL',
      }),
    ];

    const result = parseRoleFilters(rows);

    expect(result.jobTitles).toHaveLength(2);
  });

  it('collects skills rows by list_value, independent of how many rows exist', () => {
    const rows = [
      buildRow({
        uid: 'f1',
        category: 'skills',
        list_value: ['Leadership', 'React Native'],
        priority: 'ESSENTIAL',
      }),
      buildRow({
        uid: 'f2',
        category: 'skills',
        list_value: ['GraphQL'],
        priority: 'OPTIONAL',
      }),
    ];

    const result = parseRoleFilters(rows);

    expect(result.skills).toEqual([
      {
        value: ['Leadership', 'React Native'],
        priority: 'ESSENTIAL',
        nonNegotiable: false,
        filterId: 'f1',
      },
      {
        value: ['GraphQL'],
        priority: 'OPTIONAL',
        nonNegotiable: false,
        filterId: 'f2',
      },
    ]);
  });

  it('collects languages rows the same way as skills', () => {
    const rows = [
      buildRow({
        uid: 'f1',
        category: 'languages',
        list_value: ['English'],
        priority: 'ESSENTIAL',
      }),
    ];

    const result = parseRoleFilters(rows);

    expect(result.languages).toEqual([
      {
        value: ['English'],
        priority: 'ESSENTIAL',
        nonNegotiable: false,
        filterId: 'f1',
      },
    ]);
  });

  it('parses an industry row from its scalar value', () => {
    const rows = [
      buildRow({
        uid: 'f1',
        category: 'industry',
        value: 'finance',
        priority: 'ESSENTIAL',
        non_negotiable: true,
      }),
    ];

    const result = parseRoleFilters(rows);

    expect(result.industry).toEqual({
      value: 'finance',
      priority: 'ESSENTIAL',
      nonNegotiable: true,
      filterId: 'f1',
    });
  });

  it('parses a companies row, defaulting company_type to include when the child is missing', () => {
    const rows = [
      buildRow({
        uid: 'f1',
        category: 'companies',
        list_value: ['FNB'],
        priority: 'OPTIONAL',
        children: [],
      }),
    ];

    const result = parseRoleFilters(rows);

    expect(result.companies).toEqual([
      {
        value: { names: ['FNB'], type: 'include', dateRange: undefined },
        priority: 'OPTIONAL',
        nonNegotiable: false,
        filterId: 'f1',
      },
    ]);
  });

  it('parses a companies row date range when include_dates is true', () => {
    const rows = [
      buildRow({
        category: 'companies',
        list_value: ['FNB'],
        children: [
          buildChild({ title: 'company_type', value: 'exclude' }),
          buildChild({ title: 'include_dates', boolean: true }),
          buildChild({
            title: 'start_date',
            value: '2021-10-03T00:00:00.000Z',
          }),
          buildChild({ title: 'end_date', value: '2023-10-03T00:00:00.000Z' }),
        ],
      }),
    ];

    const result = parseRoleFilters(rows);

    expect(result.companies[0].value).toEqual({
      names: ['FNB'],
      type: 'exclude',
      dateRange: {
        start: new Date('2021-10-03T00:00:00.000Z'),
        end: new Date('2023-10-03T00:00:00.000Z'),
      },
    });
  });

  it('parses an education row, defaulting institutionType to include and institutions to empty when missing', () => {
    const rows = [
      buildRow({
        uid: 'f1',
        category: 'education',
        list_value: ['Computer Science degree'],
        priority: 'OPTIONAL',
        children: [],
      }),
    ];

    const result = parseRoleFilters(rows);

    expect(result.education).toEqual([
      {
        value: {
          qualifications: ['Computer Science degree'],
          institutions: [],
          institutionType: 'include',
        },
        priority: 'OPTIONAL',
        nonNegotiable: false,
        filterId: 'f1',
      },
    ]);
  });

  it('parses an education row institutions list from the institutions child', () => {
    const rows = [
      buildRow({
        category: 'education',
        list_value: ['Computer Science degree'],
        children: [
          buildChild({ title: 'use_institution', boolean: true }),
          buildChild({ title: 'institutions', list_value: ['Wits', 'UJ'] }),
          buildChild({ title: 'type', value: 'include' }),
        ],
      }),
    ];

    const result = parseRoleFilters(rows);

    expect(result.education[0].value.institutions).toEqual(['Wits', 'UJ']);
  });

  it('ignores any row whose category is not one of the seven known categories', () => {
    const rows = [buildRow({ category: 'not_a_real_category' })];

    const result = parseRoleFilters(rows);

    expect(result.skills).toEqual([]);
    expect(result.languages).toEqual([]);
    expect(result.jobTitles).toEqual([]);
    expect(result.companies).toEqual([]);
    expect(result.education).toEqual([]);
    expect(result.location).toBeUndefined();
    expect(result.industry).toBeUndefined();
  });

  it('returns empty arrays and undefined scalars for all categories when given no rows', () => {
    const result = parseRoleFilters([]);

    expect(result).toEqual({
      location: undefined,
      jobTitles: [],
      skills: [],
      languages: [],
      industry: undefined,
      companies: [],
      education: [],
    });
  });
});
