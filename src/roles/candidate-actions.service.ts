import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { AddToRolesDto } from './dto/candidate-actions.dto';
import { RolesService } from './roles.service';
import { traitsOf } from './search/lookalike';
import { SearchService } from './search/search.service';

export type ResultStatus =
  'REVIEWING' | 'SHORTLISTED' | 'NOT_SUITABLE' | 'SCORING';

type Metadata = { scoring?: 'pending' | 'failed'; addedFrom?: string };

// A result's status in its role, read from the flags it already has; a role
// added without a score yet shows Scoring until the AI pass lands.
export function statusOf(result: {
  shortlist: boolean | null;
  not_suitable: boolean | null;
  score: number | null;
  metadata: Prisma.JsonValue;
}): ResultStatus {
  if (result.not_suitable) return 'NOT_SUITABLE';
  if (result.shortlist) return 'SHORTLISTED';
  const meta = (result.metadata ?? {}) as Metadata;
  return result.score === null && meta.scoring === 'pending'
    ? 'SCORING'
    : 'REVIEWING';
}

@Injectable()
export class CandidateActionsService {
  private readonly logger = new Logger(CandidateActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly rolesService: RolesService,
    private readonly searchService: SearchService,
  ) {}

  private async resultCandidate(roleId: string, resultId: string) {
    const result = await this.prisma.role_result.findFirst({
      where: { uid: resultId, role_id: roleId },
      include: { candidate: true },
    });
    if (!result?.candidate) throw new NotFoundException('Result not found');
    return result.candidate;
  }

  // The Roles card: every role in the org this person is in, with score
  // and status.
  async rolesFor(
    roleId: string,
    resultId: string,
    orgId: string,
    userId: string,
  ) {
    const candidate = await this.resultCandidate(roleId, resultId);
    const results = await this.prisma.role_result.findMany({
      where: {
        candidate_uid: candidate.uid,
        role: {
          project: {
            organization_id: orgId,
            ...this.projectsService.visibleToUser(userId),
          },
        },
      },
      include: { role: { include: { project: true } } },
      orderBy: { created: 'asc' },
    });
    return results.map((result) => ({
      resultId: result.uid,
      roleId: result.role_id,
      roleName: result.role.name,
      projectId: result.role.project_id,
      projectName: result.role.project.name,
      score: result.score,
      status: statusOf(result),
    }));
  }

  async traits(roleId: string, resultId: string) {
    return traitsOf(await this.resultCandidate(roleId, resultId));
  }

  // Adds the candidate to each picked role's active filter set; they stay in
  // the role they came from. Roles they're already in, and roles with no
  // filters yet, are skipped and reported.
  async addToRoles(
    fromRoleId: string,
    dto: AddToRolesDto,
    orgId: string,
    userId: string,
  ) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { uid: dto.candidateUid },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    const added: string[] = [];
    const skipped: {
      roleId: string;
      reason: 'ALREADY_ADDED' | 'NO_FILTERS';
    }[] = [];
    for (const roleId of new Set(dto.roleIds)) {
      await this.rolesService.getRole(roleId, orgId, userId);
      const [filter, existing] = await Promise.all([
        this.prisma.role_filters.findFirst({
          where: { role_id: roleId, archived: false },
          select: { uid: true },
        }),
        this.prisma.role_result.findFirst({
          where: { role_id: roleId, candidate_uid: candidate.uid },
          select: { uid: true },
        }),
      ]);
      if (existing) {
        skipped.push({ roleId, reason: 'ALREADY_ADDED' });
        continue;
      }
      if (!filter) {
        skipped.push({ roleId, reason: 'NO_FILTERS' });
        continue;
      }
      const metadata: Metadata = {
        addedFrom: fromRoleId,
        ...(dto.score ? { scoring: 'pending' as const } : {}),
      };
      const result = await this.prisma.role_result.create({
        data: {
          role_id: roleId,
          candidate_uid: candidate.uid,
          filter_id: filter.uid,
          shortlist: dto.shortlist,
          shortlist_date: dto.shortlist ? new Date() : null,
          rated_by: userId,
          sources: ['Database'],
          metadata,
        },
      });
      added.push(roleId);
      // Scoring takes ~20s, so it runs after the response; the Roles card
      // shows Scoring until it lands.
      if (dto.score)
        void this.score(roleId, candidate.uid, result.uid).catch((error) =>
          this.logger.warn(
            `Marking ${result.uid} unscored failed: ${String(error)}`,
          ),
        );
    }
    return { added, skipped };
  }

  private async score(roleId: string, candidateUid: string, resultId: string) {
    try {
      const scored = await this.searchService.scoreCandidateForRole(
        roleId,
        candidateUid,
      );
      if (scored) return;
    } catch (error) {
      this.logger.warn(
        `Scoring ${resultId} for role ${roleId} failed: ${String(error)}`,
      );
    }
    const result = await this.prisma.role_result.findUnique({
      where: { uid: resultId },
      select: { metadata: true },
    });
    await this.prisma.role_result.update({
      where: { uid: resultId },
      data: {
        metadata: {
          ...((result?.metadata ?? {}) as Metadata),
          scoring: 'failed',
        },
      },
    });
  }
}
