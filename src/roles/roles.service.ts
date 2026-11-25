import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import {
  CreateRoleDto,
  RoleFilterResponseDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { plainToInstance } from 'class-transformer';
import { toSearchRuns, type SearchRun } from './search/search-history';
import {
  ChildFilterItemDto,
  FilterItemDto,
  RoleFilterDto,
} from './dto/role_filter.dto';
import { WorkTypeChild, withWorkTypeChildren } from './search/work-types';
import {
  Prisma,
  role_filters,
  role_result,
  roles,
} from '../generated/prisma/client';
import { RoleFilterPriority } from '../generated/prisma/enums';
import { ReasoningService } from '../services/reasoning/reasoning.service';
import {
  collectExpansionSeeds,
  GeneratedExpansions,
  hasSeeds,
  mergeExpansions,
  applyExpansionOverrides,
  parseCriterionExpansions,
  seedsMissingFrom,
} from './search/criterion-expansions';

const ROLE_WITH_DETAILS_INCLUDE = {
  project: {
    select: {
      name: true,
    },
  },
  role_filters: {
    where: {
      archived: false,
    },
    include: {
      role_filter_items: {
        include: {
          children: true,
        },
      },
    },
  },
  role_result: {
    where: {
      role_filter: {
        archived: false,
      },
    },
    include: {
      candidate: true,
    },
  },
} satisfies Prisma.rolesInclude;

type RoleWithDetails = Prisma.rolesGetPayload<{
  include: typeof ROLE_WITH_DETAILS_INCLUDE;
}>;

// Location rows that say how they may be worked store it as a work_types
// child, with remote_work kept in sync for older readers.
function storedChildren(
  item: FilterItemDto,
): (ChildFilterItemDto | WorkTypeChild)[] {
  const children = item.children ?? [];
  if (item.category !== 'location' || !item.work_types) return children;
  return withWorkTypeChildren(children, item.work_types);
}

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly reasoningService: ReasoningService,
  ) {}

  async findAllForProject(
    projectId: string,
    orgId: string,
    userId: string,
  ): Promise<roles[]> {
    await this.projectsService.findOneForUser(projectId, orgId, userId);
    return this.prisma.roles.findMany({ where: { project_id: projectId } });
  }

  async findOne(
    id: string,
    orgId: string,
    userId: string,
  ): Promise<RoleWithDetails> {
    const role = await this.prisma.roles.findFirst({
      where: { uid: id },
      include: ROLE_WITH_DETAILS_INCLUDE,
    });

    if (!role) {
      throw new RequestException(
        'Role not found',
        HttpStatus.NOT_FOUND,
        'ROLE_NOT_FOUND',
      );
    }

    await this.projectsService.findOneForUser(role.project_id, orgId, userId);
    return role;
  }

  async getRole(id: string, orgId: string, userId: string): Promise<roles> {
    const role = await this.findRoleOrThrow(id);
    await this.projectsService.findOneForUser(role.project_id, orgId, userId);
    return role;
  }

  async create(
    dto: CreateRoleDto,
    userId: string,
    orgId: string,
  ): Promise<roles> {
    await this.projectsService.findOneForUser(dto.project_id, orgId, userId);
    return this.prisma.roles.create({
      data: {
        project_id: dto.project_id,
        name: dto.name,
        description: dto.description,
        created_by: userId,
      },
    });
  }

  // Returns whether this is the role's first-ever filter set alongside the
  // created row — the archiving updateMany's `count` tells us that for
  // free, so callers (the controller, for audit logging) don't need a
  // separate existence check.
  async createFilter(
    roleId: string,
    dto: RoleFilterDto,
    orgId: string,
    userId: string,
  ): Promise<{
    filter: role_filters & {
      role_filter_items: (Prisma.role_filter_itemGetPayload<object> & {
        children: Prisma.role_filter_childGetPayload<object>[];
      })[];
    };
    isFirst: boolean;
  }> {
    const role = await this.getRole(roleId, orgId, userId);

    // Search-term expansion (an AI call) finishes before anything is
    // archived, so a slow or failed call can't leave the role without an
    // active filter set.
    const previous = await this.prisma.role_filters.findFirst({
      where: { role_id: roleId, archived: false },
      select: { metadata: true },
    });
    const metadata = await this.buildFilterMetadata(
      roleId,
      dto,
      role.name,
      previous?.metadata,
    );

    // Archive the previous filter set to mark it as superseded, so we can
    // keep a history of filter sets for the role.
    const { count } = await this.prisma.role_filters.updateMany({
      where: { role_id: roleId, archived: false },
      data: { archived: true, archived_at: new Date() },
    });

    const filter = await this.prisma.role_filters.create({
      data: {
        role_id: roleId,
        metadata,
        role_filter_items: {
          create: dto.filters.map((item) => ({
            category: item.category,
            value: item.value,
            list_value: item.list_value,
            priority: item.priority.toUpperCase() as RoleFilterPriority,
            non_negotiable: item.non_negotiable ?? false,
            children: {
              create: storedChildren(item).map((child) => ({
                title: child.title,
                value: child.value,
                list_value: child.list_value,
                boolean: child.boolean_value,
              })),
            },
          })),
        },
      },
      include: { role_filter_items: { include: { children: true } } },
    });

    return { filter, isFirst: count === 0 };
  }

  // Reuses the previous filter set's saved OR groups for unchanged titles and
  // skills, and asks Gemini (one call) only for new ones — an unchanged save
  // makes no AI call and stores identical metadata. If Gemini fails, new
  // terms just stay literal in the query; the save still goes through.
  private async buildFilterMetadata(
    roleId: string,
    dto: RoleFilterDto,
    roleName: string,
    previousMetadata: unknown,
  ): Promise<Prisma.InputJsonObject> {
    const seeds = collectExpansionSeeds(dto.filters, roleName);
    // Recruiter edits win over the saved groups and are never regenerated.
    const previous = applyExpansionOverrides({
      seeds,
      previous: parseCriterionExpansions(previousMetadata),
      overrides: dto.criterion_expansions,
    });
    const missing = seedsMissingFrom(previous, seeds);

    let generated: GeneratedExpansions | null = null;
    if (hasSeeds(missing)) {
      try {
        const ai = await this.reasoningService.forRole(roleId);
        const result = await ai.provider.expandSearchTerms(
          { seeds: missing, roleName },
          { model: ai.model },
        );
        generated = {
          byCategory: result.byCategory,
          model: result.model,
          generatedAt: new Date().toISOString(),
        };
      } catch (error) {
        // Error name only: AI SDK messages can echo request/response content.
        this.logger.warn(
          `Search term expansion failed for role=${roleId} (${error instanceof Error ? error.name : 'unknown error'}); saving literal terms`,
        );
      }
    }

    const criterionExpansions = mergeExpansions({ seeds, previous, generated });
    return criterionExpansions ? { criterionExpansions } : {};
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    userId: string,
    orgId: string,
  ): Promise<roles> {
    const role = await this.findRoleOrThrow(id);
    await this.requireProjectOwner(role.project_id, userId, orgId, 'update');

    // Only descriptive fields: filters and results stay as they are.
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    for (const key of [
      'description',
      'location',
      'seniority',
      'hiring_manager',
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key] || null;
    }

    return this.prisma.roles.update({ where: { uid: id }, data });
  }

  async remove(id: string, userId: string, orgId: string): Promise<roles> {
    const role = await this.findRoleOrThrow(id);
    await this.requireProjectOwner(role.project_id, userId, orgId, 'delete');

    await this.prisma.roles.delete({ where: { uid: id } });
    return role;
  }

  // Search history: one role's runs, or every run in projects the caller
  // can see across the org. Not-suitable results don't count.
  async searchHistory(
    orgId: string,
    userId: string,
    roleId?: string,
  ): Promise<(SearchRun & { filters: RoleFilterResponseDto })[]> {
    const sets = await this.prisma.role_filters.findMany({
      where: {
        search_run_date: { not: null },
        ...(roleId ? { role_id: roleId } : {}),
        role: {
          project: {
            organization_id: orgId,
            ...this.projectsService.visibleToUser(userId),
          },
        },
      },
      orderBy: { search_run_date: 'desc' },
      take: 200,
      select: {
        uid: true,
        role_id: true,
        archived: true,
        search_run_date: true,
        search_run_by: true,
        search_run_by_id: true,
        metadata: true,
        role: {
          select: {
            name: true,
            project_id: true,
            project: { select: { name: true } },
          },
        },
        created: true,
        updated: true,
        role_filter_items: { include: { children: true } },
      },
    });
    const results = await this.prisma.role_result.findMany({
      where: {
        filter_id: { in: sets.map((s) => s.uid) },
        OR: [{ not_suitable: false }, { not_suitable: null }],
      },
      select: { filter_id: true, candidate_uid: true, score: true },
    });
    // Each run carries its filter snapshot, shaped like the role's own
    // filters, so the app can show it, compare it and restore it.
    const byId = new Map(sets.map((s) => [s.uid, s]));
    return toSearchRuns(sets, results).map((run) => ({
      ...run,
      filters: plainToInstance(RoleFilterResponseDto, byId.get(run.id), {
        excludeExtraneousValues: true,
      }),
    }));
  }

  // Callers check access to the role first. `runId` (a filter set from
  // search history) lists that run's results instead of the current one's.
  async listResults(roleId: string, runId?: string) {
    return this.prisma.role_result.findMany({
      where: {
        role_id: roleId,
        role_filter: runId ? { uid: runId } : { archived: false },
      },
      include: { candidate: { include: { sources: true } } },
      orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { created: 'asc' }],
    });
  }

  async getRoleResult(
    resultId: string,
    organization_id: string,
    roleId: string,
  ) {
    const result = await this.prisma.role_result.findFirst({
      where: {
        uid: resultId,
        role_id: roleId,
        role: {
          project: {
            organization_id: organization_id,
          },
        },
      },
      include: {
        candidate: {
          include: {
            experience: true,
            education: true,
            sources: true,
          },
        },
        score_breakdown: true,
      },
    });

    if (!result) {
      throw new RequestException(
        'Role result not found',
        HttpStatus.NOT_FOUND,
        'ROLE_RESULT_NOT_FOUND',
      );
    }

    return result;
  }

  private async findRoleOrThrow(id: string): Promise<roles> {
    const role = await this.prisma.roles.findFirst({
      where: { uid: id },
    });

    if (!role) {
      throw new RequestException(
        'Role not found',
        HttpStatus.NOT_FOUND,
        'ROLE_NOT_FOUND',
      );
    }

    return role;
  }

  private async requireProjectOwner(
    projectId: string,
    userId: string,
    orgId: string,
    action: 'update' | 'delete',
  ): Promise<void> {
    const project = await this.projectsService.findOneForUser(
      projectId,
      orgId,
      userId,
    );

    if (project.user_id !== userId) {
      throw new RequestException(
        `Only the project owner can ${action} this role`,
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
      );
    }
  }

  async shortlistCandidate(
    resultId: string,
    shortlist: boolean,
    orgId: string,
  ) {
    // Without this check, any authenticated caller could shortlist/
    // unshortlist any role_result in the database just by knowing its uid —
    // the plain `where: { uid: resultId }` update below has no awareness
    // of organization at all. Mirrors getRoleResult's scoping.
    const existing = await this.prisma.role_result.findFirst({
      where: {
        uid: resultId,
        role: { project: { organization_id: orgId } },
      },
    });
    if (!existing) {
      throw new RequestException(
        'Role result not found',
        HttpStatus.NOT_FOUND,
        'ROLE_RESULT_NOT_FOUND',
      );
    }

    const response = await this.prisma.role_result.update({
      where: {
        uid: resultId,
      },
      data: {
        shortlist: shortlist,
      },
    });
    await this.prisma.organization_log.create({
      data: {
        type: shortlist ? 'CANDIDATE_SHORTLISTED' : 'CANDIDATE_UNSHORTLISTED',
        message: `Candidate ${shortlist ? 'shortlisted' : 'unshortlisted'} for role result ${resultId}`,
        role_result_id: resultId,
        organization_id: orgId,
      },
    });
    return response;
  }

  // The result card's "Not suitable" (and its undo). Scoped to the role and
  // the caller's org like the reads; the date says when it was last marked.
  // Marking also takes them off the shortlist (logged like an unshortlist);
  // restoring doesn't put them back on it.
  async markNotSuitable(
    resultId: string,
    roleId: string,
    notSuitable: boolean,
    orgId: string,
  ): Promise<role_result> {
    const existing = await this.prisma.role_result.findFirst({
      where: {
        uid: resultId,
        role_id: roleId,
        role: { project: { organization_id: orgId } },
      },
      select: { uid: true, shortlist: true },
    });
    if (!existing) {
      throw new RequestException(
        'Role result not found',
        HttpStatus.NOT_FOUND,
        'ROLE_RESULT_NOT_FOUND',
      );
    }

    const updated = await this.prisma.role_result.update({
      where: { uid: resultId },
      data: notSuitable
        ? {
            not_suitable: true,
            not_suitable_date: new Date(),
            shortlist: false,
          }
        : { not_suitable: false, not_suitable_date: null },
    });
    if (notSuitable && existing.shortlist) {
      await this.prisma.organization_log.create({
        data: {
          type: 'CANDIDATE_UNSHORTLISTED',
          message: `Candidate unshortlisted (marked not suitable) for role result ${resultId}`,
          role_result_id: resultId,
          organization_id: orgId,
        },
      });
    }
    return updated;
  }
}
