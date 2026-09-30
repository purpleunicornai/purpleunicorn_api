import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import { CreateProjectDto, UpdateProjectDto } from '../common/dto/project.dto';
import { ProjectVisibility } from '../generated/prisma/enums';
import { Prisma, projects } from '../generated/prisma/client';

const PROJECT_WITH_ROLES_INCLUDE = {
  roles: {
    include: {
      _count: {
        select: {
          role_result: {
            where: {
              role_filter: {
                archived: false,
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.projectsInclude;

type ProjectWithRoles = Prisma.projectsGetPayload<{
  include: typeof PROJECT_WITH_ROLES_INCLUDE;
}>;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForOrg(orgId: string, userId: string): Promise<projects[]> {
    return this.prisma.projects.findMany({
      where: {
        organization_id: orgId,
        ...this.visibleToUser(userId),
      },
    });
  }

  async findOneForUser(
    id: string,
    orgId: string,
    userId: string,
  ): Promise<ProjectWithRoles> {
    const project = await this.prisma.projects.findFirst({
      where: {
        uid: id,
        organization_id: orgId,
        ...this.visibleToUser(userId),
      },
      include: PROJECT_WITH_ROLES_INCLUDE,
    });

    if (!project) {
      throw new RequestException(
        'Project not found',
        HttpStatus.NOT_FOUND,
        'PROJECT_NOT_FOUND',
      );
    }

    return project;
  }

  async create(
    dto: CreateProjectDto,
    userId: string,
    orgId: string,
  ): Promise<projects> {
    return this.prisma.projects.create({
      data: {
        name: dto.name,
        description: dto.description,
        visibility: dto.visibility ?? ProjectVisibility.USER,
        users: dto.users ?? [],
        user_id: userId,
        organization_id: orgId,
      },
    });
  }

  // Returns the added/removed user ids alongside the updated project —
  // computed for free against the project already loaded for the ownership
  // check — so callers (the controller, for audit logging) don't need a
  // separate "what changed" fetch.
  async update(
    id: string,
    dto: UpdateProjectDto,
    userId: string,
    orgId: string,
  ): Promise<{
    project: projects;
    addedUsers: string[];
    removedUsers: string[];
  }> {
    const existing = await this.findOneForUser(id, orgId, userId);
    this.requireOwner(existing, userId, 'update');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.visibility !== undefined) data.visibility = dto.visibility;
    if (dto.users !== undefined) data.users = dto.users;

    const project = await this.prisma.projects.update({
      where: { uid: id },
      data,
    });

    let addedUsers: string[] = [];
    let removedUsers: string[] = [];
    if (dto.users !== undefined) {
      const previousUsers = new Set(existing.users);
      const nextUsers = new Set(dto.users);
      addedUsers = dto.users.filter((userId) => !previousUsers.has(userId));
      removedUsers = existing.users.filter((userId) => !nextUsers.has(userId));
    }

    return { project, addedUsers, removedUsers };
  }

  async remove(id: string, userId: string, orgId: string): Promise<projects> {
    const project = await this.findOneForUser(id, orgId, userId);
    this.requireOwner(project, userId, 'delete');

    await this.prisma.projects.delete({ where: { uid: id } });
    return project;
  }

  private visibleToUser(userId: string) {
    return {
      OR: [
        { user_id: userId },
        { visibility: ProjectVisibility.ORGANIZATION },
        { visibility: ProjectVisibility.INVITE_ONLY, users: { has: userId } },
      ],
    };
  }

  private requireOwner(
    project: projects,
    userId: string,
    action: 'update' | 'delete',
  ): void {
    if (project.user_id !== userId) {
      throw new RequestException(
        `Only the project owner can ${action} this project`,
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
      );
    }
  }
}
