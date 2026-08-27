import { ProjectsService } from './projects.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import { ProjectVisibility } from '../generated/prisma/enums';

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

function buildPrisma() {
  return {
    projects: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function buildProject(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'project-1',
    created: new Date('2026-08-23T00:00:00.000Z'),
    updated: new Date('2026-08-23T00:00:00.000Z'),
    user_id: 'user-1',
    organization_id: 'org-1',
    name: 'Sanlam',
    description: null,
    visibility: ProjectVisibility.USER,
    users: [],
    ...overrides,
  };
}

describe('ProjectsService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: ProjectsService;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new ProjectsService(prisma as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllForOrg', () => {
    it('scopes the query to the organization and the visibility rules for the user', async () => {
      const projects = [buildProject()];
      prisma.projects.findMany.mockResolvedValue(projects);

      const result = await service.findAllForOrg('org-1', 'user-1');

      expect(prisma.projects.findMany).toHaveBeenCalledWith({
        where: {
          organization_id: 'org-1',
          OR: [
            { user_id: 'user-1' },
            { visibility: ProjectVisibility.ORGANIZATION },
            {
              visibility: ProjectVisibility.INVITE_ONLY,
              users: { has: 'user-1' },
            },
          ],
        },
      });
      expect(result).toBe(projects);
    });
  });

  describe('findOneForUser', () => {
    it('returns the project when it is found and visible to the user', async () => {
      const project = buildProject();
      prisma.projects.findFirst.mockResolvedValue(project);

      const result = await service.findOneForUser(
        'project-1',
        'org-1',
        'user-1',
      );

      expect(prisma.projects.findFirst).toHaveBeenCalledWith({
        where: {
          uid: 'project-1',
          organization_id: 'org-1',
          OR: [
            { user_id: 'user-1' },
            { visibility: ProjectVisibility.ORGANIZATION },
            {
              visibility: ProjectVisibility.INVITE_ONLY,
              users: { has: 'user-1' },
            },
          ],
        },
      });
      expect(result).toBe(project);
    });

    it('throws a 404 RequestException when the project does not exist or is not visible', async () => {
      prisma.projects.findFirst.mockResolvedValue(null);

      const error = await captureError(
        service.findOneForUser('project-1', 'org-1', 'user-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('Project not found');
      expect(error.getStatus()).toBe(404);
    });
  });

  describe('create', () => {
    it('creates a project owned by the caller in their organization', async () => {
      const created = buildProject();
      prisma.projects.create.mockResolvedValue(created);

      const result = await service.create(
        { name: 'Sanlam' },
        'user-1',
        'org-1',
      );

      expect(prisma.projects.create).toHaveBeenCalledWith({
        data: {
          name: 'Sanlam',
          description: undefined,
          visibility: ProjectVisibility.USER,
          users: [],
          user_id: 'user-1',
          organization_id: 'org-1',
        },
      });
      expect(result).toBe(created);
    });

    it('uses the provided visibility and users when given', async () => {
      prisma.projects.create.mockResolvedValue(buildProject());

      await service.create(
        {
          name: 'Sanlam',
          description: 'Insurance project',
          visibility: ProjectVisibility.INVITE_ONLY,
          users: ['user-2'],
        },
        'user-1',
        'org-1',
      );

      expect(prisma.projects.create).toHaveBeenCalledWith({
        data: {
          name: 'Sanlam',
          description: 'Insurance project',
          visibility: ProjectVisibility.INVITE_ONLY,
          users: ['user-2'],
          user_id: 'user-1',
          organization_id: 'org-1',
        },
      });
    });
  });

  describe('update', () => {
    it('updates only the provided fields when the caller owns the project', async () => {
      prisma.projects.findFirst.mockResolvedValue(
        buildProject({ user_id: 'user-1' }),
      );
      const updated = buildProject({ name: 'Sanlam Renamed' });
      prisma.projects.update.mockResolvedValue(updated);

      const result = await service.update(
        'project-1',
        { name: 'Sanlam Renamed' },
        'user-1',
        'org-1',
      );

      expect(prisma.projects.update).toHaveBeenCalledWith({
        where: { uid: 'project-1' },
        data: { name: 'Sanlam Renamed' },
      });
      expect(result).toBe(updated);
    });

    it('throws a 403 RequestException when the caller does not own the project', async () => {
      prisma.projects.findFirst.mockResolvedValue(
        buildProject({ user_id: 'someone-else' }),
      );

      const error = await captureError(
        service.update('project-1', { name: 'x' }, 'user-1', 'org-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe(
        'Only the project owner can update this project',
      );
      expect(error.getStatus()).toBe(403);
      expect(prisma.projects.update).not.toHaveBeenCalled();
    });

    it('throws a 404 RequestException when the project is not visible to the caller', async () => {
      prisma.projects.findFirst.mockResolvedValue(null);

      const error = await captureError(
        service.update('project-1', { name: 'x' }, 'user-1', 'org-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('Project not found');
      expect(error.getStatus()).toBe(404);
    });
  });

  describe('remove', () => {
    it('deletes the project when the caller owns it', async () => {
      prisma.projects.findFirst.mockResolvedValue(
        buildProject({ user_id: 'user-1' }),
      );

      await service.remove('project-1', 'user-1', 'org-1');

      expect(prisma.projects.delete).toHaveBeenCalledWith({
        where: { uid: 'project-1' },
      });
    });

    it('throws a 403 RequestException when the caller does not own the project', async () => {
      prisma.projects.findFirst.mockResolvedValue(
        buildProject({ user_id: 'someone-else' }),
      );

      const error = await captureError(
        service.remove('project-1', 'user-1', 'org-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe(
        'Only the project owner can delete this project',
      );
      expect(error.getStatus()).toBe(403);
      expect(prisma.projects.delete).not.toHaveBeenCalled();
    });
  });
});
