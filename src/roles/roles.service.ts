import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { RoleFilterDto } from './dto/role_filter.dto';
import { Prisma, role_filters, roles } from '../generated/prisma/client';

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
      children: true,
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

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
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

  // Returns whether this is the role's first-ever filter alongside the
  // created rows — the archiving updateMany's `count` tells us that for
  // free, so callers (the controller, for audit logging) don't need a
  // separate existence check.
  async createFilter(
    roleId: string,
    dto: RoleFilterDto,
    orgId: string,
    userId: string,
  ): Promise<{
    filters: (role_filters & {
      children: Prisma.role_filter_childGetPayload<object>[];
    })[];
    isFirst: boolean;
  }> {
    await this.getRole(roleId, orgId, userId);
    throw new Error('not yet implemented — see Task 4');
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    userId: string,
    orgId: string,
  ): Promise<roles> {
    const role = await this.findRoleOrThrow(id);
    await this.requireProjectOwner(role.project_id, userId, orgId, 'update');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;

    return this.prisma.roles.update({ where: { uid: id }, data });
  }

  async remove(id: string, userId: string, orgId: string): Promise<roles> {
    const role = await this.findRoleOrThrow(id);
    await this.requireProjectOwner(role.project_id, userId, orgId, 'delete');

    await this.prisma.roles.delete({ where: { uid: id } });
    return role;
  }

  async getRoleResult(resultId: string, organization_id: string) {
    const result = await this.prisma.role_result.findFirst({
      where: {
        uid: resultId,
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
}
