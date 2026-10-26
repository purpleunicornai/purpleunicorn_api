import { AxiosInstance } from 'axios';
import type { GoogleSearchItem } from './google-search.service';

// Every backend is asked for one page of ten web results at a time. Query
// building, paging limits, de-duping and the relaxed retry all stay in
// GoogleSearchService, so swapping the backend can't change which queries
// run or weaken the location/education clauses inside them.
export const PAGE_SIZE = 10;

export type SearchProviderName = 'google' | 'serper' | 'serpapi';

export interface SearchPageRequest {
  query: string;
  // 1-based index of the first result, as Google CSE counts it.
  start: number;
  // ISO-2 code of the role's country. Ranks local results higher on the
  // SERP backends; it does not filter, so it can't drop anyone.
  countryCode?: string;
}

export interface SearchPage {
  items: GoogleSearchItem[];
  hasMore: boolean;
}

export interface SearchProvider {
  readonly name: SearchProviderName;
  fetchPage(request: SearchPageRequest): Promise<SearchPage>;
}

export interface SearchProviderKeys {
  searchProvider?: string;
  googleSearchApiKey?: string;
  googleSearchEngineId?: string;
  serperApiKey?: string;
  serpApiKey?: string;
}

// The current backend. The JSON API shuts down on 1 Jan 2027.
export class GoogleCseProvider implements SearchProvider {
  readonly name = 'google';

  constructor(
    private readonly client: AxiosInstance,
    private readonly apiKey?: string,
    private readonly engineId?: string,
  ) {}

  async fetchPage({ query, start }: SearchPageRequest): Promise<SearchPage> {
    const params = new URLSearchParams({
      key: String(this.apiKey),
      cx: String(this.engineId),
      q: query,
      num: String(PAGE_SIZE),
      start: String(start),
    });
    const response = await this.client.get<{ items?: GoogleSearchItem[] }>(
      `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
    );
    const items = response.data.items ?? [];
    return { items, hasMore: items.length >= PAGE_SIZE };
  }
}

interface SerpOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  imageUrl?: string;
  thumbnail?: string;
}

// SERP APIs don't return CSE's pagemap; the image, when there is one, is
// put where GeminiService.extractImageUrl already looks.
function toSearchItem(result: SerpOrganicResult): GoogleSearchItem | null {
  if (!result.link || !result.title) return null;
  const image = result.imageUrl ?? result.thumbnail;
  return {
    title: result.title,
    link: result.link,
    snippet: result.snippet,
    ...(image && { pagemap: { cse_thumbnail: [{ src: image }] } }),
  };
}

function toItems(results: SerpOrganicResult[] | undefined): GoogleSearchItem[] {
  return (results ?? [])
    .map(toSearchItem)
    .filter((item): item is GoogleSearchItem => item !== null);
}

// serper.dev: live google.com results. Google's own pages often hold 8 or 9
// organic results, so a short page is not the end; only an empty one is.
export class SerperProvider implements SearchProvider {
  readonly name = 'serper';

  constructor(
    private readonly client: AxiosInstance,
    private readonly apiKey?: string,
  ) {}

  async fetchPage({
    query,
    start,
    countryCode,
  }: SearchPageRequest): Promise<SearchPage> {
    const response = await this.client.post<{
      organic?: SerpOrganicResult[];
    }>(
      'https://google.serper.dev/search',
      {
        q: query,
        num: PAGE_SIZE,
        page: Math.floor((start - 1) / PAGE_SIZE) + 1,
        ...(countryCode && { gl: countryCode.toLowerCase() }),
      },
      { headers: { 'X-API-KEY': String(this.apiKey) } },
    );
    const items = toItems(response.data.organic);
    return { items, hasMore: items.length > 0 };
  }
}

// SerpApi: live google.com results, as in the serpapi/serp.ts prototype.
// An empty result set comes back as a 200 with an "error" message, which is
// "no results", not a failure.
export class SerpApiProvider implements SearchProvider {
  readonly name = 'serpapi';

  constructor(
    private readonly client: AxiosInstance,
    private readonly apiKey?: string,
  ) {}

  async fetchPage({
    query,
    start,
    countryCode,
  }: SearchPageRequest): Promise<SearchPage> {
    const response = await this.client.get<{
      organic_results?: SerpOrganicResult[];
      serpapi_pagination?: { next?: string };
    }>('https://serpapi.com/search.json', {
      params: {
        engine: 'google',
        q: query,
        num: PAGE_SIZE,
        start: start - 1,
        api_key: this.apiKey,
        ...(countryCode && { gl: countryCode.toLowerCase() }),
      },
    });
    const items = toItems(response.data.organic_results);
    return {
      items,
      hasMore: items.length > 0 && !!response.data.serpapi_pagination?.next,
    };
  }
}

export function createSearchProvider(
  client: AxiosInstance,
  keys: SearchProviderKeys,
): SearchProvider {
  switch (keys.searchProvider) {
    case 'serper':
      return new SerperProvider(client, keys.serperApiKey);
    case 'serpapi':
      return new SerpApiProvider(client, keys.serpApiKey);
    default:
      return new GoogleCseProvider(
        client,
        keys.googleSearchApiKey,
        keys.googleSearchEngineId,
      );
  }
}
