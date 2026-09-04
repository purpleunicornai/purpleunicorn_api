import { Controller, Get, Logger, Param } from '@nestjs/common';
import { CountriesService } from './countries.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('System/Config/Countries')
@Controller('system/config/countries')
export class CountriesController {
  logger = new Logger(CountriesController.name);

  constructor(private readonly countriesService: CountriesService) {}

  @Get('/')
  async getCountries() {
    return this.countriesService.getCountries();
  }

  @Get('/:countryCode/states')
  async getCountry(@Param('countryCode') countryCode: string) {
    return this.countriesService.getStatesOfCountry(countryCode);
  }

  @Get('/:countryCode/states/:stateCode/cities')
  async getCities(
    @Param('countryCode') countryCode: string,
    @Param('stateCode') stateCode: string,
  ) {
    return this.countriesService.getCitiesOfState(countryCode, stateCode);
  }
}
