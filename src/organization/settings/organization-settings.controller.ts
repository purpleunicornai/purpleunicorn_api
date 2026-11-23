import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ClerkAuthContext } from '../../auth/auth.types';
import { CurrentAuth } from '../../auth/current-auth.decorator';
import { ClerkAuthGuard } from '../../auth/guards/clerk-auth.guard';
import { PrismaService } from '../../common/database/prisma.service';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import {
  requireOrgAdmin,
  requireOrgId,
} from '../../common/utils/organizationUtils';
import { providerOfModel } from '../../services/reasoning/reasoning-model';
import { ReasoningService } from '../../services/reasoning/reasoning.service';
import { UpdateOrganizationSettingsDto } from './organization-settings.dto';

export type OrganizationSettingsView = {
  aiProvider: string;
  aiModel: string;
  // True when the org's own pick isn't in effect (none saved, or its
  // provider is no longer configured).
  aiModelIsDefault: boolean;
  // Models of configured providers only.
  supportedModels: { provider: string; model: string }[];
};

// The org's reasoning model. Any member can read it; org admins change it.
@ApiTags('Organization Settings')
@ApiBearerAuth('bearer')
@UseGuards(ClerkAuthGuard)
@Controller('organization/settings')
export class OrganizationSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reasoning: ReasoningService,
  ) {}

  @Get()
  async get(
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<OrganizationSettingsView> {
    return this.view(requireOrgId(auth));
  }

  @Patch()
  async update(
    @Body() dto: UpdateOrganizationSettingsDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<OrganizationSettingsView> {
    const organizationId = requireOrgAdmin(auth);
    if (dto.aiModel !== undefined) {
      const choice = {
        ai_provider:
          dto.aiModel === null ? null : this.providerFor(dto.aiModel),
        ai_model: dto.aiModel,
      };
      await this.prisma.organization_settings.upsert({
        where: { organization_id: organizationId },
        create: { organization_id: organizationId, ...choice },
        update: choice,
      });
    }
    return this.view(organizationId);
  }

  // The provider is implied by the model (ids are unique across providers).
  private providerFor(model: string) {
    const provider = providerOfModel(model);
    if (!provider) {
      throw new RequestException(
        `Unsupported model "${model}"`,
        HttpStatus.BAD_REQUEST,
        'UNSUPPORTED_AI_MODEL',
      );
    }
    if (!this.reasoning.isEnabled(provider)) {
      throw new RequestException(
        `${provider} is not configured on this server`,
        HttpStatus.BAD_REQUEST,
        'AI_PROVIDER_NOT_CONFIGURED',
      );
    }
    return provider;
  }

  private async view(
    organizationId: string,
  ): Promise<OrganizationSettingsView> {
    const { choice, saved } = await this.reasoning.choiceFor(organizationId);
    return {
      aiProvider: choice.provider,
      aiModel: choice.model,
      aiModelIsDefault: !saved,
      supportedModels: this.reasoning.availableModels(),
    };
  }
}
