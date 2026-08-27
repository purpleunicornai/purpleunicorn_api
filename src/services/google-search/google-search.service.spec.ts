import { GoogleSearchService } from './google-search.service';

describe('GoogleSearchService', () => {
  let service: GoogleSearchService;

  beforeEach(() => {
    service = new GoogleSearchService({
      googleSearchApiKey: 'test-api-key',
      googleSearchEngineId: 'test-cx',
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search', () => {
    it('requests the Custom Search API with the api key, engine id, and query', async () => {
      const get = jest
        .spyOn(service.client, 'get')
        .mockResolvedValue({ data: { items: [] } });

      await service.search('site:linkedin.com/in "Software Engineer"');

      expect(get).toHaveBeenCalledWith(
        'https://www.googleapis.com/customsearch/v1?key=test-api-key&cx=test-cx&q=site%3Alinkedin.com%2Fin+%22Software+Engineer%22',
      );
    });

    it('returns the items from the response', async () => {
      const items = [{ title: 'Jane Doe', link: 'https://linkedin.com/in/janedoe' }];
      jest.spyOn(service.client, 'get').mockResolvedValue({ data: { items } });

      const result = await service.search('some query');

      expect(result).toEqual(items);
    });

    it('returns an empty array when the response has no items', async () => {
      jest.spyOn(service.client, 'get').mockResolvedValue({ data: {} });

      const result = await service.search('some query');

      expect(result).toEqual([]);
    });
  });
});
