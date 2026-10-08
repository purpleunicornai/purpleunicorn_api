import { Module } from '@nestjs/common';
import { GoogleSearchService } from './google-search/google-search.service';
import { GeminiService } from './gemini/gemini.service';
import { PageFetchService } from './page-fetch/page-fetch.service';
import { RocketReachService } from './rocket-reach/rocket-reach.service';

@Module({
  providers: [
    GoogleSearchService,
    GeminiService,
    PageFetchService,
    RocketReachService,
  ],
  exports: [
    GoogleSearchService,
    GeminiService,
    PageFetchService,
    RocketReachService,
  ],
})
export class ServicesModule {}
