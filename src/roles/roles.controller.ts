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
import { JobSpecImportService } from './job-spec-import.service';
import { RoleFilterDto } from './dto/role_filter.dto';
import {
  CreateRoleDto,
  RoleDto,
  RoleFilterResponseDto,
  RoleResultSummaryDto,
  RunSearchDto,
  UpdateRoleDto,
} from './dto/role.dto';
import {
  ImportJobSpecDto,
  JobSpecImportResponseDto,
} from './dto/job-spec-import.dto';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { ClerkAuthContext } from '../auth/auth.types';
import { RequestException } from '../common/exception/core/ExceptionBase';
import { Serialize } from '../common/interceptors/serialize.interceptor';
import { LogsService } from '../common/logs/logs.service';
import { ClerkService } from '../common/clerk/clerk.service';
import { role_result } from '../generated/prisma/client';
import { requireOrgId } from '../common/utils/organizationUtils';
import { resolveUserName } from './resolve-user-name';
import {
  PaidResearchService,
  type ResearchQuote,
} from './research/paid-research.service';

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
    private readonly jobSpecImportService: JobSpecImportService,
    private readonly paidResearch: PaidResearchService,
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
  @Serialize(RoleFilterResponseDto)
  async createFilter(
    @Param('roleId') roleId: string,
    @Body() body: RoleFilterDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
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

  // Every result for the role's active filter set, best match first.
  @Get('/:roleId/results')
  @Serialize(RoleResultSummaryDto)
  async listResults(
    @Param('roleId') roleId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = requireOrgId(auth);
    await this.rolesService.getRole(roleId, orgId, auth.userId);
    return this.rolesService.listResults(roleId);
  }

  // A plain read: never researches. Deep research spends Gemini credits, so
  // it only runs from the explicit POST below.
  @Get('/:roleId/result/:resultId')
  @Serialize(RoleResultSummaryDto)
  async getRoleResult(
    @Param('roleId') roleId: string,
    @Param('resultId') resultId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = requireOrgId(auth);
    await this.rolesService.getRole(roleId, orgId, auth.userId);
    return this.rolesService.getRoleResult(resultId, orgId, roleId);
  }

  // What researching this result would cost the org (one price per run,
  // RocketReach included) and whether its balance covers it. The UI shows this before the user
  // confirms; nothing is charged.
  @Get('/:roleId/result/:resultId/research/quote')
  async researchQuote(
    @Param('roleId') roleId: string,
    @Param('resultId') resultId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ): Promise<ResearchQuote> {
    const orgId = requireOrgId(auth);
    await this.rolesService.getRole(roleId, orgId, auth.userId);
    const { candidate } = await this.rolesService.getRoleResult(
      resultId,
      orgId,
      roleId,
    );
    return this.paidResearch.quote(orgId, candidate);
  }

  // Deep research for one candidate, run when a user asks for it (and again
  // on re-run), paid in credits: 402 INSUFFICIENT_CREDITS when the balance
  // is short, refunded in full when it fails or when RocketReach finds
  // nothing. Returns the result re-read, since
  // research rewrites both the candidate and the role_result's summary,
  // score and findings.
  @Post('/:roleId/result/:resultId/research')
  @Serialize(RoleResultSummaryDto)
  async researchCandidate(
    @Param('roleId') roleId: string,
    @Param('resultId') resultId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = requireOrgId(auth);
    await this.rolesService.getRole(roleId, orgId, auth.userId);
    const { candidate } = await this.rolesService.getRoleResult(
      resultId,
      orgId,
      roleId,
    );

    let researched: Awaited<ReturnType<PaidResearchService['research']>>;
    try {
      researched = await this.paidResearch.research({
        organizationId: orgId,
        userId: auth.userId,
        roleId,
        roleResultId: resultId,
        candidate,
      });
    } catch (error) {
      if (error instanceof RequestException) throw error;
      this.logger.warn(
        `Deep research failed for result=${resultId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new RequestException(
        'Deep research failed. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
        'DEEP_RESEARCH_FAILED',
      );
    }

    const name = [researched.first_name, researched.last_name]
      .filter(Boolean)
      .join(' ');
    void this.logsService.log({
      organization_id: orgId,
      user_id: auth.userId,
      type: 'CANDIDATE_DEEP_SEARCH',
      role_id: roleId,
      role_result_id: resultId,
      message: `Deep search for candidate "${name || researched.uid}"`,
    });

    return this.rolesService.getRoleResult(resultId, orgId, roleId);
  }

  private sumTokensUsed(results: role_result[]): number {
    return results.reduce((sum, result) => sum + (result.tokens_used ?? 0), 0);
  }

  private resolveUserName(userId: string): Promise<string> {
    return resolveUserName(this.clerkService, userId);
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

  @Post('/:roleId/job-spec-import')
  @Serialize(JobSpecImportResponseDto)
  async importJobSpec(
    @Param('roleId') roleId: string,
    @Body() body: ImportJobSpecDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = requireOrgId(auth);
    // check if the user can access the role first
    await this.rolesService.getRole(roleId, orgId, auth.userId);
    const userName = await this.resolveUserName(auth.userId);
    return this.jobSpecImportService.importJobSpec(
      roleId,
      body,
      auth.userId,
      userName,
    );
  }
}
