import { role_filters, role_filter_child } from '../../generated/prisma/client';

type RoleFilterRow = role_filters & { children: role_filter_child[] };

export interface ParsedFilterRow<T> {
  value: T;
  priority: 'ESSENTIAL' | 'OPTIONAL';
  nonNegotiable: boolean;
  filterId: string;
}

export interface ParsedLocation {
  countryCode: string;
  regions: { type: string; value: string }[];
  remoteWork: boolean;
  workAuthorizationRequired: boolean;
}

export interface ParsedJobTitles {
  titles: string[];
  option: 'main_title' | 'alternative_title';
}

export interface ParsedCompanies {
  names: string[];
  type: 'include' | 'exclude';
  dateRange?: { start?: Date; end?: Date };
}

export interface ParsedEducation {
  qualifications: string[];
  institutions: string[];
  institutionType: 'include' | 'exclude';
}

export interface ParsedRoleFilters {
  location?: ParsedFilterRow<ParsedLocation>;
  jobTitles: ParsedFilterRow<ParsedJobTitles>[];
  skills: ParsedFilterRow<string[]>[];
  languages: ParsedFilterRow<string[]>[];
  industry?: ParsedFilterRow<string>;
  companies: ParsedFilterRow<ParsedCompanies>[];
  education: ParsedFilterRow<ParsedEducation>[];
}

// Turns raw, open-ended role_filters + children rows into one typed, stable
// structure — isolating the dynamic (child.title is an open-ended label)
// parsing in one place instead of duplicating it in GoogleSearchService,
// GeminiService, and CandidateScoringService.
export function parseRoleFilters(rows: RoleFilterRow[]): ParsedRoleFilters {
  const result: ParsedRoleFilters = {
    jobTitles: [],
    skills: [],
    languages: [],
    companies: [],
    education: [],
  };

  for (const row of rows) {
    const base = {
      priority: row.priority,
      nonNegotiable: row.non_negotiable,
      filterId: row.uid,
    };

    switch (row.category) {
      case 'location':
        result.location = { ...base, value: parseLocation(row) };
        break;
      case 'job_titles':
        result.jobTitles.push({ ...base, value: parseJobTitles(row) });
        break;
      case 'skills':
        result.skills.push({ ...base, value: row.list_value });
        break;
      case 'languages':
        result.languages.push({ ...base, value: row.list_value });
        break;
      case 'industry':
        result.industry = { ...base, value: row.value ?? '' };
        break;
      case 'companies':
        result.companies.push({ ...base, value: parseCompanies(row) });
        break;
      case 'education':
        result.education.push({ ...base, value: parseEducation(row) });
        break;
      default:
        // Unknown category — ignore rather than throw, since the shape is
        // open-ended and a stray/future category shouldn't break parsing.
        break;
    }
  }

  return result;
}

function findChild(
  children: role_filter_child[],
  title: string,
): role_filter_child | undefined {
  return children.find((child) => child.title === title);
}

function parseLocation(row: RoleFilterRow): ParsedLocation {
  const regions = row.children
    .filter(
      (child) =>
        child.title !== 'remote_work' && child.title !== 'work_authorization',
    )
    .map((child) => ({ type: child.title, value: child.value ?? '' }));

  return {
    countryCode: row.value ?? '',
    regions,
    remoteWork: findChild(row.children, 'remote_work')?.boolean ?? false,
    workAuthorizationRequired:
      findChild(row.children, 'work_authorization')?.boolean ?? false,
  };
}

function parseJobTitles(row: RoleFilterRow): ParsedJobTitles {
  const option = findChild(row.children, 'title_option')?.value;
  return {
    titles: row.list_value,
    option: option === 'alternative_title' ? 'alternative_title' : 'main_title',
  };
}

function parseCompanies(row: RoleFilterRow): ParsedCompanies {
  const type = findChild(row.children, 'company_type')?.value;
  const includeDates =
    findChild(row.children, 'include_dates')?.boolean ?? false;

  let dateRange: ParsedCompanies['dateRange'];
  if (includeDates) {
    const startValue = findChild(row.children, 'start_date')?.value;
    const endValue = findChild(row.children, 'end_date')?.value;
    dateRange = {
      start: startValue ? new Date(startValue) : undefined,
      end: endValue ? new Date(endValue) : undefined,
    };
  }

  return {
    names: row.list_value,
    type: type === 'exclude' ? 'exclude' : 'include',
    dateRange,
  };
}

function parseEducation(row: RoleFilterRow): ParsedEducation {
  const type = findChild(row.children, 'type')?.value;
  const institutions =
    findChild(row.children, 'institutions')?.list_value ?? [];

  return {
    qualifications: row.list_value,
    institutions,
    institutionType: type === 'exclude' ? 'exclude' : 'include',
  };
}
