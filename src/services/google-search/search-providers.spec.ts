import axios from 'axios';
import { GoogleAuth } from 'google-auth-library';
import serperFixture from './__fixtures__/serper-search.json';
import serpApiFixture from './__fixtures__/serpapi-search.json';
import vertexFixture from './__fixtures__/vertex-search.json';
import {
  createSearchProvider,
  parseServiceAccount,
  GoogleCseProvider,
  SerpApiProvider,
  SerperProvider,
  VertexSearchProvider,
} from './search-providers';

const expectedItems = [
  {
    title: 'Thandi Mokoena - Financial Manager - Absa Group | LinkedIn',
    link: 'https://za.linkedin.com/in/thandi-mokoena-ca-sa',
    snippet: expect.stringContaining('CA(SA)'),
    pagemap: { cse_thumbnail: [{ src: expect.any(String) }] },
  },
  {
    title: 'Pieter van Wyk - Finance Manager | LinkedIn',
    link: 'https://za.linkedin.com/in/pietervanwyk',
    snippet: expect.stringContaining('Chartered Accountant'),
  },
];

describe('search providers', () => {
  const client = axios.create();
  afterEach(() => jest.restoreAllMocks());

  it('picks the backend from SEARCH_PROVIDER, defaulting to Google CSE', () => {
    expect(createSearchProvider(client, {})).toBeInstanceOf(GoogleCseProvider);
    expect(
      createSearchProvider(client, { searchProvider: 'serper' }),
    ).toBeInstanceOf(SerperProvider);
    expect(
      createSearchProvider(client, { searchProvider: 'serpapi' }),
    ).toBeInstanceOf(SerpApiProvider);
    expect(
      createSearchProvider(client, {
        searchProvider: 'vertex',
        vertexProjectId: 'my-project',
        vertexEngineId: 'xray-app',
        vertexApiKey: 'k',
      }),
    ).toBeInstanceOf(VertexSearchProvider);
  });

  describe('SerperProvider', () => {
    it('posts the query with page number and country, and maps organic results to the CSE item shape', async () => {
      const post = jest
        .spyOn(client, 'post')
        .mockResolvedValue({ data: serperFixture });

      const page = await new SerperProvider(client, 'test-key').fetchPage({
        query: 'q',
        start: 11,
        countryCode: 'ZA',
      });

      expect(post).toHaveBeenCalledWith(
        'https://google.serper.dev/search',
        { q: 'q', num: 10, page: 2, gl: 'za' },
        { headers: { 'X-API-KEY': 'test-key' } },
      );
      expect(page.items).toEqual(expectedItems);
      expect(page.hasMore).toBe(true);
    });

    it('stops paging only on an empty page', async () => {
      jest.spyOn(client, 'post').mockResolvedValue({ data: {} });

      const page = await new SerperProvider(client, 'k').fetchPage({
        query: 'q',
        start: 1,
      });

      expect(page).toEqual({ items: [], hasMore: false });
    });
  });

  describe('SerpApiProvider', () => {
    it('requests the google engine with a 0-based offset and country, and maps organic_results', async () => {
      const get = jest
        .spyOn(client, 'get')
        .mockResolvedValue({ data: serpApiFixture });

      const page = await new SerpApiProvider(client, 'test-key').fetchPage({
        query: 'q',
        start: 21,
        countryCode: 'ZA',
      });

      expect(get).toHaveBeenCalledWith('https://serpapi.com/search.json', {
        params: {
          engine: 'google',
          q: 'q',
          num: 10,
          start: 20,
          filter: 0,
          nfpr: 1,
          api_key: 'test-key',
          gl: 'za',
        },
      });
      expect(page.items).toEqual(expectedItems);
      expect(page.hasMore).toBe(true);
    });

    it('treats a "no results" response as an empty last page', async () => {
      jest.spyOn(client, 'get').mockResolvedValue({
        data: { error: "Google hasn't returned any results for this query." },
      });

      const page = await new SerpApiProvider(client, 'k').fetchPage({
        query: 'q',
        start: 1,
      });

      expect(page).toEqual({ items: [], hasMore: false });
    });
  });

  describe('VertexSearchProvider', () => {
    const servingConfig =
      'projects/my-project/locations/global/collections/default_collection/engines/xray-app/servingConfigs/default_search';

    it('fails loudly when the project or engine id is missing', () => {
      expect(
        () =>
          new VertexSearchProvider(client, { projectId: 'my-project' }, () =>
            Promise.resolve('t'),
          ),
      ).toThrow('SEARCH_PROVIDER=vertex needs VERTEX_ENGINE_ID to be set');
      expect(() =>
        createSearchProvider(client, { searchProvider: 'vertex' }),
      ).toThrow('VERTEX_PROJECT_ID and VERTEX_ENGINE_ID');
    });

    const serviceAccount = Buffer.from(
      JSON.stringify({
        type: 'service_account',
        project_id: 'my-project',
        client_email: 'search@my-project.iam.gserviceaccount.com',
        private_key: 'test-private-key',
      }),
    ).toString('base64');

    it('needs a service account or an API key', () => {
      expect(
        () =>
          new VertexSearchProvider(client, {
            projectId: 'my-project',
            engineId: 'xray-app',
          }),
      ).toThrow('VERTEX_SERVICE_ACCOUNT (or VERTEX_API_KEY)');
    });

    it('decodes VERTEX_SERVICE_ACCOUNT from base64 JSON and rejects anything else', () => {
      expect(parseServiceAccount(serviceAccount)).toMatchObject({
        client_email: 'search@my-project.iam.gserviceaccount.com',
        private_key: 'test-private-key',
      });
      expect(() => parseServiceAccount('not base64 json')).toThrow(
        'not base64-encoded service-account JSON',
      );
      expect(() =>
        parseServiceAccount(Buffer.from('{}').toString('base64')),
      ).toThrow('missing client_email or private_key');
    });

    it('signs :search with a token from the base64 service account', async () => {
      const getAccessToken = jest
        .spyOn(GoogleAuth.prototype, 'getAccessToken')
        .mockResolvedValue('sa-token');
      const post = jest
        .spyOn(client, 'post')
        .mockResolvedValue({ data: { results: [] } });

      await new VertexSearchProvider(client, {
        projectId: 'my-project',
        engineId: 'xray-app',
        serviceAccount,
      }).fetchPage({ query: 'q', start: 1 });

      expect(getAccessToken).toHaveBeenCalled();
      expect(post).toHaveBeenCalledWith(
        `https://discoveryengine.googleapis.com/v1/${servingConfig}:search`,
        expect.objectContaining({ query: 'q' }),
        { headers: { Authorization: 'Bearer sa-token' } },
      );
    });

    it('posts to servingConfigs:search with a bearer token and 0-based offset (no regionCode, which v1 rejects), and maps derivedStructData', async () => {
      const post = jest
        .spyOn(client, 'post')
        .mockResolvedValue({ data: vertexFixture });
      const token = jest.fn().mockResolvedValue('access-token');

      const page = await new VertexSearchProvider(
        client,
        { projectId: 'my-project', engineId: 'xray-app' },
        token,
      ).fetchPage({ query: 'q', start: 11, countryCode: 'za' });

      expect(post).toHaveBeenCalledWith(
        `https://discoveryengine.googleapis.com/v1/${servingConfig}:search`,
        {
          query: 'q',
          pageSize: 10,
          offset: 10,
          contentSearchSpec: { snippetSpec: { returnSnippet: true } },
        },
        { headers: { Authorization: 'Bearer access-token' } },
      );
      expect(page.items).toEqual([
        {
          title: 'Thandi Mokoena - Financial Manager - Absa Group | LinkedIn',
          link: 'https://za.linkedin.com/in/thandi-mokoena-ca-sa',
          snippet:
            'Financial Manager at Absa Group · CA(SA) & MBA · Johannesburg, Gauteng, South Africa',
          pagemap: {
            cse_thumbnail: [{ src: 'https://media.licdn.com/thandi.jpg' }],
          },
        },
        {
          title: 'Pieter van Wyk - Finance Manager | LinkedIn',
          link: 'https://za.linkedin.com/in/pietervanwyk',
          snippet: undefined,
        },
      ]);
      expect(page.hasMore).toBe(true);
    });

    it('uses searchLite with ?key= and no token when VERTEX_API_KEY is set, on the regional endpoint', async () => {
      const post = jest
        .spyOn(client, 'post')
        .mockResolvedValue({ data: { results: [] } });
      const token = jest.fn();

      const page = await new VertexSearchProvider(
        client,
        {
          projectId: 'my-project',
          location: 'eu',
          engineId: 'xray-app',
          servingConfigId: 'custom',
          apiKey: 'test-key',
        },
        token,
      ).fetchPage({ query: 'q', start: 1 });

      expect(post).toHaveBeenCalledWith(
        'https://eu-discoveryengine.googleapis.com/v1/projects/my-project/locations/eu/collections/default_collection/engines/xray-app/servingConfigs/custom:searchLite',
        expect.objectContaining({ query: 'q', offset: 0 }),
        { params: { key: 'test-key' } },
      );
      expect(token).not.toHaveBeenCalled();
      expect(page).toEqual({ items: [], hasMore: false });
    });

    it('stops paging when there is no nextPageToken', async () => {
      jest.spyOn(client, 'post').mockResolvedValue({
        data: { ...vertexFixture, nextPageToken: undefined },
      });

      const page = await new VertexSearchProvider(
        client,
        { projectId: 'p', engineId: 'e' },
        () => Promise.resolve('t'),
      ).fetchPage({ query: 'q', start: 1 });

      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(false);
    });
  });
});
