import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { ClerkAuthGuard } from '../../auth/guards/clerk-auth.guard';
import { CurrentAuth } from '../../auth/current-auth.decorator';
import type { ClerkAuthContext } from '../../auth/auth.types';
import { requireOrgId } from '../../common/utils/organizationUtils';
import { RolesService } from '../roles.service';
import { CapturedProfileDto } from './captured-profile.dto';
import { ProfileCaptureService } from './profile-capture.service';
import { OrgCapturesService } from './org-captures.service';
import { SyncCapturesDto } from './org-captures.dto';
import type { OrgCapture } from './org-captures';
import type { CaptureScore, ProfileMembership } from './profile-capture';

class ProfileLookupQuery {
  @IsString()
  @MaxLength(500)
  url!: string;
}

// What the Chrome extension needs beyond the app's own API (projects,
// roles, shortlist): org-wide captures, role membership, and add-to-role. Same Clerk session auth as the app: the
// extension syncs its Clerk session from the web app, so the token carries
// the user and their active org exactly as the app's does.
@ApiTags('Extension')
@ApiBearerAuth('bearer')
@UseGuards(ClerkAuthGuard)
@Controller('extension')
export class ExtensionController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly captures: ProfileCaptureService,
    private readonly orgCaptures: OrgCapturesService,
  ) {}

  // Save captured profiles for the whole org (the extension's offline queue
  // flushes here, so it's batched and safe to repeat).
  @Post('captures')
  async sync(
    @Body() body: SyncCapturesDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<OrgCapture[]> {
    return this.orgCaptures.sync(
      requireOrgId(auth),
      auth.userId,
      body.captures,
    );
  }

  // The org's captures, newest first, without expired unassigned ones.
  @Get('captures')
  async list(@CurrentAuth() auth: ClerkAuthContext): Promise<OrgCapture[]> {
    return this.orgCaptures.list(requireOrgId(auth), auth.userId);
  }

  // Clears the caller's own unassigned captures.
  @Delete('captures')
  async clearMine(
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<{ deleted: number }> {
    const deleted = await this.orgCaptures.clearMine(
      requireOrgId(auth),
      auth.userId,
    );
    return { deleted };
  }

  @Delete('captures/:slug')
  async remove(
    @Param('slug') slug: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<{ deleted: number }> {
    const deleted = await this.orgCaptures.remove(requireOrgId(auth), slug);
    return { deleted };
  }

  // Which roles in the active org a LinkedIn profile is already in.
  @Get('profiles')
  async lookup(
    @Query() query: ProfileLookupQuery,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<ProfileMembership> {
    const orgId = requireOrgId(auth);
    return this.captures.membership(query.url, orgId, auth.userId);
  }

  // Add a captured profile to a role and score it against the role's
  // filters. Free (no AI, no credits) and safe to repeat.
  @Post('roles/:roleId/captures')
  async capture(
    @Param('roleId') roleId: string,
    @Body() profile: CapturedProfileDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<CaptureScore> {
    const orgId = requireOrgId(auth);
    await this.rolesService.getRole(roleId, orgId, auth.userId);
    const score = await this.captures.capture(roleId, profile);
    await this.orgCaptures.markAssigned(orgId, auth.userId, profile, roleId);
    return score;
  }
}
