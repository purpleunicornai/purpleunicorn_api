import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { GeminiService } from '../gemini/gemini.service';
import { AnthropicReasoningProvider } from './anthropic-reasoning.provider';
import { OpenAiReasoningProvider } from './openai-reasoning.provider';
import {
  REASONING_PROVIDERS,
  SUPPORTED_REASONING_MODELS,
  resolveReasoningModel,
  type Reasoning,
  type ReasoningModelChoice,
  type ReasoningProvider,
  type ReasoningProviderId,
} from './reasoning-model';

// Resolves which provider and model reason for an organization, per call,
// from organization_settings (no row, or a choice that no longer works:
// the default).
@Injectable()
export class ReasoningService {
  private readonly providers: Record<ReasoningProviderId, ReasoningProvider>;

  constructor(
    private readonly prisma: PrismaService,
    gemini: GeminiService,
    openai: OpenAiReasoningProvider,
    anthropic: AnthropicReasoningProvider,
  ) {
    this.providers = { google: gemini, openai, anthropic };
  }

  isEnabled = (provider: ReasoningProviderId): boolean =>
    this.providers[provider].enabled;

  // The models an org can pick: those of every configured provider.
  availableModels(): ReasoningModelChoice[] {
    return REASONING_PROVIDERS.filter(this.isEnabled).flatMap((provider) =>
      SUPPORTED_REASONING_MODELS[provider].map((model) => ({
        provider,
        model,
      })),
    );
  }

  // The org's model in effect, and whether it's one the org picked.
  async choiceFor(organizationId: string): Promise<{
    choice: ReasoningModelChoice;
    saved: boolean;
  }> {
    const settings = await this.prisma.organization_settings.findUnique({
      where: { organization_id: organizationId },
      select: { ai_provider: true, ai_model: true },
    });
    const choice = resolveReasoningModel(settings, this.isEnabled);
    // A saved choice that fell back (provider key removed) isn't in effect.
    return { choice, saved: settings?.ai_model === choice.model };
  }

  async forOrganization(organizationId: string): Promise<Reasoning> {
    const { choice } = await this.choiceFor(organizationId);
    return this.reasoningFor(choice);
  }

  // A role's organization is its project's.
  async forRole(roleId: string): Promise<Reasoning> {
    const role = await this.prisma.roles.findUnique({
      where: { uid: roleId },
      select: { project: { select: { organization_id: true } } },
    });
    if (!role) return this.reasoningFor(resolveReasoningModel(null));
    return this.forOrganization(role.project.organization_id);
  }

  private reasoningFor(choice: ReasoningModelChoice): Reasoning {
    return { provider: this.providers[choice.provider], model: choice.model };
  }
}
