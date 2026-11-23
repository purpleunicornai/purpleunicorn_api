import { LINKEDIN_PROFILE_SITE } from '../../common/constants/google';
import {
  CriterionExpansions,
  ExpansionCategory,
  termsForSeed,
} from './criterion-expansions';
import { countryName, qualificationAliases } from './filter-terms';
import {
  ParsedCompanies,
  ParsedEducation,
  ParsedFilterRow,
  ParsedLocation,
  ParsedRoleFilters,
} from './role-filter-parser';
import { locationMatters, remoteAllowed } from './work-types';

// Turns parsed role filters into a boolean Vertex query: an unparenthesized
// `site:linkedin.com/in` operator, then one quoted-OR group per mandatory
// filter row, space-joined (implicit AND). OPTIONAL rows stay out of the
// query and are left to scoring. Saved AI expansions widen title and skill
// groups in place; they do not spawn extra queries.

export type LocationClauseMode = 'default' | 'location' | 'remote';

export type SearchQueryPlan =
  | { kind: 'single'; query: string }
  | { kind: 'split'; locationQuery: string; remoteQuery: string };

export interface BuildSearchQueryOptions {
  roleName?: string;
  expansions?: CriterionExpansions | null;
  // Already-resolved place names (ISO province codes turned into
  // "Western Cape", etc.). The caller is responsible for resolving them.
  regionNames?: string[];
  locationMode?: LocationClauseMode;
}

// Location-first split: a mandatory location with named regions that also
// accepts remote people gets one query for the place and one for "remote".
// A remote-only role (no ONSITE/HYBRID) has nothing local to put first.
export function shouldSplitLocationQuery(filters: ParsedRoleFilters): boolean {
  const location = filters.location;
  return (
    !!location &&
    isMandatory(location) &&
    remoteAllowed(location.value) &&
    locationMatters(location.value) &&
    location.value.regions.length > 0
  );
}

export function planSearchQueries(
  filters: ParsedRoleFilters,
  options: Omit<BuildSearchQueryOptions, 'locationMode'> = {},
): SearchQueryPlan {
  if (shouldSplitLocationQuery(filters)) {
    return {
      kind: 'split',
      locationQuery: buildSearchQuery(filters, {
        ...options,
        locationMode: 'location',
      }),
      remoteQuery: buildSearchQuery(filters, {
        ...options,
        locationMode: 'remote',
      }),
    };
  }
  return { kind: 'single', query: buildSearchQuery(filters, options) };
}

export function buildSearchQuery(
  filters: ParsedRoleFilters,
  options: BuildSearchQueryOptions = {},
): string {
  const {
    roleName,
    expansions = null,
    regionNames,
    locationMode = 'default',
  } = options;

  const clauses = [
    LINKEDIN_PROFILE_SITE,
    buildLocationClause(filters.location, locationMode, regionNames),
    buildTitleClause(filters, roleName, expansions),
    ...buildSkillClauses(filters, expansions),
    ...buildRowClauses(filters.languages, (row) => row),
    buildSingleTermClause(filters.industry),
    ...buildCompanyClauses(filters.companies),
    ...buildEducationClauses(filters.education),
  ];

  return clauses.filter((clause) => clause.length > 0).join(' ');
}

function isMandatory(row: ParsedFilterRow<unknown>): boolean {
  return row.priority === 'ESSENTIAL' || row.nonNegotiable;
}

function quoteTerm(term: string): string {
  return `"${term.replace(/"/g, '\\"')}"`;
}

function orGroup(terms: string[]): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    const trimmed = term.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique.length > 0 ? `(${unique.map(quoteTerm).join(' OR ')})` : '';
}

function excludeTerms(terms: string[]): string {
  return terms
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => `-${quoteTerm(term)}`)
    .join(' ');
}

function expandSeeds(
  expansions: CriterionExpansions | null,
  category: ExpansionCategory,
  seeds: string[],
): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    const saved = termsForSeed(expansions, category, seed);
    for (const term of saved.length > 0 ? saved : [seed]) {
      const trimmed = term.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) continue;
      seen.add(key);
      terms.push(trimmed);
    }
  }
  return terms;
}

function buildRowClauses<T>(
  rows: ParsedFilterRow<T>[],
  getTerms: (value: T) => string[],
): string[] {
  return rows.filter(isMandatory).map((row) => orGroup(getTerms(row.value)));
}

function buildSingleTermClause(row?: ParsedFilterRow<string>): string {
  if (!row || !row.value || !isMandatory(row)) return '';
  return orGroup([row.value]);
}

function buildLocationClause(
  location: ParsedFilterRow<ParsedLocation> | undefined,
  mode: LocationClauseMode,
  regionNames?: string[],
): string {
  if (!location || !isMandatory(location)) return '';
  const remote = remoteAllowed(location.value);
  if (mode === 'remote' || (remote && !locationMatters(location.value))) {
    return orGroup(['remote']);
  }
  const resolved = (
    regionNames ?? location.value.regions.map((region) => region.value)
  )
    .map((name) => name.trim())
    .filter(Boolean);
  const terms = [...resolved];
  if (terms.length === 0) {
    const country = countryName(location.value.countryCode);
    if (country) terms.push(country);
  }
  if (mode === 'default' && remote) terms.push('remote');
  return orGroup(terms);
}

function titleSeeds(filters: ParsedRoleFilters, roleName?: string): string[] {
  const mandatory = filters.jobTitles
    .filter(isMandatory)
    .flatMap((row) => row.value.titles);
  if (mandatory.some((title) => title.trim())) {
    return mandatory.filter((title) => title.trim());
  }
  const any = filters.jobTitles.flatMap((row) => row.value.titles);
  if (any.some((title) => title.trim())) {
    return any.filter((title) => title.trim());
  }
  const fallback = roleName?.trim();
  return fallback ? [fallback] : [];
}

function buildTitleClause(
  filters: ParsedRoleFilters,
  roleName: string | undefined,
  expansions: CriterionExpansions | null,
): string {
  return orGroup(
    expandSeeds(expansions, 'job_titles', titleSeeds(filters, roleName)),
  );
}

function buildSkillClauses(
  filters: ParsedRoleFilters,
  expansions: CriterionExpansions | null,
): string[] {
  return filters.skills
    .filter(isMandatory)
    .map((row) => orGroup(expandSeeds(expansions, 'skills', row.value)));
}

function buildCompanyClauses(
  companies: ParsedFilterRow<ParsedCompanies>[],
): string[] {
  return companies.filter(isMandatory).map((row) => {
    const { names, type } = row.value;
    return type === 'exclude' ? excludeTerms(names) : orGroup(names);
  });
}

function buildEducationClauses(
  education: ParsedFilterRow<ParsedEducation>[],
): string[] {
  return education.filter(isMandatory).flatMap((row) => {
    const { qualifications, institutions, institutionType } = row.value;
    const aliased = qualifications.flatMap((qualification) =>
      qualificationAliases(qualification),
    );
    return [
      orGroup(aliased),
      institutionType === 'exclude'
        ? excludeTerms(institutions)
        : orGroup(institutions),
    ];
  });
}
