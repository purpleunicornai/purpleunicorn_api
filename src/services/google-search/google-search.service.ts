import { Inject, Injectable, Logger } from '@nestjs/common';
import AiConfig from '../../config/ai.config';
import { type ConfigType } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { ParsedRoleFilters } from '../../roles/search/role-filter-parser';
import { DEFAULT_XRAY_SITES } from '../../common/constants/google';
import { candidate, candidate_experience } from '../../generated/prisma/client';
import {
  countryName,
  qualificationAliases,
  resolveRegionNames,
} from '../../roles/search/filter-terms';
import {
  createSearchProvider,
  PAGE_SIZE,
  SearchProvider,
  SearchProviderKeys,
} from './search-providers';

type CandidateWithExperience = candidate & {
  experience: candidate_experience[];
};

export interface GoogleSearchItem {
  title: string;
  link: string;
  snippet?: string;
  // The fetched page's own visible text, when PageFetchService was able to
  // retrieve it — set by SearchService.deepSearchCandidate, not by this
  // service (which only calls the Google Custom Search API).
  page_content?: string;
  [key: string]: unknown;
}

// Every backend pages 10 results at a time. 100 per query was Google CSE's
// hard cap (start + num - 1 <= 100) and is kept for the SERP backends too,
// so each query costs at most 10 billed calls whichever backend runs it.
const RESULTS_PER_PAGE = PAGE_SIZE;
const MAX_RESULTS_PER_QUERY = 100;
// A candidate deep-search is about precisely finding one person, not casting
// a wide net, so it doesn't need the role-search's full 100-result budget.
const CANDIDATE_MAX_RESULTS_PER_QUERY = 20;
// Every term in an x-ray query is mandatory, so a role with several skills
// can come back nearly empty. Below this many unique results, the search
// retries with only title + location + education (skills and companies
// dropped) — those three stay, so the precision filters still hold.
const RELAX_BELOW_RESULTS = 30;

@Injectable()
export class GoogleSearchService {
  private readonly logger = new Logger(GoogleSearchService.name);
  public client: AxiosInstance;
  private readonly provider: SearchProvider;

  // SEARCH_PROVIDER picks the backend (google | serper | serpapi); unset
  // means Google CSE, so nothing changes until it's flipped.
  constructor(
    @Inject(AiConfig.KEY)
    aiConf: Pick<
      ConfigType<typeof AiConfig>,
      'googleSearchApiKey' | 'googleSearchEngineId'
    > &
      SearchProviderKeys,
  ) {
    this.client = axios.create({ timeout: 20_000 });
    this.provider = createSearchProvider(this.client, aiConf);
  }

  async search(
    filters: ParsedRoleFilters,
    roleName?: string,
  ): Promise<GoogleSearchItem[]> {
    const regionNames = filters.location
      ? await resolveRegionNames(filters.location.value)
      : [];
    const countryCode = filters.location?.value.countryCode || undefined;
    const queries = this.buildXrayQueries(filters, roleName, regionNames);
    this.logger.debug(`Running ${queries.length} Google x-ray query(s)`);

    const strict = this.dedupeByLink(
      await this.runQueries(queries, countryCode),
    );
    if (strict.length >= RELAX_BELOW_RESULTS) return strict;

    const relaxed = this.buildXrayQueries(
      filters,
      roleName,
      regionNames,
      true,
    ).filter((query) => !queries.includes(query));
    if (relaxed.length === 0) return strict;

    this.logger.debug(
      `Only ${strict.length} result(s); running ${relaxed.length} relaxed query(s)`,
    );
    return this.dedupeByLink([
      ...strict,
      ...(await this.runQueries(relaxed, countryCode)),
    ]);
  }

  private async runQueries(
    queries: string[],
    countryCode?: string,
  ): Promise<GoogleSearchItem[]> {
    const results = await Promise.all(
      queries.map((query) =>
        this.searchQueryPaginated(query, MAX_RESULTS_PER_QUERY, countryCode),
      ),
    );
    return results.flat();
  }

  // The same profile comes back from several title variants; sending it to
  // Gemini more than once only costs tokens and batch slots.
  private dedupeByLink(items: GoogleSearchItem[]): GoogleSearchItem[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = item.link
        ?.trim()
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Digs deeper on a single already-identified candidate to build out their
  // profile, rather than casting a wide net for role matches.
  async searchCandidate(
    candidate: CandidateWithExperience,
  ): Promise<GoogleSearchItem[]> {
    const queries = this.buildCandidateQueries(candidate);
    if (queries.length === 0) return [];

    this.logger.debug(
      `Running ${queries.length} candidate deep-search query(s)`,
    );

    const results = await Promise.all(
      queries.map((query) =>
        this.searchQueryPaginated(query, CANDIDATE_MAX_RESULTS_PER_QUERY),
      ),
    );

    return results.flat();
  }

  // Walks pages sequentially (rather than firing all of them at once) so we
  // can stop as soon as a page comes back short — that means no more results
  // exist for the query, and paging further would just waste API quota.
  private async searchQueryPaginated(
    query: string,
    maxResults = MAX_RESULTS_PER_QUERY,
    countryCode?: string,
  ): Promise<GoogleSearchItem[]> {
    const items: GoogleSearchItem[] = [];

    // One failed page (a quota 429, a timeout) used to reject the whole
    // Promise.all in search() and abort the run, throwing away every other
    // query's results. Keep what this query already found and move on.
    try {
      for (let start = 1; start <= maxResults; start += RESULTS_PER_PAGE) {
        const page = await this.searchQuery(query, start, countryCode);
        items.push(...page.items);

        if (!page.hasMore) break;
      }
    } catch (error) {
      this.logger.warn(
        `${this.provider.name} query failed after ${items.length} result(s): ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return items;
  }

  private searchQuery(query: string, start: number, countryCode?: string) {
    console.log('QUERY', query);
    this.logger.debug(
      `Running ${this.provider.name} search: ${query} (start=${start})`,
    );
    return this.provider.fetchPage({ query, start, countryCode });
  }

  private buildSiteFilter(): string {
    const siteList = DEFAULT_XRAY_SITES;
    // A parenthesized single-term site: filter (e.g. "(site:linkedin.com/in)")
    // returns zero results from Google's Custom Search API — confirmed live.
    if (siteList.length === 1) return siteList[0];
    return `(${siteList.join(' OR ')})`;
  }

  // Falls back to the role's own name whenever a title slot has nothing
  // configured — either because the row doesn't exist at all, or it exists
  // but was saved with an empty title list — so a role search never goes
  // out with zero title signal just because job_titles filters weren't set.
  private buildXrayQueries(
    filters: ParsedRoleFilters,
    roleName?: string,
    regionNames?: string[],
    relaxed = false,
  ): string[] {
    const mainTitleRow = filters.jobTitles.find(
      (row) => row.value.option === 'main_title',
    );
    const mainTitles = mainTitleRow?.value.titles.length
      ? mainTitleRow.value.titles
      : roleName
        ? [roleName]
        : [];
    if (mainTitles.length === 0) return [];

    const siteFilter = this.buildSiteFilter();
    const requiredSkills = filters.skills
      .filter((row) => row.priority === 'ESSENTIAL')
      .flatMap((row) => row.value);
    const optionalSkills = filters.skills
      .filter((row) => row.priority === 'OPTIONAL')
      .flatMap((row) => row.value);
    const includedCompanies = filters.companies
      .filter((row) => row.value.type === 'include')
      .flatMap((row) => row.value.names);

    // Location and education go straight after the title: Google ignores
    // query words past its ~32-word limit, and the site filter alone uses
    // about 25, so anything appended last was the first thing dropped.
    const commonParts = [
      this.buildLocationClause(filters, regionNames),
      this.buildEducationClause(filters),
      ...(relaxed
        ? []
        : [
            this.andClause(requiredSkills),
            this.orClause(optionalSkills),
            this.orClause(includedCompanies),
          ]),
    ];

    const queries = new Set<string>();
    for (const title of mainTitles) {
      queries.add(
        this.joinNonEmpty([siteFilter, this.quote(title), ...commonParts]),
      );
    }

    const alternativeTitleRow = filters.jobTitles.find(
      (row) => row.value.option === 'alternative_title',
    );
    const alternativeTitles = (
      alternativeTitleRow?.value.titles.length
        ? alternativeTitleRow.value.titles
        : roleName
          ? [roleName]
          : []
    ).slice(0, 3);
    for (const alternativeTitle of alternativeTitles) {
      queries.add(
        this.joinNonEmpty([
          siteFilter,
          this.quote(alternativeTitle),
          ...commonParts,
        ]),
      );
    }

    return [...queries].filter((query) => query.length > siteFilter.length);
  }

  // Before this, only the raw region values were sent — the province is
  // stored as its ISO code ("WC"), and the country was never sent at all, so
  // a South Africa search went out worldwide. Regions are the most specific
  // signal when set; otherwise the country name scopes the search.
  private buildLocationClause(
    filters: ParsedRoleFilters,
    regionNames?: string[],
  ): string {
    const location = filters.location?.value;
    if (!location) return '';
    const regions = (
      regionNames ?? location.regions.map((region) => region.value)
    ).filter((region) => region.trim());
    if (regions.length > 0) return this.orClause(regions);
    const country = countryName(location.countryCode);
    return country ? this.quote(country) : '';
  }

  // Education was never part of the query, so a CA(SA) requirement only
  // affected scoring after Google had already returned whoever it liked.
  // Any one of the listed qualifications (or a known alias) must appear.
  private buildEducationClause(filters: ParsedRoleFilters): string {
    const qualifications = filters.education
      .flatMap((row) => row.value.qualifications)
      .flatMap((qualification) => qualificationAliases(qualification));
    const institutions = filters.education
      .filter((row) => row.value.institutionType === 'include')
      .flatMap((row) => row.value.institutions);
    return this.joinNonEmpty([
      this.orClause([...new Set(qualifications)]),
      this.orClause([...new Set(institutions)]),
    ]);
  }

  // Identity-based queries for enriching one already-found person, rather
  // than the criteria-based queries buildXrayQueries uses to find matches.
  // Past employers come from the candidate's own experience history rather
  // than a flat "previous companies" guess, since that's the only place
  // work history lives now.
  private buildCandidateQueries(candidate: CandidateWithExperience): string[] {
    const fullName = [candidate.first_name, candidate.last_name]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(' ')
      .trim();
    if (!fullName) return [];

    const siteFilter = this.buildSiteFilter();
    const queries = new Set<string>();

    queries.add(
      this.joinNonEmpty([
        siteFilter,
        this.quote(fullName),
        this.quote(candidate.current_company ?? ''),
      ]),
    );

    const previousCompanies = [
      ...new Set(candidate.experience.map((entry) => entry.company_name)),
    ].slice(0, 3);
    for (const company of previousCompanies) {
      queries.add(
        this.joinNonEmpty([
          siteFilter,
          this.quote(fullName),
          this.quote(company),
        ]),
      );
    }

    return [...queries].filter((query) => query.length > siteFilter.length);
  }

  private andClause(values: string[]): string {
    return values
      .map((value) => this.quote(value))
      .filter((value) => value.length > 0)
      .join(' ');
  }

  private orClause(values: string[]): string {
    const quoted = values
      .map((value) => this.quote(value))
      .filter((value) => value.length > 0);

    if (quoted.length === 0) return '';
    if (quoted.length === 1) return quoted[0];
    return `(${quoted.join(' OR ')})`;
  }

  private quote(value: string): string {
    const trimmed = value.trim().replace(/"/g, '');
    if (!trimmed) return '';
    // Spaces and brackets both need quoting — an unquoted "CA(SA)" would be
    // read as a group and break the surrounding OR clause.
    return /[^\w.+#-]/.test(trimmed) ? `"${trimmed}"` : trimmed;
  }

  private joinNonEmpty(parts: string[]): string {
    return parts.filter((part) => part && part.length > 0).join(' ');
  }
}
