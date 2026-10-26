import axios from 'axios';
import serperFixture from './__fixtures__/serper-search.json';
import serpApiFixture from './__fixtures__/serpapi-search.json';
import {
  createSearchProvider,
  GoogleCseProvider,
  SerpApiProvider,
  SerperProvider,
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
});
