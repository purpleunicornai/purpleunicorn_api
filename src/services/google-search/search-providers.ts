import { AxiosInstance } from 'axios';
import { GoogleAuth } from 'google-auth-library';
import { decodeBase64Json } from '../../common/utils/base64';
import type { GoogleSearchItem } from './google-search.service';

// Every backend is asked for one page of ten web results at a time. Query
// building, paging limits, de-duping and the relaxed retry all stay in
// GoogleSearchService, so swapping the backend can't change which queries
// run or weaken the location/education clauses inside them.
export const PAGE_SIZE = 10;

export type SearchProviderName = 'google' | 'serper' | 'serpapi' | 'vertex';

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
  vertexProjectId?: string;
  vertexLocation?: string;
  vertexEngineId?: string;
  vertexServingConfigId?: string;
  vertexApiKey?: string;
  vertexServiceAccount?: string;
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
        // No "similar results" omission and no auto-corrected query, so
        // Google keeps closer to the exact x-ray query.
        filter: 0,
        nfpr: 1,
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

interface VertexSearchResult {
  document?: {
    derivedStructData?: {
      title?: string;
      htmlTitle?: string;
      link?: string;
      snippets?: { snippet?: string; snippet_status?: string }[];
      pagemap?: Record<string, unknown>;
    };
  };
}

export interface VertexSearchConfig {
  projectId?: string;
  location?: string;
  engineId?: string;
  servingConfigId?: string;
  // Base64 of the service-account JSON key, as yuv-api's
  // FIREBASE_SERVICE_ACCOUNT. Used for :search with an OAuth token.
  serviceAccount?: string;
  // Instead of the service account: :searchLite with ?key= (public website
  // data stores only).
  apiKey?: string;
}

// Returns an OAuth access token for the cloud-platform scope.
export type AccessTokenSource = () => Promise<string>;

interface ServiceAccountKey {
  client_email?: string;
  private_key?: string;
  project_id?: string;
}

// Decoded with the shared helper, the same way as yuv-api's
// FIREBASE_SERVICE_ACCOUNT.
export function parseServiceAccount(base64: string): ServiceAccountKey {
  let key: ServiceAccountKey;
  try {
    key = decodeBase64Json<ServiceAccountKey>(base64);
  } catch {
    throw new Error(
      'VERTEX_SERVICE_ACCOUNT is not base64-encoded service-account JSON',
    );
  }
  if (!key?.client_email || !key.private_key) {
    throw new Error(
      'VERTEX_SERVICE_ACCOUNT is missing client_email or private_key',
    );
  }
  return key;
}

function serviceAccountAccessToken(base64: string): AccessTokenSource {
  const credentials = parseServiceAccount(base64);
  const auth = new GoogleAuth({
    credentials,
    projectId: credentials.project_id,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return async () => {
    const token = await auth.getAccessToken();
    if (!token) {
      throw new Error(
        'Vertex AI Search: the service account returned no access token',
      );
    }
    return token;
  };
}

// Snippets come back with <b> hit highlighting and HTML entities.
function plainText(html?: string): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function vertexToSearchItem(
  result: VertexSearchResult,
): GoogleSearchItem | null {
  const data = result.document?.derivedStructData;
  const title = data?.title ?? plainText(data?.htmlTitle);
  if (!data?.link || !title) return null;
  const snippet = data.snippets?.find(
    (entry) => entry.snippet && entry.snippet_status !== 'NO_SNIPPET_AVAILABLE',
  )?.snippet;
  return {
    title,
    link: data.link,
    snippet: plainText(snippet),
    // Website data stores return CSE's pagemap (cse_thumbnail, metatags),
    // which GeminiService already reads.
    ...(data.pagemap && { pagemap: data.pagemap }),
  };
}

// Vertex AI Search (Discovery Engine, now "AI Applications"). Searches the
// sites in the app's website data store, not the whole web; see README.
export class VertexSearchProvider implements SearchProvider {
  readonly name = 'vertex';
  private readonly servingConfig: string;
  private readonly host: string;
  private readonly accessToken?: AccessTokenSource;

  // accessToken is for tests; by default it comes from the service account.
  constructor(
    private readonly client: AxiosInstance,
    private readonly config: VertexSearchConfig,
    accessToken?: AccessTokenSource,
  ) {
    const missing = [
      ['VERTEX_PROJECT_ID', config.projectId],
      ['VERTEX_ENGINE_ID', config.engineId],
      [
        'VERTEX_SERVICE_ACCOUNT (or VERTEX_API_KEY)',
        config.apiKey || config.serviceAccount || accessToken,
      ],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(
        `SEARCH_PROVIDER=vertex needs ${missing.join(' and ')} to be set`,
      );
    }
    const location = config.location || 'global';
    this.servingConfig = `projects/${config.projectId}/locations/${location}/collections/default_collection/engines/${config.engineId}/servingConfigs/${config.servingConfigId || 'default_search'}`;
    // Multi-region apps (us, eu) have their own endpoint.
    this.host =
      location === 'global'
        ? 'https://discoveryengine.googleapis.com'
        : `https://${location}-discoveryengine.googleapis.com`;
    if (!config.apiKey) {
      this.accessToken =
        accessToken ?? serviceAccountAccessToken(String(config.serviceAccount));
    }
  }

  // The v1 SearchRequest has no country/region field (sending regionCode is
  // a 400), so unlike gl on the SERP backends the country isn't passed; the
  // x-ray query's location clause still scopes results.
  async fetchPage({ query, start }: SearchPageRequest): Promise<SearchPage> {
    const body = {
      query,
      pageSize: PAGE_SIZE,
      offset: start - 1,
      contentSearchSpec: { snippetSpec: { returnSnippet: true } },
    };
    const response = this.config.apiKey
      ? await this.client.post<VertexSearchResponse>(
          `${this.host}/v1/${this.servingConfig}:searchLite`,
          body,
          { params: { key: this.config.apiKey } },
        )
      : await this.client.post<VertexSearchResponse>(
          `${this.host}/v1/${this.servingConfig}:search`,
          body,
          {
            headers: {
              Authorization: `Bearer ${await this.accessToken!()}`,
            },
          },
        );
    const items = (response.data.results ?? [])
      .map(vertexToSearchItem)
      .filter((item): item is GoogleSearchItem => item !== null);
    return {
      items,
      hasMore: items.length > 0 && !!response.data.nextPageToken,
    };
  }
}

interface VertexSearchResponse {
  results?: VertexSearchResult[];
  nextPageToken?: string;
  totalSize?: number;
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
    case 'vertex':
      return new VertexSearchProvider(client, {
        projectId: keys.vertexProjectId,
        location: keys.vertexLocation,
        engineId: keys.vertexEngineId,
        servingConfigId: keys.vertexServingConfigId,
        serviceAccount: keys.vertexServiceAccount,
        apiKey: keys.vertexApiKey,
      });
    default:
      return new GoogleCseProvider(
        client,
        keys.googleSearchApiKey,
        keys.googleSearchEngineId,
      );
  }
}
