import { CountriesController } from './countries.controller';
import { CountriesService } from './countries.service';

function buildCountriesService(): jest.Mocked<CountriesService> {
  return {
    getCountries: jest.fn(),
    getStatesOfCountry: jest.fn(),
    getCitiesOfState: jest.fn(),
  } as unknown as jest.Mocked<CountriesService>;
}

describe('CountriesController', () => {
  let countriesService: jest.Mocked<CountriesService>;
  let controller: CountriesController;

  beforeEach(() => {
    countriesService = buildCountriesService();
    controller = new CountriesController(countriesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getCountries', () => {
    it('delegates to CountriesService.getCountries', async () => {
      const countries = [
        { id: 233, code: 'US', name: 'United States', flag: '🇺🇸' },
      ];
      countriesService.getCountries.mockResolvedValue(countries as any);

      const result = await controller.getCountries();

      expect(countriesService.getCountries).toHaveBeenCalledWith();
      expect(result).toBe(countries);
    });
  });

  describe('getCountry', () => {
    it("delegates to CountriesService.getStatesOfCountry with the given country's code", async () => {
      const states = {
        states: [
          {
            id: 1416,
            country_id: 233,
            country_code: 'US',
            state_code: 'CA',
            name: 'California',
          },
        ],
        type: 'state',
      };
      countriesService.getStatesOfCountry.mockResolvedValue(states as any);

      const result = await controller.getCountry('US');

      expect(countriesService.getStatesOfCountry).toHaveBeenCalledWith('US');
      expect(result).toBe(states);
    });
  });

  describe('getCities', () => {
    it('delegates to CountriesService.getCitiesOfState with the country and state codes', async () => {
      const cities = [
        {
          id: 111969,
          country_id: 233,
          country_code: 'US',
          state_id: 1416,
          state_code: 'CA',
          name: 'Los Angeles',
        },
      ];
      countriesService.getCitiesOfState.mockResolvedValue(cities as any);

      const result = await controller.getCities('US', 'CA');

      expect(countriesService.getCitiesOfState).toHaveBeenCalledWith(
        'US',
        'CA',
      );
      expect(result).toBe(cities);
    });
  });
});
