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
  CriterionExpansions,
  ExpansionCategory,
  termsForSeed,
} from '../../roles/search/criterion-expansions';
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
// Google ignores query words past ~32, and the site filter alone is 25 of
// them (13 sites + 12 ORs). A saved AI expansion turns one term into an OR
// group several times longer, so expanded groups are split into extra
// queries rather than silently cut off at the tail. Words are counted as
// whitespace-separated tokens, the same way the site filter's 25 is.
const QUERY_WORD_LIMIT = 32;

function countWords(clause: string): number {
  return clause.split(/\s+/).filter(Boolean).length;
}

// A query slot is either a literal clause, sent exactly as before
// expansions, or a saved expansion's terms, OR-ed and chunked to fit.
type QuerySlot = { literal: string } | { terms: string[] };

// Splits `room` words between expanded groups of the given word sizes: an
// even share each, except a group that fits whole in less takes only what it
// needs and leaves the rest to the larger ones. The budgets never sum past
// `room`, so one chunk from every group fits together.
function shareRoom(sizes: readonly number[], room: number): number[] {
  const budgets = sizes.map(() => 0);
  const smallestFirst = sizes
    .map((_, index) => index)
    .sort((a, b) => sizes[a] - sizes[b]);
  let left = Math.max(room, 0);
  smallestFirst.forEach((index, position) => {
    const share = Math.floor(left / (smallestFirst.length - position));
    budgets[index] = Math.min(sizes[index], share);
    left -= budgets[index];
  });
  return budgets;
}

// The x-ray sites as host + path prefix, e.g. "site:linkedin.com/in" becomes
// { host: 'linkedin.com', path: '/in' }.
const XRAY_TARGETS = DEFAULT_XRAY_SITES.map((site) => {
  const [host, ...path] = site
    .replace(/^site:/, '')
    .toLowerCase()
    .split('/');
  return { host, path: path.length > 0 ? `/${path.join('/')}` : '' };
});

// Live google.com (Serper, SerpApi) often ignores the site: filter and fills
// the page with job boards (linkedin.com/jobs, indeed.com/q-...-jobs). CSE
// was scoped by its engine config, so it never needed this. Only links on
// one of the x-ray sites (subdomains included, e.g. za.linkedin.com) are
// candidate profiles.
export function isXraySiteLink(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  return XRAY_TARGETS.some(
    (target) =>
      (host === target.host || host.endsWith(`.${target.host}`)) &&
      (!target.path ||
        path === target.path ||
        path.startsWith(`${target.path}/`)),
  );
}

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
    expansions: CriterionExpansions | null = null,
  ): Promise<GoogleSearchItem[]> {
    const regionNames = filters.location
      ? await resolveRegionNames(filters.location.value)
      : [];
    const countryCode = filters.location?.value.countryCode || undefined;
    const queries = this.buildXrayQueries(
      filters,
      roleName,
      regionNames,
      false,
      expansions,
    );
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
      expansions,
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
        const profiles = page.items.filter((item) => isXraySiteLink(item.link));
        if (profiles.length < page.items.length) {
          this.logger.debug(
            `Dropped ${page.items.length - profiles.length} off-site result(s) (start=${start})`,
          );
        }
        items.push(...profiles);

        // hasMore comes from the unfiltered page, so a page of job listings
        // doesn't end the query before the profiles behind it.
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
  //
  // With saved expansions, a title or essential skill becomes an OR group in
  // its own slot (skills stay AND-ed to each other), and optional skills
  // become one flattened OR group. Without them, every query is exactly what
  // it was before expansions existed.
  private buildXrayQueries(
    filters: ParsedRoleFilters,
    roleName?: string,
    regionNames?: string[],
    relaxed = false,
    expansions: CriterionExpansions | null = null,
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
    const location = this.buildLocationClause(filters, regionNames);
    const education = this.buildEducationClause(filters);
    const criteriaSlots: QuerySlot[] = relaxed
      ? []
      : [
          ...requiredSkills.map((skill) =>
            this.slotFor(expansions, 'skills', [skill]),
          ),
          this.slotFor(expansions, 'skills', optionalSkills),
          { literal: this.orClause(includedCompanies) },
        ];

    const queries = new Set<string>();
    const addTitleQueries = (title: string) => {
      const slots = this.chunkSlots(
        [
          this.slotFor(expansions, 'job_titles', [title]),
          { literal: location },
          { literal: education },
          ...criteriaSlots,
        ],
        QUERY_WORD_LIMIT - countWords(siteFilter),
      );
      const firstChunks = slots.map((slot) => slot[0]);
      queries.add(this.joinNonEmpty([siteFilter, ...firstChunks]));
      // Every later chunk gets its own query, alongside every other slot's
      // first chunk, so each term reaches Google once and location stays.
      // With two or more expanded groups this covers every term, not every
      // combination of terms across groups.
      slots.forEach((slot, index) => {
        for (const chunk of slot.slice(1)) {
          const parts = [...firstChunks];
          parts[index] = chunk;
          queries.add(this.joinNonEmpty([siteFilter, ...parts]));
        }
      });
    };

    for (const title of mainTitles) addTitleQueries(title);

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
      addTitleQueries(alternativeTitle);
    }

    return [...queries].filter((query) => query.length > siteFilter.length);
  }

  // The seeds' saved OR-group terms, flattened and deduped. When none of the
  // seeds has a saved expansion, the slot is the original literal clause.
  private slotFor(
    expansions: CriterionExpansions | null,
    category: ExpansionCategory,
    seeds: string[],
  ): QuerySlot {
    let expanded = false;
    const terms: string[] = [];
    const seen = new Set<string>();
    for (const seed of seeds) {
      const saved = termsForSeed(expansions, category, seed);
      if (saved.length > 1) expanded = true;
      for (const term of saved.length > 0 ? saved : [seed]) {
        const key = term.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        terms.push(term);
      }
    }
    return expanded ? { terms } : { literal: this.orClause(seeds) };
  }

  // Literal slots stay one clause each, exactly as before expansions. The
  // words they leave free are shared between the expanded slots (see
  // shareRoom), and each expanded group is split, in order, into OR chunks
  // within its share, so the seed stays in the first chunk. A query takes at
  // most one chunk per slot, so it fits the limit whenever the literal
  // clauses do and every single term fits its share. Otherwise a chunk is
  // one term and the query can still run over, as literal ones already can.
  private chunkSlots(slots: QuerySlot[], room: number): string[][] {
    const literalWords = slots.reduce(
      (words, slot) =>
        words + ('literal' in slot ? countWords(slot.literal) : 0),
      0,
    );
    const expandedSizes = slots.flatMap((slot) =>
      'terms' in slot ? [countWords(this.orClause(slot.terms))] : [],
    );
    const budgets = shareRoom(expandedSizes, room - literalWords);
    let next = 0;
    return slots.map((slot) =>
      'literal' in slot
        ? [slot.literal]
        : this.chunkTerms(slot.terms, budgets[next++]),
    );
  }

  // Never fewer than one term per chunk.
  private chunkTerms(terms: string[], room: number): string[] {
    const chunks: string[][] = [];
    let current: string[] = [];
    for (const term of terms) {
      const candidate = [...current, term];
      if (current.length > 0 && countWords(this.orClause(candidate)) > room) {
        chunks.push(current);
        current = [term];
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) chunks.push(current);
    return chunks.map((chunk) => this.orClause(chunk));
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
