import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ClerkAuthGuard } from '../../auth/guards/clerk-auth.guard';
import { CurrentAuth } from '../../auth/current-auth.decorator';
import type { ClerkAuthContext } from '../../auth/auth.types';
import { ClerkService } from '../../common/clerk/clerk.service';
import { requireOrgId } from '../../common/utils/organizationUtils';
import { RolesService } from '../roles.service';
import { resolveUserName } from '../resolve-user-name';
import { RoleSearchJobsService } from './role-search-jobs.service';
import { RoleSearchState } from './role-search-job';

export class StartRoleSearchDto {
  // Begin again at page 1 (Run search, Rerun) instead of resuming.
  @IsOptional()
  @IsBoolean()
  restart?: boolean;
}

// The role's background search: start (or resume), pause, stop, and status
// for the app to poll.
@ApiTags('Roles')
@ApiBearerAuth('bearer')
@UseGuards(ClerkAuthGuard)
@Controller('roles/:roleId/search')
export class RoleSearchController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly clerkService: ClerkService,
    private readonly jobs: RoleSearchJobsService,
  ) {}

  @Get('status')
  async status(
    @Param('roleId') roleId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<RoleSearchState> {
    await this.rolesService.getRole(roleId, requireOrgId(auth), auth.userId);
    return this.jobs.status(roleId);
  }

  // The role's search history, newest first.
  @Get('history')
  async history(
    @Param('roleId') roleId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = requireOrgId(auth);
    await this.rolesService.getRole(roleId, orgId, auth.userId);
    return this.rolesService.searchHistory(orgId, auth.userId, roleId);
  }

  @Post('start')
  start(
    @Param('roleId') roleId: string,
    @Body() body: StartRoleSearchDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<RoleSearchState> {
    return this.run(roleId, auth, { restart: body.restart === true });
  }

  @Post('resume')
  resume(
    @Param('roleId') roleId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<RoleSearchState> {
    return this.run(roleId, auth, {});
  }

  // Look deeper: once every page is loaded, search again with a broader
  // query (titles, location, non-negotiables), skipping people already found.
  @Post('deeper')
  deeper(
    @Param('roleId') roleId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<RoleSearchState> {
    return this.run(roleId, auth, { deeper: true });
  }

  @Post('pause')
  async pause(
    @Param('roleId') roleId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<RoleSearchState> {
    await this.rolesService.getRole(roleId, requireOrgId(auth), auth.userId);
    return this.jobs.pause(roleId);
  }

  @Post('stop')
  async stop(
    @Param('roleId') roleId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<RoleSearchState> {
    await this.rolesService.getRole(roleId, requireOrgId(auth), auth.userId);
    return this.jobs.stop(roleId);
  }

  private async run(
    roleId: string,
    auth: ClerkAuthContext,
    mode: { restart?: boolean; deeper?: boolean },
  ): Promise<RoleSearchState> {
    const orgId = requireOrgId(auth);
    const [role, userName] = await Promise.all([
      this.rolesService.getRole(roleId, orgId, auth.userId),
      resolveUserName(this.clerkService, auth.userId),
    ]);
    return this.jobs.start(
      { orgId, roleId, userId: auth.userId, userName, roleName: role.name },
      mode,
    );
  }
}
