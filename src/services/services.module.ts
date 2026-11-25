import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database/database.module';
import { ReasoningService } from './reasoning/reasoning.service';
import { OpenAiReasoningProvider } from './reasoning/openai-reasoning.provider';
import { AnthropicReasoningProvider } from './reasoning/anthropic-reasoning.provider';
import { GeminiService } from './gemini/gemini.service';
import { PageFetchService } from './page-fetch/page-fetch.service';
import { RocketReachService } from './rocket-reach/rocket-reach.service';
import { RocketReachLookupsService } from './rocket-reach/rocket-reach-lookups.service';
import { GithubSearchService } from './github/github-search.service';
import { VertexService } from './vertex/vertex.service';
import { VertexSearchService } from './vertex/vertex-search.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    ReasoningService,
    OpenAiReasoningProvider,
    AnthropicReasoningProvider,
    VertexService,
    VertexSearchService,
    GeminiService,
    PageFetchService,
    RocketReachService,
    RocketReachLookupsService,
    GithubSearchService,
  ],
  exports: [
    ReasoningService,
    VertexService,
    VertexSearchService,
    GeminiService,
    PageFetchService,
    RocketReachService,
    RocketReachLookupsService,
    GithubSearchService,
  ],
})
export class ServicesModule {}
