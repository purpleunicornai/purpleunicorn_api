import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { LanguageModel } from 'ai';
import AiConfig from '../../config/ai.config';
import {
  AiSdkReasoningProvider,
  type ProviderCallSettings,
} from '../gemini/gemini.service';
import { SUPPORTED_REASONING_MODELS } from './reasoning-model';

// OpenAI models (Responses API) through the AI SDK, enabled by
// OPENAI_API_KEY.
@Injectable()
export class OpenAiReasoningProvider extends AiSdkReasoningProvider {
  readonly id = 'openai' as const;
  readonly defaultModel = SUPPORTED_REASONING_MODELS.openai[0];

  constructor(
    @Inject(AiConfig.KEY)
    aiConf: Pick<
      ConfigType<typeof AiConfig>,
      | 'vertexProjectId'
      | 'vertexServiceAccount'
      | 'vertexAiLocation'
      | 'openaiApiKey'
    >,
  ) {
    super(aiConf);
  }

  get enabled(): boolean {
    return !!this.aiConf.openaiApiKey;
  }

  protected async createModel(modelId: string): Promise<LanguageModel> {
    const { createOpenAI } = await this.loadOpenAiProvider();
    return createOpenAI({ apiKey: this.aiConf.openaiApiKey })(modelId);
  }

  // Strict JSON schema mode rejects optional properties, which these
  // schemas use; non-strict structured output still returns JSON the SDK
  // validates against the schema.
  protected callSettings(
    _modelId: string,
    { fast }: { fast: boolean },
  ): ProviderCallSettings {
    return {
      providerOptions: {
        openai: {
          strictJsonSchema: false,
          ...(fast ? { reasoningEffort: 'low' } : {}),
        },
      },
    };
  }

  // ESM-only, so loaded with import() like 'ai'; overridden in specs.
  protected async loadOpenAiProvider() {
    return import('@ai-sdk/openai');
  }
}
