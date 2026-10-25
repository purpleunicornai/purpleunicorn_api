import { parseRoleFilters } from './role-filter-parser';
import {
  role_filter_item,
  role_filter_child,
} from '../../generated/prisma/client';

type RoleFilterItemRow = role_filter_item & { children: role_filter_child[] };

function buildChild(
  overrides: Partial<role_filter_child> = {},
): role_filter_child {
  return {
    uid: 'child-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    parent_uid: 'item-1',
    title: 'some_title',
    value: null,
    list_value: [],
    boolean: false,
    ...overrides,
  };
}

function buildItem(
  overrides: Partial<RoleFilterItemRow> = {},
): RoleFilterItemRow {
  return {
    uid: 'item-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    role_filter_id: 'filter-1',
    job_spec_import_id: null,
    category: 'skills',
    value: null,
    list_value: [],
    priority: 'ESSENTIAL',
    non_negotiable: false,
    children: [],
    ...overrides,
  };
}

describe('parseRoleFilters', () => {
  it('parses a location item with sub-region children into countryCode/regions', () => {
    const items = [
      buildItem({
        category: 'location',
        value: 'ZA',
        priority: 'ESSENTIAL',
        children: [buildChild({ title: 'province', value: 'GP' })],
      }),
    ];

    const result = parseRoleFilters(items);

    expect(result.location).toEqual({
      value: {
        countryCode: 'ZA',
        regions: [{ type: 'province', value: 'GP' }],
        remoteWork: false,
        workAuthorizationRequired: false,
      },
      priority: 'ESSENTIAL',
      nonNegotiable: false,
    });
  });

  it('reads remote_work and work_authorization booleans from location children', () => {
    const items = [
      buildItem({
        category: 'location',
        value: 'GB',
        children: [
          buildChild({ title: 'remote_work', boolean: true }),
          buildChild({ title: 'work_authorization', boolean: true }),
        ],
      }),
    ];

    const result = parseRoleFilters(items);

    expect(result.location?.value.remoteWork).toBe(true);
    expect(result.location?.value.workAuthorizationRequired).toBe(true);
  });

  it('leaves location undefined when there is no location item', () => {
    const result = parseRoleFilters([buildItem({ category: 'skills' })]);

    expect(result.location).toBeUndefined();
  });

  it('parses a job_titles item, defaulting to main_title when no title_option child is present', () => {
    const items = [
      buildItem({
        category: 'job_titles',
        list_value: ['Head of Engineering'],
        priority: 'ESSENTIAL',
        children: [],
      }),
    ];

    const result = parseRoleFilters(items);

    expect(result.jobTitles).toEqual([
      {
        value: { titles: ['Head of Engineering'], option: 'main_title' },
        priority: 'ESSENTIAL',
        nonNegotiable: false,
      },
    ]);
  });

  it('parses an alternative job_titles item from the title_option child', () => {
    const items = [
      buildItem({
        category: 'job_titles',
        list_value: ['Tech Lead', 'Team Lead'],
        priority: 'OPTIONAL',
        children: [
          buildChild({ title: 'title_option', value: 'alternative_title' }),
        ],
      }),
    ];

    const result = parseRoleFilters(items);

    expect(result.jobTitles[0].value.option).toBe('alternative_title');
  });

  it('collects multiple job_titles items (one per priority tier) into the array', () => {
    const items = [
      buildItem({
        category: 'job_titles',
        list_value: ['Head of Engineering'],
        priority: 'ESSENTIAL',
      }),
      buildItem({
        category: 'job_titles',
        list_value: ['Tech Lead'],
        priority: 'OPTIONAL',
      }),
    ];

    const result = parseRoleFilters(items);

    expect(result.jobTitles).toHaveLength(2);
  });

  it('collects skills items by list_value, independent of how many items exist', () => {
    const items = [
      buildItem({
        category: 'skills',
        list_value: ['Leadership', 'React Native'],
        priority: 'ESSENTIAL',
      }),
      buildItem({
        category: 'skills',
        list_value: ['GraphQL'],
        priority: 'OPTIONAL',
      }),
    ];

    const result = parseRoleFilters(items);

    expect(result.skills).toEqual([
      {
        value: ['Leadership', 'React Native'],
        priority: 'ESSENTIAL',
        nonNegotiable: false,
      },
      {
        value: ['GraphQL'],
        priority: 'OPTIONAL',
        nonNegotiable: false,
      },
    ]);
  });

  it('collects languages items the same way as skills', () => {
    const items = [
      buildItem({
        category: 'languages',
        list_value: ['English'],
        priority: 'ESSENTIAL',
      }),
    ];

    const result = parseRoleFilters(items);

    expect(result.languages).toEqual([
      {
        value: ['English'],
        priority: 'ESSENTIAL',
        nonNegotiable: false,
      },
    ]);
  });

  it('parses an industry item from its scalar value', () => {
    const items = [
      buildItem({
        category: 'industry',
        value: 'finance',
        priority: 'ESSENTIAL',
        non_negotiable: true,
      }),
    ];

    const result = parseRoleFilters(items);

    expect(result.industry).toEqual({
      value: 'finance',
      priority: 'ESSENTIAL',
      nonNegotiable: true,
    });
  });

  it('parses a companies item, defaulting company_type to include when the child is missing', () => {
    const items = [
      buildItem({
        category: 'companies',
        list_value: ['FNB'],
        priority: 'OPTIONAL',
        children: [],
      }),
    ];

    const result = parseRoleFilters(items);

    expect(result.companies).toEqual([
      {
        value: { names: ['FNB'], type: 'include', dateRange: undefined },
        priority: 'OPTIONAL',
        nonNegotiable: false,
      },
    ]);
  });

  it('parses a companies item date range when include_dates is true', () => {
    const items = [
      buildItem({
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

    const result = parseRoleFilters(items);

    expect(result.companies[0].value).toEqual({
      names: ['FNB'],
      type: 'exclude',
      dateRange: {
        start: new Date('2021-10-03T00:00:00.000Z'),
        end: new Date('2023-10-03T00:00:00.000Z'),
      },
    });
  });

  it('parses an education item, defaulting institutionType to include and institutions to empty when missing', () => {
    const items = [
      buildItem({
        category: 'education',
        list_value: ['Computer Science degree'],
        priority: 'OPTIONAL',
        children: [],
      }),
    ];

    const result = parseRoleFilters(items);

    expect(result.education).toEqual([
      {
        value: {
          qualifications: ['Computer Science degree'],
          institutions: [],
          institutionType: 'include',
        },
        priority: 'OPTIONAL',
        nonNegotiable: false,
      },
    ]);
  });

  it('parses an education item institutions list from the institutions child', () => {
    const items = [
      buildItem({
        category: 'education',
        list_value: ['Computer Science degree'],
        children: [
          buildChild({ title: 'use_institution', boolean: true }),
          buildChild({ title: 'institutions', list_value: ['Wits', 'UJ'] }),
          buildChild({ title: 'type', value: 'include' }),
        ],
      }),
    ];

    const result = parseRoleFilters(items);

    expect(result.education[0].value.institutions).toEqual(['Wits', 'UJ']);
  });

  it('parses an experience item from its scalar value into minYears', () => {
    const items = [
      buildItem({
        category: 'experience',
        value: '5',
        priority: 'ESSENTIAL',
        non_negotiable: true,
      }),
    ];

    const result = parseRoleFilters(items);

    expect(result.experience).toEqual({
      value: { minYears: 5 },
      priority: 'ESSENTIAL',
      nonNegotiable: true,
    });
  });

  it('defaults minYears to 0 when the experience item has no parsable value', () => {
    const result = parseRoleFilters([
      buildItem({ category: 'experience', value: undefined }),
    ]);

    expect(result.experience?.value.minYears).toBe(0);
  });

  it('ignores any item whose category is not one of the seven known categories', () => {
    const items = [buildItem({ category: 'not_a_real_category' })];

    const result = parseRoleFilters(items);

    expect(result.skills).toEqual([]);
    expect(result.languages).toEqual([]);
    expect(result.jobTitles).toEqual([]);
    expect(result.companies).toEqual([]);
    expect(result.education).toEqual([]);
    expect(result.location).toBeUndefined();
    expect(result.industry).toBeUndefined();
  });

  it('returns empty arrays and undefined scalars for all categories when given no items', () => {
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
