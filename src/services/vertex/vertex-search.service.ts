import { Injectable, Logger } from '@nestjs/common';
import { CriterionExpansions } from '../../roles/search/criterion-expansions';
import {
  planSearchQueries,
  SearchQueryPlan,
} from '../../roles/search/build-search-query';
import {
  Candidate,
  extractCandidate,
} from '../../roles/search/extract-candidate';
import { resolveRegionNames } from '../../roles/search/filter-terms';
import { isOutsideRoleLocation } from '../../roles/search/location-gate';
import {
  ParsedLocation,
  ParsedRoleFilters,
} from '../../roles/search/role-filter-parser';
import {
  appendSeenKeys,
  dropSeen,
  encodeSearchPageToken,
  parseSearchPageToken,
  SearchPageToken,
} from '../../roles/search/search-page-token';
import {
  mergeStreamCandidates,
  splitStreamPageSizes,
} from '../../roles/search/split-search';
import { GoogleSearchItem } from '../search-item';
import { VertexService } from './vertex.service';
import { protos } from '@google-cloud/discoveryengine';

type SearchResult =
  protos.google.cloud.discoveryengine.v1.SearchResponse.ISearchResult;

// Vertex website search returns at most 20 hits per request.
export const VERTEX_PAGE_SIZE = 20;
// Cap for one role-search run. The old CSE path stopped at 100 per query;
// a single Vertex query (or a location+remote pair) stays within the same
// budget so a search cannot walk tens of thousands of estimated matches.
export const MAX_SEARCH_RESULTS = 100;

export interface VertexSearchPage {
  items: GoogleSearchItem[];
  page: number;
  nextPageToken?: string;
  // Vertex's own estimate of matching documents, summed across queries.
  estimatedTotal?: number;
  skippedDuplicates: number;
  filteredOutByLocation: number;
}

@Injectable()
export class VertexSearchService {
  private readonly logger = new Logger(VertexSearchService.name);

  constructor(private readonly vertexService: VertexService) {}

  async search(
    filters: ParsedRoleFilters,
    roleName?: string,
    expansions: CriterionExpansions | null = null,
  ): Promise<GoogleSearchItem[]> {
    const { plan, gated } = await this.prepare(filters, roleName, expansions);

    this.logger.debug(
      plan.kind === 'split'
        ? `Running split Vertex search (location + remote)`
        : `Running Vertex search`,
    );

    const items: GoogleSearchItem[] = [];
    let token: SearchPageToken | undefined;
    let skippedDuplicates = 0;
    let filteredOutByLocation = 0;

    while (items.length < MAX_SEARCH_RESULTS) {
      const remaining = MAX_SEARCH_RESULTS - items.length;
      const page = await this.searchPage(
        plan,
        gated,
        Math.min(VERTEX_PAGE_SIZE, remaining),
        token,
      );
      items.push(...page.items);
      skippedDuplicates += page.skippedDuplicates;
      filteredOutByLocation += page.filteredOutByLocation;
      if (!page.nextPageToken || page.items.length === 0) break;
      token = parseSearchPageToken(page.nextPageToken);
    }

    this.logger.debug(
      `Vertex search returned ${items.length} profile(s); skipped ${skippedDuplicates} duplicate(s); dropped ${filteredOutByLocation} by location`,
    );
    return items;
  }

  // One page of the role's search, for paging through results on demand.
  // Pass the previous page's token back to continue where it left off.
  async searchRolePage(
    filters: ParsedRoleFilters,
    roleName: string | undefined,
    expansions: CriterionExpansions | null,
    pageToken?: SearchPageToken,
  ): Promise<VertexSearchPage> {
    const { plan, gated } = await this.prepare(filters, roleName, expansions);
    return this.searchPage(plan, gated, VERTEX_PAGE_SIZE, pageToken);
  }

  private async prepare(
    filters: ParsedRoleFilters,
    roleName: string | undefined,
    expansions: CriterionExpansions | null,
  ): Promise<{ plan: SearchQueryPlan; gated: ParsedRoleFilters }> {
    const regionNames = filters.location
      ? await resolveRegionNames(filters.location.value)
      : [];
    const plan = planSearchQueries(filters, {
      roleName,
      expansions,
      regionNames,
    });
    return { plan, gated: withResolvedRegions(filters, regionNames) };
  }

  async searchPage(
    plan: SearchQueryPlan,
    filters: ParsedRoleFilters,
    pageSize: number = VERTEX_PAGE_SIZE,
    pageToken?: SearchPageToken,
  ): Promise<VertexSearchPage> {
    const page = pageToken?.page ?? 1;
    const seen = pageToken?.seen ?? [];

    if (plan.kind === 'single') {
      const vertexToken =
        pageToken?.kind === 'single' ? pageToken.token : undefined;
      this.logger.debug(`Searching for query: ${plan.query}`);
      const vertexPage = await this.vertexService.search(
        plan.query,
        pageSize,
        vertexToken,
      );
      return this.collectPage({
        extracted: extractProfiles(vertexPage.results),
        filters,
        page,
        seen,
        next: {
          kind: 'single',
          token: vertexPage.nextPageToken,
        },
        estimatedTotal: vertexPage.totalSize,
      });
    }

    const active = {
      local: pageToken?.kind === 'split' ? !!pageToken.local : true,
      remote: pageToken?.kind === 'split' ? !!pageToken.remote : true,
    };
    const sizes = splitStreamPageSizes(pageSize, active);
    this.logger.debug(`Location query: ${plan.locationQuery}`);
    this.logger.debug(`Remote query: ${plan.remoteQuery}`);

    const [localPage, remotePage] = await Promise.all([
      sizes.local
        ? this.vertexService.search(
            plan.locationQuery,
            sizes.local,
            pageToken?.kind === 'split' ? pageToken.local : undefined,
          )
        : Promise.resolve(undefined),
      sizes.remote
        ? this.vertexService.search(
            plan.remoteQuery,
            sizes.remote,
            pageToken?.kind === 'split' ? pageToken.remote : undefined,
          )
        : Promise.resolve(undefined),
    ]);

    return this.collectPage({
      extracted: mergeStreamCandidates(
        extractProfiles(localPage?.results ?? []),
        extractProfiles(remotePage?.results ?? []),
      ),
      filters,
      page,
      seen,
      next: {
        kind: 'split',
        local: localPage?.nextPageToken,
        remote: remotePage?.nextPageToken,
      },
      estimatedTotal: sumDefined(localPage?.totalSize, remotePage?.totalSize),
    });
  }

  private collectPage({
    extracted,
    filters,
    page,
    seen,
    next,
    estimatedTotal,
  }: {
    extracted: Candidate[];
    filters: ParsedRoleFilters;
    page: number;
    seen: string[];
    next:
      | { kind: 'single'; token?: string }
      | { kind: 'split'; local?: string; remote?: string };
    estimatedTotal?: number;
  }): VertexSearchPage {
    const { unique, skippedDuplicates } = dropSeen(extracted, seen);
    const inLocation: Candidate[] = [];
    let filteredOutByLocation = 0;
    for (const candidate of unique) {
      if (isOutsideRoleLocation(candidate.location, filters.location)) {
        filteredOutByLocation += 1;
        continue;
      }
      inLocation.push(candidate);
    }

    const items = inLocation.map((candidate) => toSearchItem(candidate, page));
    const nextPageToken = encodeSearchPageToken({
      kind: next.kind,
      page: page + 1,
      token: next.kind === 'single' ? next.token : undefined,
      local: next.kind === 'split' ? next.local : undefined,
      remote: next.kind === 'split' ? next.remote : undefined,
      seen: appendSeenKeys(
        seen,
        inLocation.map((candidate) => candidate.key),
      ),
    });

    return {
      items,
      page,
      nextPageToken,
      estimatedTotal,
      skippedDuplicates,
      filteredOutByLocation,
    };
  }
}

function sumDefined(...values: (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value != null);
  return known.length
    ? known.reduce((sum, value) => sum + value, 0)
    : undefined;
}

function extractProfiles(results: SearchResult[]): Candidate[] {
  return results
    .map(extractCandidate)
    .filter((candidate): candidate is Candidate => candidate !== null);
}

function toSearchItem(candidate: Candidate, page: number): GoogleSearchItem {
  return {
    title: [candidate.name, candidate.headline, candidate.company]
      .filter(Boolean)
      .join(' - '),
    link: candidate.linkedinUrl,
    snippet: candidate.snippet,
    page,
    matchedBy: candidate.matchedBy,
    extracted: candidate,
  };
}

// Location-gate matching should use the same resolved place names as the
// query (so a stored "WC" can match a snippet that says "Western Cape").
function withResolvedRegions(
  filters: ParsedRoleFilters,
  regionNames: string[],
): ParsedRoleFilters {
  if (!filters.location || regionNames.length === 0) return filters;
  const location: ParsedLocation = {
    ...filters.location.value,
    regions: regionNames.map((value) => ({ type: 'resolved', value })),
  };
  return {
    ...filters,
    location: { ...filters.location, value: location },
  };
}
