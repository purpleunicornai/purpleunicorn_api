import type { AiSdkReasoningProvider } from '../gemini/gemini.service';

// The AI that does the reasoning (scoring, deep research, criteria
// expansion, job spec parsing). Gemini is always available; OpenAI and
// Anthropic are when their API keys are set.

export const REASONING_PROVIDERS = ['google', 'openai', 'anthropic'] as const;
export type ReasoningProviderId = (typeof REASONING_PROVIDERS)[number];

// What an organization may pick, per provider (first is that provider's
// default). Model ids are unique across providers.
export const SUPPORTED_REASONING_MODELS: Record<
  ReasoningProviderId,
  readonly string[]
> = {
  google: ['gemini-3.5-flash', 'gemini-3.5-pro'],
  openai: ['gpt-6.2-sol', 'gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-astra'],
  anthropic: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
};

export type ReasoningModelChoice = {
  provider: ReasoningProviderId;
  model: string;
};

export const DEFAULT_REASONING_MODEL: ReasoningModelChoice = {
  provider: 'google',
  model: 'gemini-3.5-flash',
};

// Every reasoning call takes this last; no model means the provider default.
export type ReasoningCallOptions = { model?: string };

// The reasoning calls. Usage comes back provider-agnostic (plain input,
// output and total token counts).
export type ReasoningProvider = {
  readonly id: ReasoningProviderId;
  readonly enabled: boolean;
} & Pick<
  AiSdkReasoningProvider,
  | 'formatCandidates'
  | 'scoreKnownCandidates'
  | 'scoreCandidates'
  | 'researchCandidate'
  | 'enrichCandidate'
  | 'parseJobSpec'
  | 'describeRole'
  | 'expandSearchTerms'
>;

// A provider and the model to call it with. Callers pass `{ model }` on
// every call: `ai.provider.scoreCandidates(desc, rows, { model: ai.model })`.
export type Reasoning = { provider: ReasoningProvider; model: string };

export function providerOfModel(model: string): ReasoningProviderId | null {
  return (
    REASONING_PROVIDERS.find((provider) =>
      SUPPORTED_REASONING_MODELS[provider].includes(model),
    ) ?? null
  );
}

export function isSupportedReasoningModel(
  provider: string,
  model: string,
): provider is ReasoningProviderId {
  return providerOfModel(model) === provider;
}

// A saved choice that no longer works (a model retired from the list, or
// its provider's key removed) falls back to the default rather than failing
// every AI call.
export function resolveReasoningModel(
  saved: { ai_provider: string | null; ai_model: string | null } | null,
  isEnabled: (provider: ReasoningProviderId) => boolean = () => true,
): ReasoningModelChoice {
  const provider = saved?.ai_provider ?? DEFAULT_REASONING_MODEL.provider;
  const model = saved?.ai_model;
  if (
    !model ||
    !isSupportedReasoningModel(provider, model) ||
    !isEnabled(provider)
  ) {
    return DEFAULT_REASONING_MODEL;
  }
  return { provider, model };
}
