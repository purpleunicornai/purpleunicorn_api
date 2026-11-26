import type { PrismaService } from '../../common/database/prisma.service';
import type { GeminiService } from '../gemini/gemini.service';
import type { AnthropicReasoningProvider } from './anthropic-reasoning.provider';
import type { OpenAiReasoningProvider } from './openai-reasoning.provider';
import {
  DEFAULT_REASONING_MODEL,
  providerOfModel,
  resolveReasoningModel,
} from './reasoning-model';
import { ReasoningService } from './reasoning.service';

describe('resolveReasoningModel', () => {
  it('uses the saved choice when it’s supported', () => {
    expect(
      resolveReasoningModel({
        ai_provider: 'google',
        ai_model: 'gemini-2.5-pro',
      }),
    ).toEqual({ provider: 'google', model: 'gemini-2.5-pro' });
    expect(
      resolveReasoningModel({ ai_provider: 'openai', ai_model: 'gpt-6.2-sol' }),
    ).toEqual({ provider: 'openai', model: 'gpt-6.2-sol' });
  });

  it.each([
    ['no settings row', null],
    ['no model picked', { ai_provider: null, ai_model: null }],
    ['a retired model', { ai_provider: 'google', ai_model: 'gemini-1.0' }],
    [
      'an unknown provider',
      { ai_provider: 'acme', ai_model: 'gemini-2.5-pro' },
    ],
    [
      'a model saved under the wrong provider',
      { ai_provider: 'google', ai_model: 'claude-sonnet-5-5' },
    ],
  ])('falls back to the default for %s', (_why, saved) => {
    expect(resolveReasoningModel(saved)).toEqual(DEFAULT_REASONING_MODEL);
  });

  it('falls back to the default when the provider isn’t configured', () => {
    expect(
      resolveReasoningModel(
        { ai_provider: 'anthropic', ai_model: 'claude-opus-5-5' },
        (provider) => provider !== 'anthropic',
      ),
    ).toEqual(DEFAULT_REASONING_MODEL);
  });
});

describe('providerOfModel', () => {
  it('finds the provider a model belongs to', () => {
    expect(providerOfModel('gemini-3.5-flash')).toBe('google');
    expect(providerOfModel('gpt-6-luna')).toBe('openai');
    expect(providerOfModel('claude-haiku-5-5')).toBe('anthropic');
    expect(providerOfModel('llama-9')).toBeNull();
  });
});

describe('ReasoningService', () => {
  const gemini = { id: 'google', enabled: true } as GeminiService;
  const openai = { id: 'openai', enabled: true } as OpenAiReasoningProvider;
  const anthropic = {
    id: 'anthropic',
    enabled: false,
  } as AnthropicReasoningProvider;
  const settings: Record<string, { ai_provider: string; ai_model: string }> = {
    'org-pro': { ai_provider: 'google', ai_model: 'gemini-2.5-pro' },
    'org-openai': { ai_provider: 'openai', ai_model: 'gpt-6.2-astra' },
    'org-claude': { ai_provider: 'anthropic', ai_model: 'claude-opus-5-5' },
  };
  const roleOrgs: Record<string, string> = {
    'role-pro': 'org-pro',
    'role-default': 'org-default',
  };
  const prisma = {
    organization_settings: {
      findUnique: jest.fn(
        async ({ where }: { where: { organization_id: string } }) =>
          settings[where.organization_id] ?? null,
      ),
    },
    roles: {
      findUnique: jest.fn(async ({ where }: { where: { uid: string } }) =>
        roleOrgs[where.uid]
          ? { project: { organization_id: roleOrgs[where.uid] } }
          : null,
      ),
    },
  } as unknown as PrismaService;
  const service = new ReasoningService(prisma, gemini, openai, anthropic);

  it('resolves each organization’s own model and provider', async () => {
    await expect(service.forOrganization('org-pro')).resolves.toEqual({
      provider: gemini,
      model: 'gemini-2.5-pro',
    });
    await expect(service.forOrganization('org-openai')).resolves.toEqual({
      provider: openai,
      model: 'gpt-6.2-astra',
    });
    await expect(service.forOrganization('org-default')).resolves.toEqual({
      provider: gemini,
      model: DEFAULT_REASONING_MODEL.model,
    });
  });

  it('falls back to the default when the org’s provider has no key, and says so', async () => {
    await expect(service.forOrganization('org-claude')).resolves.toEqual({
      provider: gemini,
      model: DEFAULT_REASONING_MODEL.model,
    });
    await expect(service.choiceFor('org-claude')).resolves.toEqual({
      choice: DEFAULT_REASONING_MODEL,
      saved: false,
    });
    await expect(service.choiceFor('org-openai')).resolves.toMatchObject({
      saved: true,
    });
  });

  it('offers only configured providers’ models', () => {
    const offered = service.availableModels();

    expect(new Set(offered.map((choice) => choice.provider))).toEqual(
      new Set(['google', 'openai']),
    );
    expect(offered).toContainEqual({ provider: 'openai', model: 'gpt-6-luna' });
    expect(offered[0]).toEqual(DEFAULT_REASONING_MODEL);
  });

  it('resolves a role through its project’s organization', async () => {
    await expect(service.forRole('role-pro')).resolves.toMatchObject({
      model: 'gemini-2.5-pro',
    });
    await expect(service.forRole('role-default')).resolves.toMatchObject({
      model: DEFAULT_REASONING_MODEL.model,
    });
  });

  it('uses the default for a role it can’t find', async () => {
    await expect(service.forRole('missing')).resolves.toEqual({
      provider: gemini,
      model: DEFAULT_REASONING_MODEL.model,
    });
  });
});
