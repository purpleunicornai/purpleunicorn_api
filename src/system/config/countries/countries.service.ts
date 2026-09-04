import { Injectable, Logger } from '@nestjs/common';
import {
  getCountries,
  getStatesOfCountry,
  getCitiesOfState,
  getCountryByCode,
  getStateByCode,
} from '@countrystatecity/countries';
import { RequestException } from '../../../common/exception/core/ExceptionBase';

@Injectable()
export class CountriesService {
  logger = new Logger(CountriesService.name);

  public async getCountries() {
    const response = await getCountries();
    return response.map((item) => ({
      id: item.id,
      code: item.iso2,
      name: item.name,
      flag: item.emoji,
    }));
  }

  public async getStatesOfCountry(countryCode: string) {
    const country = await getCountryByCode(countryCode);
    if (!country) {
      throw new RequestException(
        `Country with code ${countryCode} not found`,
        404,
      );
    }
    const response = await getStatesOfCountry(countryCode);
    const mappedResponse = response.map((item) => ({
      id: item.id,
      country_id: item.country_id,
      country_code: item.country_code,
      state_code: item.iso2,
      name: item.name,
    }));
    return {
      states: mappedResponse,
      type: response?.[0]?.type,
    };
  }

  public async getCitiesOfState(countryCode: string, stateCode: string) {
    const state = await getStateByCode(countryCode, stateCode);
    if (!state) {
      throw new RequestException(
        `State with code ${stateCode} not found in country ${countryCode}`,
        404,
      );
    }

    const response = await getCitiesOfState(countryCode, stateCode);
    return response.map((item) => ({
      id: item.id,
      country_id: item.country_id,
      country_code: item.country_code,
      state_id: item.state_id,
      state_code: item.state_code,
      name: item.name,
    }));
  }
}
