import { RolesService } from './roles.service';
import { ProjectsService } from '../projects/projects.service';
import { PrismaService } from '../common/database/prisma.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import { RoleFilterDto } from './dto/role_filter.dto';

async function captureError(
  promise: Promise<unknown>,
): Promise<RequestException> {
  try {
    await promise;
  } catch (error) {
    return error as RequestException;
  }
  throw new Error('Expected promise to reject');
}

function buildProject(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'project-1',
    user_id: 'user-1',
    organization_id: 'org-1',
    ...overrides,
  };
}

function buildRole(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'role-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    project_id: 'project-1',
    name: 'Fullstack Developer',
    description: null,
    summary: null,
    created_by: 'user-1',
    ...overrides,
  };
}

function buildPrisma() {
  return {
    roles: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    role_filters: {
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    role_filter_child: {
      createMany: jest.fn(),
    },
    role_result: {
      findFirst: jest.fn(),
    },
  };
}

function buildRoleFilterDto(
  overrides: Partial<RoleFilterDto> = {},
): RoleFilterDto {
  return {
    filters: [
      {
        category: 'skills',
        list_value: ['React', 'Node.js'],
        priority: 'essential',
      },
    ],
    ...overrides,
  };
}

function buildProjectsService(): jest.Mocked<ProjectsService> {
  return {
    findOneForUser: jest.fn().mockResolvedValue(buildProject()),
  } as unknown as jest.Mocked<ProjectsService>;
}

describe('RolesService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let projectsService: jest.Mocked<ProjectsService>;
  let service: RolesService;

  beforeEach(() => {
    prisma = buildPrisma();
    projectsService = buildProjectsService();
    service = new RolesService(
      prisma as unknown as PrismaService,
      projectsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllForProject', () => {
    it('checks the project is visible to the caller, then lists its roles', async () => {
      const roles = [buildRole()];
      prisma.roles.findMany.mockResolvedValue(roles);

      const result = await service.findAllForProject(
        'project-1',
        'org-1',
        'user-1',
      );

      expect(projectsService.findOneForUser).toHaveBeenCalledWith(
        'project-1',
        'org-1',
        'user-1',
      );
      expect(prisma.roles.findMany).toHaveBeenCalledWith({
        where: { project_id: 'project-1' },
      });
      expect(result).toBe(roles);
    });

    it('propagates the 404 when the project is not visible to the caller', async () => {
      projectsService.findOneForUser.mockRejectedValue(
        new RequestException('Project not found', 404, 'PROJECT_NOT_FOUND'),
      );

      const error = await captureError(
        service.findAllForProject('project-1', 'org-1', 'user-1'),
      );

      expect(error.getStatus()).toBe(404);
      expect(prisma.roles.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the role with its latest filter and results when visible to the caller', async () => {
      const role = buildRole();
      prisma.roles.findFirst.mockResolvedValue(role);

      const result = await service.findOne('role-1', 'org-1', 'user-1');

      expect(prisma.roles.findFirst).toHaveBeenCalledWith({
        where: { uid: 'role-1' },
        include: {
          project: { select: { name: true } },
          role_filters: {
            where: { archived: false },
            include: { children: true },
          },
          role_result: {
            where: { role_filter: { archived: false } },
            include: { candidate: true },
          },
        },
      });
      expect(projectsService.findOneForUser).toHaveBeenCalledWith(
        'project-1',
        'org-1',
        'user-1',
      );
      expect(result).toBe(role);
    });

    it('throws a 404 RequestException when the role does not exist', async () => {
      prisma.roles.findFirst.mockResolvedValue(null);

      const error = await captureError(
        service.findOne('role-1', 'org-1', 'user-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('Role not found');
      expect(error.getStatus()).toBe(404);
      expect(projectsService.findOneForUser).not.toHaveBeenCalled();
    });

    it('propagates the 404 when the parent project is not visible to the caller', async () => {
      prisma.roles.findFirst.mockResolvedValue(buildRole());
      projectsService.findOneForUser.mockRejectedValue(
        new RequestException('Project not found', 404, 'PROJECT_NOT_FOUND'),
      );

      const error = await captureError(
        service.findOne('role-1', 'org-1', 'user-1'),
      );

      expect(error.getStatus()).toBe(404);
    });
  });

  describe('getRole', () => {
    it('returns the role when its project is visible to the caller', async () => {
      const role = buildRole();
      prisma.roles.findFirst.mockResolvedValue(role);

      const result = await service.getRole('role-1', 'org-1', 'user-1');

      expect(projectsService.findOneForUser).toHaveBeenCalledWith(
        'project-1',
        'org-1',
        'user-1',
      );
      expect(result).toBe(role);
    });
  });

  describe('create', () => {
    it('checks the project is visible to the caller, then creates the role', async () => {
      const created = buildRole();
      prisma.roles.create.mockResolvedValue(created);

      const result = await service.create(
        { project_id: 'project-1', name: 'Fullstack Developer' },
        'user-1',
        'org-1',
      );

      expect(projectsService.findOneForUser).toHaveBeenCalledWith(
        'project-1',
        'org-1',
        'user-1',
      );
      expect(prisma.roles.create).toHaveBeenCalledWith({
        data: {
          project_id: 'project-1',
          name: 'Fullstack Developer',
          description: undefined,
          created_by: 'user-1',
        },
      });
      expect(result).toBe(created);
    });
  });

  describe('getRoleResult', () => {
    it("fetches a role_result scoped to the caller's organization, including its candidate and their experience/education/sources", async () => {
      const result = {
        uid: 'result-1',
        role_id: 'role-1',
        candidate: { uid: 'candidate-1' },
      };
      prisma.role_result.findFirst.mockResolvedValue(result);

      const found = await service.getRoleResult('result-1', 'org-1');

      expect(prisma.role_result.findFirst).toHaveBeenCalledWith({
        where: {
          uid: 'result-1',
          role: { project: { organization_id: 'org-1' } },
        },
        include: {
          candidate: {
            include: { experience: true, education: true, sources: true },
          },
          score_breakdown: true,
        },
      });
      expect(found).toBe(result);
    });

    it('throws a 404 RequestException when no matching role_result exists in the organization', async () => {
      prisma.role_result.findFirst.mockResolvedValue(null);

      const error = await captureError(
        service.getRoleResult('result-1', 'org-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('Role result not found');
      expect(error.getStatus()).toBe(404);
    });
  });

  describe('update', () => {
    it('updates only the provided fields when the caller owns the parent project', async () => {
      prisma.roles.findFirst.mockResolvedValue(buildRole());
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ user_id: 'user-1' }) as any,
      );
      const updated = buildRole({ name: 'Renamed' });
      prisma.roles.update.mockResolvedValue(updated);

      const result = await service.update(
        'role-1',
        { name: 'Renamed' },
        'user-1',
        'org-1',
      );

      expect(prisma.roles.update).toHaveBeenCalledWith({
        where: { uid: 'role-1' },
        data: { name: 'Renamed' },
      });
      expect(result).toBe(updated);
    });

    it('throws a 403 RequestException when the caller does not own the parent project', async () => {
      prisma.roles.findFirst.mockResolvedValue(buildRole());
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ user_id: 'someone-else' }) as any,
      );

      const error = await captureError(
        service.update('role-1', { name: 'x' }, 'user-1', 'org-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('Only the project owner can update this role');
      expect(error.getStatus()).toBe(403);
      expect(prisma.roles.update).not.toHaveBeenCalled();
    });

    it('throws a 404 RequestException when the role does not exist', async () => {
      prisma.roles.findFirst.mockResolvedValue(null);

      const error = await captureError(
        service.update('role-1', { name: 'x' }, 'user-1', 'org-1'),
      );

      expect(error.message).toBe('Role not found');
      expect(error.getStatus()).toBe(404);
    });
  });

  describe('remove', () => {
    it('deletes the role when the caller owns the parent project, and returns the deleted role', async () => {
      const role = buildRole();
      prisma.roles.findFirst.mockResolvedValue(role);
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ user_id: 'user-1' }) as any,
      );

      const result = await service.remove('role-1', 'user-1', 'org-1');

      expect(prisma.roles.delete).toHaveBeenCalledWith({
        where: { uid: 'role-1' },
      });
      expect(result).toBe(role);
    });

    it('throws a 403 RequestException when the caller does not own the parent project', async () => {
      prisma.roles.findFirst.mockResolvedValue(buildRole());
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ user_id: 'someone-else' }) as any,
      );

      const error = await captureError(
        service.remove('role-1', 'user-1', 'org-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('Only the project owner can delete this role');
      expect(error.getStatus()).toBe(403);
      expect(prisma.roles.delete).not.toHaveBeenCalled();
    });
  });
});
