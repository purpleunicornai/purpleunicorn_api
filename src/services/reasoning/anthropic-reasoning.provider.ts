import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { LanguageModel } from 'ai';
import AiConfig from '../../config/ai.config';
import {
  AiSdkReasoningProvider,
  type ProviderCallSettings,
} from '../gemini/gemini.service';
import { SUPPORTED_REASONING_MODELS } from './reasoning-model';

// Room for a batch of scored candidates plus adaptive thinking: Anthropic's
// max_tokens covers both, and the SDK's default is far smaller.
const MAX_OUTPUT_TOKENS = 32_000;

// Claude models (Messages API) through the AI SDK, enabled by
// ANTHROPIC_API_KEY. Structured output uses the SDK's default "auto" mode:
// native output_format where the schema allows, a JSON tool otherwise.
@Injectable()
export class AnthropicReasoningProvider extends AiSdkReasoningProvider {
  readonly id = 'anthropic' as const;
  readonly defaultModel = SUPPORTED_REASONING_MODELS.anthropic[0];

  constructor(
    @Inject(AiConfig.KEY)
    aiConf: Pick<
      ConfigType<typeof AiConfig>,
      | 'vertexProjectId'
      | 'vertexServiceAccount'
      | 'vertexAiLocation'
      | 'anthropicApiKey'
    >,
  ) {
    super(aiConf);
  }

  get enabled(): boolean {
    return !!this.aiConf.anthropicApiKey;
  }

  protected async createModel(modelId: string): Promise<LanguageModel> {
    const { createAnthropic } = await this.loadAnthropicProvider();
    return createAnthropic({ apiKey: this.aiConf.anthropicApiKey })(modelId);
  }

  // Current Claude models always think adaptively; `effort` turns it down.
  protected callSettings(
    _modelId: string,
    { fast }: { fast: boolean },
  ): ProviderCallSettings {
    return {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(fast ? { providerOptions: { anthropic: { effort: 'low' } } } : {}),
    };
  }

  // ESM-only, so loaded with import() like 'ai'; overridden in specs.
  protected async loadAnthropicProvider() {
    return import('@ai-sdk/anthropic');
  }
}
