import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Logger,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Observable, from } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { RolesService } from './roles.service';
import { SearchService } from './search/search.service';
import { RoleFilterDto } from './dto/role_filter.dto';
import {
  CreateRoleDto,
  RoleDto,
  RoleResultSummaryDto,
  RunSearchDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { ClerkAuthContext } from '../auth/auth.types';
import { RequestException } from '../common/exception/core/ExceptionBase';
import { Serialize } from '../common/interceptors/serialize.interceptor';
import { LogsService } from '../common/logs/logs.service';
import { ClerkService } from '../common/clerk/clerk.service';
import { role_result } from '../generated/prisma/client';
import { requireOrgId } from '../common/utils/organizationUtils';

@ApiTags('Roles')
@ApiBearerAuth('bearer')
@UseGuards(ClerkAuthGuard)
@Controller('roles')
export class RolesController {
  private readonly logger = new Logger(RolesController.name);

  constructor(
    private readonly rolesService: RolesService,
    private readonly searchService: SearchService,
    private readonly logsService: LogsService,
    private readonly clerkService: ClerkService,
  ) {}

  @Get()
  @Serialize(RoleDto)
  async findAll(
    @Query('projectId') projectId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    if (!projectId) {
      throw new RequestException(
        'projectId query parameter is required',
        HttpStatus.BAD_REQUEST,
        'PROJECT_ID_REQUIRED',
      );
    }
    const orgId = requireOrgId(auth);
    return this.rolesService.findAllForProject(projectId, orgId, auth.userId);
  }

  @Get(':id')
  @Serialize(RoleDto)
  async findOne(
    @Param('id') id: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = requireOrgId(auth);
    return this.rolesService.findOne(id, orgId, auth.userId);
  }

  @Post()
  @Serialize(RoleDto)
  async create(
    @Body() body: CreateRoleDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = requireOrgId(auth);
    const role = await this.rolesService.create(body, auth.userId, orgId);

    void this.logsService.log({
      organization_id: orgId,
      user_id: auth.userId,
      type: 'ROLE_CREATED',
      role_id: role.uid,
      message: `Created role "${role.name}"`,
    });

    return role;
  }

  @Patch(':id')
  @Serialize(RoleDto)
  async update(
    @Param('id') id: string,
    @Body() body: UpdateRoleDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = requireOrgId(auth);
    const role = await this.rolesService.update(id, body, auth.userId, orgId);

    void this.logsService.log({
      organization_id: orgId,
      user_id: auth.userId,
      type: 'ROLE_UPDATED',
      role_id: role.uid,
      message: `Updated role "${role.name}"`,
    });

    return role;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentAuth() auth: ClerkAuthContext) {
    const orgId = requireOrgId(auth);
    const role = await this.rolesService.remove(id, auth.userId, orgId);

    void this.logsService.log({
      organization_id: orgId,
      user_id: auth.userId,
      type: 'ROLE_DELETED',
      role_id: role.uid,
      message: `Deleted role "${role.name}"`,
    });

    return { success: true };
  }

  @Post('/:roleId/filters')
  async createFilter(
    @Param('roleId') roleId: string,
    @Body() body: RoleFilterDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    console.log('ATEEMPTING TO CREAT NEW FILRES', body);
    const orgId = requireOrgId(auth);
    const { filter, isFirst } = await this.rolesService.createFilter(
      roleId,
      body,
      orgId,
      auth.userId,
    );

    void this.logsService.log({
      organization_id: orgId,
      user_id: auth.userId,
      type: isFirst ? 'ROLE_FILTERS_CREATED' : 'ROLE_FILTERS_UPDATED',
      role_id: roleId,
      message: `${isFirst ? 'Created' : 'Updated'} search filters for role`,
    });

    return filter;
  }

  @Post('/:roleId/fixed-search')
  async fixedSearch(
    @Param('roleId') roleId: string,
    @Body() body: RunSearchDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = requireOrgId(auth);
    const role = await this.rolesService.getRole(roleId, orgId, auth.userId);
    const userName = await this.resolveUserName(auth.userId);
    const results = await this.searchService.search(
      roleId,
      role,
      auth.userId,
      userName,
    );

    void this.logsService.log({
      organization_id: orgId,
      user_id: auth.userId,
      type: 'ROLE_SEARCH',
      role_id: roleId,
      tokens_used: this.sumTokensUsed(results),
      message: `Ran search for role "${role.name}", found ${results.length} candidate(s)`,
    });

    return results;
  }

  @Sse('/:roleId/search')
  search(
    @Param('roleId') roleId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Observable<MessageEvent> {
    const orgId = requireOrgId(auth);

    return from(
      Promise.all([
        this.rolesService.getRole(roleId, orgId, auth.userId),
        this.resolveUserName(auth.userId),
      ]),
    ).pipe(
      switchMap(([role, userName]) =>
        this.searchService
          .streamSearch(roleId, auth.userId, userName, role.name)
          .pipe(
            tap((event) => {
              if (event.type === 'done') {
                const results = (event.data as { result: role_result[] })
                  .result;
                void this.logsService.log({
                  organization_id: orgId,
                  user_id: auth.userId,
                  type: 'ROLE_SEARCH',
                  role_id: roleId,
                  tokens_used: this.sumTokensUsed(results),
                  message: `Ran search for role "${role.name}", found ${results.length} candidate(s)`,
                });
              }
            }),
          ),
      ),
    );
  }

  @Get('/:roleId/result/:resultId')
  @Serialize(RoleResultSummaryDto)
  async getRoleResult(
    @Param('roleId') roleId: string,
    @Param('resultId') resultId: string,
    @CurrentAuth() auth: ClerkAuthContext,
    @Query('refresh') refresh?: string,
  ) {
    const orgId = requireOrgId(auth);
    // check if the user can access the role first
    await this.rolesService.getRole(roleId, orgId, auth.userId);
    const result = await this.rolesService.getRoleResult(resultId, orgId);

    const force = refresh === 'true';
    const candidate = result?.candidate;
    if (candidate && (!candidate.enriched_at || force)) {
      const previousEnrichedAt = candidate.enriched_at;
      try {
        const enrichedCandidate = await this.searchService.deepSearchCandidate(
          candidate.uid,
          roleId,
          force,
        );
        result.candidate = enrichedCandidate;

        // A real search only happened if enriched_at actually moved on —
        // deepSearchCandidate returns the candidate unchanged when it
        // short-circuits (no name to search on, or already enriched).
        if (enrichedCandidate.enriched_at !== previousEnrichedAt) {
          const name = [
            enrichedCandidate.first_name,
            enrichedCandidate.last_name,
          ]
            .filter(Boolean)
            .join(' ');
          void this.logsService.log({
            organization_id: orgId,
            user_id: auth.userId,
            type: 'CANDIDATE_DEEP_SEARCH',
            role_id: roleId,
            role_result_id: resultId,
            message: `Deep search for candidate "${name || enrichedCandidate.uid}"`,
          });
        }
      } catch (error) {
        this.logger.warn(
          `Deep candidate search failed for candidate=${candidate.uid}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return result;
  }

  private sumTokensUsed(results: role_result[]): number {
    return results.reduce((sum, result) => sum + (result.tokens_used ?? 0), 0);
  }

  // Never throws — recording who ran a search is a nice-to-have, not
  // something that should block the search itself if Clerk's API is slow
  // or unreachable. Falls back from full name to username to the raw id.
  private async resolveUserName(userId: string): Promise<string> {
    try {
      const user = await this.clerkService.getUser(userId);
      const fullName = [user.firstName, user.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      return fullName || user.username || userId;
    } catch {
      return userId;
    }
  }

  @Post('/:roleId/result/:resultId/shortlist')
  async shortlistCandidate(
    @Param('roleId') roleId: string,
    @Param('resultId') resultId: string,
    @CurrentAuth() auth: ClerkAuthContext,
    @Body() body: { shortlist: boolean },
  ) {
    const orgId = requireOrgId(auth);
    // check if the user can access the role first
    await this.rolesService.getRole(roleId, orgId, auth.userId);
    const result = await this.rolesService.shortlistCandidate(
      resultId,
      body.shortlist,
      orgId,
    );
    return result;
  }
}
