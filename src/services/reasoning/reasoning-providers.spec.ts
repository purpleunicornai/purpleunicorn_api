import { encodeBase64Json } from '../../common/utils/base64';
import { GeminiService } from '../gemini/gemini.service';
import { AnthropicReasoningProvider } from './anthropic-reasoning.provider';
import { OpenAiReasoningProvider } from './openai-reasoning.provider';

const VERTEX_CREDENTIALS = {
  type: 'service_account',
  client_email: 'sa@example.com',
  private_key: 'fake-key',
};
const KEYS = {
  vertexProjectId: 'test-project',
  vertexServiceAccount: encodeBase64Json(VERTEX_CREDENTIALS),
  vertexAiLocation: 'global',
  openaiApiKey: 'openai-key',
  anthropicApiKey: 'anthropic-key',
};

const RESEARCH_OUTPUT = {
  summary: 'Senior TypeScript engineer.',
  findings: [{ fact: 'Leads the platform team', sourceNumber: 1 }],
  identityConfidence: 'high',
  identityReason: 'Same name, employer and city',
  score: 80,
  reasoning: 'Strong match',
  candidate: null,
  qualifications: [],
};

// Mocks the AI SDK ('ai') and each provider package on an instance: no
// network, and every model is a plain { provider, modelId } record.
function mocked<
  T extends
    GeminiService | OpenAiReasoningProvider | AnthropicReasoningProvider,
>(provider: T) {
  const generateText = jest.fn();
  const Output = {
    array: jest.fn((spec: unknown) => ({ array: spec })),
    object: jest.fn((spec: unknown) => ({ object: spec })),
  };
  const modelFactory = (name: string) =>
    jest.fn(() => (modelId: string) => ({ provider: name, modelId }));
  const createVertex = jest.fn(() =>
    Object.assign(
      (modelId: string) => ({ provider: 'google.vertex', modelId }),
      {
        tools: { googleSearch: jest.fn(() => 'google_search_tool') },
      },
    ),
  );
  const createOpenAI = modelFactory('openai');
  const createAnthropic = modelFactory('anthropic');
  const spy = (method: string, value: unknown) =>
    jest
      .spyOn(provider as never, method as never)
      .mockResolvedValue(value as never);
  spy('loadAi', { generateText, Output });
  spy('loadVertexProvider', { createVertex });
  if (provider instanceof OpenAiReasoningProvider) {
    spy('loadOpenAiProvider', { createOpenAI });
  }
  if (provider instanceof AnthropicReasoningProvider) {
    spy('loadAnthropicProvider', { createAnthropic });
  }
  return {
    provider,
    generateText,
    Output,
    createOpenAI,
    createAnthropic,
    createVertex,
  };
}

describe('reasoning providers', () => {
  describe('enabled', () => {
    it('turns OpenAI and Anthropic on only with their API keys', () => {
      expect(new OpenAiReasoningProvider(KEYS).enabled).toBe(true);
      expect(new AnthropicReasoningProvider(KEYS).enabled).toBe(true);
      expect(
        new OpenAiReasoningProvider({
          ...KEYS,
          openaiApiKey: undefined,
        }).enabled,
      ).toBe(false);
      expect(
        new AnthropicReasoningProvider({
          ...KEYS,
          anthropicApiKey: '',
        }).enabled,
      ).toBe(false);
      expect(new GeminiService(KEYS).enabled).toBe(true);
    });
  });

  // One structured call per provider: the org's model, its key, the shared
  // output schema, and the provider's own call settings.
  describe.each([
    {
      name: 'OpenAI',
      build: () => new OpenAiReasoningProvider(KEYS),
      model: 'gpt-6.2-sol',
      factory: 'createOpenAI' as const,
      apiKey: 'openai-key',
      fast: {
        providerOptions: {
          openai: { strictJsonSchema: false, reasoningEffort: 'low' },
        },
      },
      thorough: { providerOptions: { openai: { strictJsonSchema: false } } },
    },
    {
      name: 'Anthropic',
      build: () => new AnthropicReasoningProvider(KEYS),
      model: 'claude-sonnet-5-5',
      factory: 'createAnthropic' as const,
      apiKey: 'anthropic-key',
      fast: {
        maxOutputTokens: 32_000,
        providerOptions: { anthropic: { effort: 'low' } },
      },
      thorough: { maxOutputTokens: 32_000 },
    },
  ])('$name', ({ build, model, factory, apiKey, fast, thorough }) => {
    it('parses a job spec into structured output on the org’s model', async () => {
      const mocks = mocked(build());
      mocks.generateText.mockResolvedValue({
        output: { items: [] },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });

      const result = await mocks.provider.parseJobSpec('Senior engineer', {
        model,
      });

      expect(result).toEqual({ items: [], tokensUsed: 15 });
      expect(mocks[factory]).toHaveBeenCalledWith({ apiKey });
      const call = mocks.generateText.mock.calls[0][0];
      expect(call.model).toEqual({
        provider: expect.any(String),
        modelId: model,
      });
      expect(call.output).toEqual({ object: expect.anything() });
      expect(call).toMatchObject(fast);
    });

    it('defaults to its own default model', async () => {
      const mocks = mocked(build());
      mocks.generateText.mockResolvedValue({
        output: { items: [] },
        usage: {},
      });

      await mocks.provider.parseJobSpec('Senior engineer');

      expect(mocks.generateText.mock.calls[0][0].model.modelId).toBe(
        mocks.provider.defaultModel,
      );
    });

    it('researches with Gemini’s grounded search, then structures with the org’s model', async () => {
      const mocks = mocked(build());
      jest
        .spyOn(mocks.provider as never, 'resolveRedirect' as never)
        .mockImplementation((async (url: string) => url) as never);
      mocks.generateText
        .mockResolvedValueOnce({
          text: 'Jane leads the platform team.',
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          providerMetadata: {
            google: {
              groundingMetadata: {
                webSearchQueries: ['Jane Doe Acme'],
                groundingChunks: [
                  { web: { uri: 'https://acme.dev/team', title: 'Team' } },
                ],
                groundingSupports: [],
              },
            },
          },
        })
        .mockResolvedValueOnce({
          output: RESEARCH_OUTPUT,
          usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
        });

      const research = await mocks.provider.researchCandidate(
        'Platform lead',
        { name: 'Jane Doe', linkedinUrl: 'https://linkedin.com/in/jane' },
        { model },
      );

      const [search, structure] = mocks.generateText.mock.calls.map(
        ([call]) => call,
      );
      expect(mocks.createVertex).toHaveBeenCalledWith({
        project: 'test-project',
        location: 'global',
        googleAuthOptions: { credentials: VERTEX_CREDENTIALS },
      });
      expect(search.model).toEqual({
        provider: 'google.vertex',
        modelId: 'gemini-3.5-flash',
      });
      expect(search.tools).toEqual({ google_search: 'google_search_tool' });
      expect(structure.model.modelId).toBe(model);
      expect(structure.output).toEqual({ object: expect.anything() });
      expect(structure).toMatchObject(thorough);
      expect(
        structure.providerOptions?.openai?.reasoningEffort,
      ).toBeUndefined();
      expect(structure.providerOptions?.anthropic).toBeUndefined();
      expect(research).toMatchObject({
        findings: [
          {
            fact: 'Leads the platform team',
            sourceUrl: 'https://acme.dev/team',
          },
        ],
        searchQueries: ['Jane Doe Acme'],
        usage: { inputTokens: 300, outputTokens: 130, totalTokens: 430 },
      });
    });
  });

  it('keeps Gemini researching end to end on the org’s Gemini model', async () => {
    const mocks = mocked(new GeminiService(KEYS));
    jest
      .spyOn(mocks.provider as never, 'resolveRedirect' as never)
      .mockImplementation((async (url: string) => url) as never);
    mocks.generateText
      .mockResolvedValueOnce({ text: '', usage: {}, providerMetadata: {} })
      .mockResolvedValueOnce({ output: RESEARCH_OUTPUT, usage: {} });

    await mocks.provider.researchCandidate(
      'Role',
      { name: 'Jane' },
      {
        model: 'gemini-3.1-pro-preview',
      },
    );

    const [search, structure] = mocks.generateText.mock.calls.map(([c]) => c);
    expect(search.model.modelId).toBe('gemini-3.1-pro-preview');
    expect(structure.model.modelId).toBe('gemini-3.1-pro-preview');
  });
});
