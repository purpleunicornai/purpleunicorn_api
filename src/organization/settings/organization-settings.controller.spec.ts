import type { ClerkAuthContext } from '../../auth/auth.types';
import type { PrismaService } from '../../common/database/prisma.service';
import type { ReasoningService } from '../../services/reasoning/reasoning.service';
import { OrganizationSettingsController } from './organization-settings.controller';

const admin = {
  userId: 'user-1',
  orgId: 'org-1',
  orgRole: 'org:admin',
  claims: {},
} as ClerkAuthContext;

describe('OrganizationSettingsController', () => {
  function setup() {
    const prisma = {
      organization_settings: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const reasoning = {
      isEnabled: jest.fn((provider: string) => provider !== 'anthropic'),
      availableModels: jest.fn(() => [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-6.2-sol' },
      ]),
      choiceFor: jest.fn().mockResolvedValue({
        choice: { provider: 'openai', model: 'gpt-6.2-sol' },
        saved: true,
      }),
    };
    const controller = new OrganizationSettingsController(
      prisma as unknown as PrismaService,
      reasoning as unknown as ReasoningService,
    );
    return { prisma, reasoning, controller };
  }

  it('shows the model in effect and only configured providers’ models', async () => {
    const { controller } = setup();

    await expect(controller.get(admin)).resolves.toEqual({
      aiProvider: 'openai',
      aiModel: 'gpt-6.2-sol',
      aiModelIsDefault: false,
      supportedModels: [
        { provider: 'google', model: 'gemini-2.5-flash' },
        { provider: 'openai', model: 'gpt-6.2-sol' },
      ],
    });
  });

  it('saves a model with the provider it belongs to', async () => {
    const { controller, prisma } = setup();

    await controller.update({ aiModel: 'gpt-6.2-sol' }, admin);

    expect(prisma.organization_settings.upsert).toHaveBeenCalledWith({
      where: { organization_id: 'org-1' },
      create: {
        organization_id: 'org-1',
        ai_provider: 'openai',
        ai_model: 'gpt-6.2-sol',
      },
      update: { ai_provider: 'openai', ai_model: 'gpt-6.2-sol' },
    });
  });

  it('clears the choice with null', async () => {
    const { controller, prisma } = setup();

    await controller.update({ aiModel: null }, admin);

    expect(prisma.organization_settings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { ai_provider: null, ai_model: null },
      }),
    );
  });

  it.each([
    ['an unknown model', 'llama-9', 'UNSUPPORTED_AI_MODEL'],
    [
      'an unconfigured provider’s model',
      'claude-opus-5-5',
      'AI_PROVIDER_NOT_CONFIGURED',
    ],
  ])('rejects %s with 400', async (_why, aiModel, code) => {
    const { controller, prisma } = setup();

    await expect(controller.update({ aiModel }, admin)).rejects.toMatchObject({
      status: 400,
      options: { description: code },
    });
    expect(prisma.organization_settings.upsert).not.toHaveBeenCalled();
  });

  it('only lets org admins change it', async () => {
    const { controller } = setup();

    await expect(
      controller.update(
        { aiModel: 'gpt-6.2-sol' },
        { ...admin, orgRole: 'org:member' },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
