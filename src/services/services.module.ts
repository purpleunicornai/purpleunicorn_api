import { Module } from '@nestjs/common';
import { GoogleSearchService } from './google-search/google-search.service';
import { GeminiService } from './gemini/gemini.service';
import { PageFetchService } from './page-fetch/page-fetch.service';

@Module({
  providers: [GoogleSearchService, GeminiService, PageFetchService],
  exports: [GoogleSearchService, GeminiService, PageFetchService],
})
export class ServicesModule {}
