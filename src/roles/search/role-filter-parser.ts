import {
  role_filter_item,
  role_filter_child,
} from '../../generated/prisma/client';
import {
  REMOTE_WORK_CHILD,
  WORK_TYPES_CHILD,
  WorkType,
  workTypesFromChildren,
} from './work-types';

type RoleFilterItemRow = role_filter_item & { children: role_filter_child[] };

export interface ParsedFilterRow<T> {
  value: T;
  priority: 'ESSENTIAL' | 'OPTIONAL';
  nonNegotiable: boolean;
}

export interface ParsedLocation {
  countryCode: string;
  regions: { type: string; value: string }[];
  // True when remote candidates are acceptable (REMOTE is a work type).
  remoteWork: boolean;
  // How the role may be worked. Always set by the parser; optional so
  // hand-built filters (tests, older callers) keep the legacy meaning.
  // See work-types.ts.
  workTypes?: WorkType[];
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
// VertexSearchService, GeminiService, and CandidateScoringService.
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
        result.location = mergeLocation(result.location, {
          ...base,
          value: parseLocation(item),
        });
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

// The filter UI can save several location rows for one role (seen in real
// data: an ESSENTIAL ZA row with an empty province plus an OPTIONAL ZA row
// with GP). Last-row-wins silently downgraded the requirement, so keep the
// strictest priority and union the regions instead.
function mergeLocation(
  current: ParsedFilterRow<ParsedLocation> | undefined,
  next: ParsedFilterRow<ParsedLocation>,
): ParsedFilterRow<ParsedLocation> {
  if (!current) return next;
  const strictness = (row: ParsedFilterRow<ParsedLocation>) =>
    (row.nonNegotiable ? 2 : 0) + (row.priority === 'ESSENTIAL' ? 1 : 0);
  const [primary, secondary] =
    strictness(next) > strictness(current) ? [next, current] : [current, next];
  const regions = [...primary.value.regions];
  for (const region of secondary.value.regions) {
    if (!regions.some((existing) => existing.value === region.value)) {
      regions.push(region);
    }
  }
  return {
    ...primary,
    value: {
      ...primary.value,
      countryCode: primary.value.countryCode || secondary.value.countryCode,
      regions,
    },
  };
}

function parseLocation(item: RoleFilterItemRow): ParsedLocation {
  // Empty region children are common (the UI saves a blank province when
  // none is picked) and would otherwise blank out the location clause.
  const regions = item.children
    .filter(
      (child) =>
        child.title !== REMOTE_WORK_CHILD &&
        child.title !== WORK_TYPES_CHILD &&
        child.title !== 'work_authorization' &&
        !!child.value?.trim(),
    )
    .map((child) => ({ type: child.title, value: (child.value ?? '').trim() }));
  const workTypes = workTypesFromChildren(item.children);

  return {
    countryCode: item.value ?? '',
    regions,
    remoteWork: workTypes.includes('REMOTE'),
    workTypes,
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
