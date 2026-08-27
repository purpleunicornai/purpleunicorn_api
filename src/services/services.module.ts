import { Module } from '@nestjs/common';
import { GoogleSearchService } from './google-search/google-search.service';
import { GeminiService } from './gemini/gemini.service';

@Module({
  providers: [GoogleSearchService, GeminiService],
  exports: [GoogleSearchService, GeminiService],
})
export class ServicesModule {}
