import { CountriesService } from './countries.service';
import { RequestException } from '../../../common/exception/core/ExceptionBase';
import {
  getCountries,
  getStatesOfCountry,
  getCitiesOfState,
  getCountryByCode,
  getStateByCode,
  type ICountry,
  type ICountryMeta,
  type IState,
  type ICity,
} from '@countrystatecity/countries';

jest.mock('@countrystatecity/countries');

const mockGetCountries = getCountries as jest.MockedFunction<
  typeof getCountries
>;
const mockGetStatesOfCountry = getStatesOfCountry as jest.MockedFunction<
  typeof getStatesOfCountry
>;
const mockGetCitiesOfState = getCitiesOfState as jest.MockedFunction<
  typeof getCitiesOfState
>;
const mockGetCountryByCode = getCountryByCode as jest.MockedFunction<
  typeof getCountryByCode
>;
const mockGetStateByCode = getStateByCode as jest.MockedFunction<
  typeof getStateByCode
>;

async function captureError(
  promise: Promise<unknown>,
): Promise<RequestException> {
  try {
    await promise;
  } catch (error) {
    return error as RequestException;
  }
  throw new Error('Expected promise to reject');
}

function buildCountry(overrides: Partial<ICountry> = {}): ICountry {
  return {
    id: 233,
    name: 'United States',
    iso2: 'US',
    iso3: 'USA',
    numeric_code: '840',
    phonecode: '1',
    capital: 'Washington',
    currency: 'USD',
    currency_name: 'US Dollar',
    currency_symbol: '$',
    tld: '.us',
    native: 'United States',
    population: 331000000,
    gdp: null,
    region: 'Americas',
    region_id: 2,
    subregion: 'North America',
    subregion_id: 5,
    nationality: 'American',
    latitude: '38.0',
    longitude: '-97.0',
    emoji: '🇺🇸',
    emojiU: 'U+1F1FA U+1F1F8',
    ...overrides,
  };
}

function buildCountryMeta(overrides: Partial<ICountryMeta> = {}): ICountryMeta {
  return {
    ...buildCountry(),
    timezones: [],
    translations: {},
    ...overrides,
  };
}

function buildState(overrides: Partial<IState> = {}): IState {
  return {
    id: 1416,
    name: 'California',
    country_id: 233,
    country_code: 'US',
    fips_code: '06',
    iso2: 'CA',
    iso3166_2: 'US-CA',
    type: 'state',
    latitude: '36.7',
    longitude: '-119.4',
    native: null,
    timezone: null,
    translations: {},
    ...overrides,
  };
}

function buildCity(overrides: Partial<ICity> = {}): ICity {
  return {
    id: 111969,
    name: 'Los Angeles',
    state_id: 1416,
    state_code: 'CA',
    country_id: 233,
    country_code: 'US',
    latitude: '34.05',
    longitude: '-118.24',
    native: null,
    timezone: null,
    translations: {},
    ...overrides,
  };
}

describe('CountriesService', () => {
  let service: CountriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CountriesService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCountries', () => {
    it('maps each country to id, code, name, and flag', async () => {
      mockGetCountries.mockResolvedValue([
        buildCountry({
          id: 233,
          iso2: 'US',
          name: 'United States',
          emoji: '🇺🇸',
        }),
        buildCountry({
          id: 82,
          iso2: 'GB',
          name: 'United Kingdom',
          emoji: '🇬🇧',
        }),
      ]);

      const result = await service.getCountries();

      expect(result).toEqual([
        { id: 233, code: 'US', name: 'United States', flag: '🇺🇸' },
        { id: 82, code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
      ]);
    });

    it('returns an empty array when there are no countries', async () => {
      mockGetCountries.mockResolvedValue([]);

      const result = await service.getCountries();

      expect(result).toEqual([]);
    });
  });

  describe('getStatesOfCountry', () => {
    it('throws a 404 RequestException when the country code is not found', async () => {
      mockGetCountryByCode.mockResolvedValue(null);

      const error = await captureError(service.getStatesOfCountry('ZZ'));

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('Country with code ZZ not found');
      expect(error.getStatus()).toBe(404);
      expect(mockGetStatesOfCountry).not.toHaveBeenCalled();
    });

    it('maps the states of a found country and includes the type from the first state', async () => {
      mockGetCountryByCode.mockResolvedValue(buildCountryMeta({ iso2: 'US' }));
      mockGetStatesOfCountry.mockResolvedValue([
        buildState({
          id: 1416,
          country_id: 233,
          country_code: 'US',
          iso2: 'CA',
          name: 'California',
          type: 'state',
        }),
        buildState({
          id: 1454,
          country_id: 233,
          country_code: 'US',
          iso2: 'TX',
          name: 'Texas',
          type: 'state',
        }),
      ]);

      const result = await service.getStatesOfCountry('US');

      expect(mockGetCountryByCode).toHaveBeenCalledWith('US');
      expect(mockGetStatesOfCountry).toHaveBeenCalledWith('US');
      expect(result).toEqual({
        states: [
          {
            id: 1416,
            country_id: 233,
            country_code: 'US',
            state_code: 'CA',
            name: 'California',
          },
          {
            id: 1454,
            country_id: 233,
            country_code: 'US',
            state_code: 'TX',
            name: 'Texas',
          },
        ],
        type: 'state',
      });
    });

    it('returns an undefined type when the country has no states', async () => {
      mockGetCountryByCode.mockResolvedValue(buildCountryMeta());
      mockGetStatesOfCountry.mockResolvedValue([]);

      const result = await service.getStatesOfCountry('US');

      expect(result).toEqual({ states: [], type: undefined });
    });
  });

  describe('getCitiesOfState', () => {
    it('throws a 404 RequestException when the state code is not found in the country', async () => {
      mockGetStateByCode.mockResolvedValue(null);

      const error = await captureError(service.getCitiesOfState('US', 'ZZ'));

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('State with code ZZ not found in country US');
      expect(error.getStatus()).toBe(404);
      expect(mockGetCitiesOfState).not.toHaveBeenCalled();
    });

    it('maps the cities of a found state', async () => {
      mockGetStateByCode.mockResolvedValue(buildState({ iso2: 'CA' }));
      mockGetCitiesOfState.mockResolvedValue([
        buildCity({
          id: 111969,
          country_id: 233,
          country_code: 'US',
          state_id: 1416,
          state_code: 'CA',
          name: 'Los Angeles',
        }),
      ]);

      const result = await service.getCitiesOfState('US', 'CA');

      expect(mockGetStateByCode).toHaveBeenCalledWith('US', 'CA');
      expect(mockGetCitiesOfState).toHaveBeenCalledWith('US', 'CA');
      expect(result).toEqual([
        {
          id: 111969,
          country_id: 233,
          country_code: 'US',
          state_id: 1416,
          state_code: 'CA',
          name: 'Los Angeles',
        },
      ]);
    });

    it('returns an empty array when the state has no cities', async () => {
      mockGetStateByCode.mockResolvedValue(buildState());
      mockGetCitiesOfState.mockResolvedValue([]);

      const result = await service.getCitiesOfState('US', 'CA');

      expect(result).toEqual([]);
    });
  });
});
