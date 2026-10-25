import { Inject, Injectable, Logger } from '@nestjs/common';
import AiConfig from '../../config/ai.config';
import { type ConfigType } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { ParsedRoleFilters } from '../../roles/search/role-filter-parser';
import { DEFAULT_XRAY_SITES } from '../../common/constants/google';
import { candidate, candidate_experience } from '../../generated/prisma/client';

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

// Google's Custom Search JSON API caps a single request at 10 results (`num`)
// and paginates via `start`; `start` + `num` - 1 cannot exceed 100, so 100
// results per query is a hard ceiling the API enforces, not a choice made here.
const RESULTS_PER_PAGE = 10;
const MAX_RESULTS_PER_QUERY = 100;
// A candidate deep-search is about precisely finding one person, not casting
// a wide net, so it doesn't need the role-search's full 100-result budget.
const CANDIDATE_MAX_RESULTS_PER_QUERY = 20;

@Injectable()
export class GoogleSearchService {
  private readonly logger = new Logger(GoogleSearchService.name);
  public client: AxiosInstance;

  constructor(
    @Inject(AiConfig.KEY)
    private readonly aiConf: Pick<
      ConfigType<typeof AiConfig>,
      'googleSearchApiKey' | 'googleSearchEngineId'
    >,
  ) {
    this.client = axios.create({ timeout: 20_000 });
  }

  async search(
    filters: ParsedRoleFilters,
    roleName?: string,
  ): Promise<GoogleSearchItem[]> {
    const queries = this.buildXrayQueries(filters, roleName);
    this.logger.debug(`Running ${queries.length} Google x-ray query(s)`);

    const results = await Promise.all(
      queries.map((query) => this.searchQueryPaginated(query)),
    );

    return results.flat();
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
  ): Promise<GoogleSearchItem[]> {
    const items: GoogleSearchItem[] = [];

    for (let start = 1; start <= maxResults; start += RESULTS_PER_PAGE) {
      const page = await this.searchQuery(query, start);
      items.push(...page);

      if (page.length < RESULTS_PER_PAGE) break;
    }

    return items;
  }

  private async searchQuery(
    query: string,
    start = 1,
  ): Promise<GoogleSearchItem[]> {
    console.log('QUERY', query);
    const params = {
      key: this.aiConf.googleSearchApiKey,
      cx: this.aiConf.googleSearchEngineId,
      q: query,
      num: String(RESULTS_PER_PAGE),
      start: String(start),
    };
    const requestUrl = `https://www.googleapis.com/customsearch/v1?${new URLSearchParams(params).toString()}`;

    this.logger.debug(`Running Google search: ${query} (start=${start})`);
    const response = await this.client.get(requestUrl);
    return response.data.items ?? [];
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
    const locationNames =
      filters.location?.value.regions.map((region) => region.value) ?? [];
    const includedCompanies = filters.companies
      .filter((row) => row.value.type === 'include')
      .flatMap((row) => row.value.names);

    const commonParts = [
      this.andClause(requiredSkills),
      this.orClause(optionalSkills),
      this.orClause(locationNames),
      this.orClause(includedCompanies),
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
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.includes(' ') ? `"${trimmed}"` : trimmed;
  }

  private joinNonEmpty(parts: string[]): string {
    return parts.filter((part) => part && part.length > 0).join(' ');
  }
}
