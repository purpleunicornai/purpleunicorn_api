import {
  role_filter_item,
  role_filter_child,
} from '../../generated/prisma/client';

type RoleFilterItemRow = role_filter_item & { children: role_filter_child[] };

export interface ParsedFilterRow<T> {
  value: T;
  priority: 'ESSENTIAL' | 'OPTIONAL';
  nonNegotiable: boolean;
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

export interface ParsedExperience {
  minYears: number;
}

export interface ParsedRoleFilters {
  location?: ParsedFilterRow<ParsedLocation>;
  jobTitles: ParsedFilterRow<ParsedJobTitles>[];
  skills: ParsedFilterRow<string[]>[];
  languages: ParsedFilterRow<string[]>[];
  industry?: ParsedFilterRow<string>;
  companies: ParsedFilterRow<ParsedCompanies>[];
  education: ParsedFilterRow<ParsedEducation>[];
  experience?: ParsedFilterRow<ParsedExperience>;
}

// Turns raw, open-ended role_filter_item + children rows into one typed,
// stable structure — isolating the dynamic (child.title is an open-ended
// label) parsing in one place instead of duplicating it in
// GoogleSearchService, GeminiService, and CandidateScoringService.
export function parseRoleFilters(
  items: RoleFilterItemRow[],
): ParsedRoleFilters {
  const result: ParsedRoleFilters = {
    jobTitles: [],
    skills: [],
    languages: [],
    companies: [],
    education: [],
  };

  for (const item of items) {
    const base = {
      priority: item.priority,
      nonNegotiable: item.non_negotiable,
    };

    switch (item.category) {
      case 'location':
        result.location = { ...base, value: parseLocation(item) };
        break;
      case 'job_titles':
        result.jobTitles.push({ ...base, value: parseJobTitles(item) });
        break;
      case 'skills':
        result.skills.push({ ...base, value: item.list_value });
        break;
      case 'languages':
        result.languages.push({ ...base, value: item.list_value });
        break;
      case 'industry':
        result.industry = { ...base, value: item.value ?? '' };
        break;
      case 'companies':
        result.companies.push({ ...base, value: parseCompanies(item) });
        break;
      case 'education':
        result.education.push({ ...base, value: parseEducation(item) });
        break;
      case 'experience':
        result.experience = { ...base, value: parseExperience(item) };
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

function parseLocation(item: RoleFilterItemRow): ParsedLocation {
  const regions = item.children
    .filter(
      (child) =>
        child.title !== 'remote_work' && child.title !== 'work_authorization',
    )
    .map((child) => ({ type: child.title, value: child.value ?? '' }));

  return {
    countryCode: item.value ?? '',
    regions,
    remoteWork: findChild(item.children, 'remote_work')?.boolean ?? false,
    workAuthorizationRequired:
      findChild(item.children, 'work_authorization')?.boolean ?? false,
  };
}

function parseJobTitles(item: RoleFilterItemRow): ParsedJobTitles {
  const option = findChild(item.children, 'title_option')?.value;
  return {
    titles: item.list_value,
    option: option === 'alternative_title' ? 'alternative_title' : 'main_title',
  };
}

function parseCompanies(item: RoleFilterItemRow): ParsedCompanies {
  const type = findChild(item.children, 'company_type')?.value;
  const includeDates =
    findChild(item.children, 'include_dates')?.boolean ?? false;

  let dateRange: ParsedCompanies['dateRange'];
  if (includeDates) {
    const startValue = findChild(item.children, 'start_date')?.value;
    const endValue = findChild(item.children, 'end_date')?.value;
    dateRange = {
      start: startValue ? new Date(startValue) : undefined,
      end: endValue ? new Date(endValue) : undefined,
    };
  }

  return {
    names: item.list_value,
    type: type === 'exclude' ? 'exclude' : 'include',
    dateRange,
  };
}

function parseExperience(item: RoleFilterItemRow): ParsedExperience {
  return { minYears: Number(item.value) || 0 };
}

function parseEducation(item: RoleFilterItemRow): ParsedEducation {
  const type = findChild(item.children, 'type')?.value;
  const institutions =
    findChild(item.children, 'institutions')?.list_value ?? [];

  return {
    qualifications: item.list_value,
    institutions,
    institutionType: type === 'exclude' ? 'exclude' : 'include',
  };
}
