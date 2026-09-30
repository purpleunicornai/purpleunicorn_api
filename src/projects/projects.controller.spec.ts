import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { LogsService } from '../common/logs/logs.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import type { ClerkAuthContext } from '../auth/auth.types';

function buildAuth(
  overrides: Partial<ClerkAuthContext> = {},
): ClerkAuthContext {
  return {
    userId: 'user-1',
    orgId: 'org-1',
    claims: {},
    ...overrides,
  };
}

function buildService(): jest.Mocked<ProjectsService> {
  return {
    findAllForOrg: jest.fn(),
    findOneForUser: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  } as unknown as jest.Mocked<ProjectsService>;
}

function buildLogsService(): jest.Mocked<LogsService> {
  return {
    log: jest.fn(),
  } as unknown as jest.Mocked<LogsService>;
}

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

describe('ProjectsController', () => {
  let service: jest.Mocked<ProjectsService>;
  let logsService: jest.Mocked<LogsService>;
  let controller: ProjectsController;

  beforeEach(() => {
    service = buildService();
    logsService = buildLogsService();
    controller = new ProjectsController(service, logsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it("lists projects for the caller's active organization", async () => {
      const projects = [{ uid: 'project-1' }];
      service.findAllForOrg.mockResolvedValue(projects as any);

      const result = await controller.findAll(buildAuth());

      expect(service.findAllForOrg).toHaveBeenCalledWith('org-1', 'user-1');
      expect(result).toBe(projects);
    });

    it('throws a 400 RequestException when the caller has no active organization', async () => {
      const error = await captureError(
        controller.findAll(buildAuth({ orgId: undefined })),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.getStatus()).toBe(400);
      expect(service.findAllForOrg).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('fetches a single project scoped to the org and user', async () => {
      const project = { uid: 'project-1' };
      service.findOneForUser.mockResolvedValue(project as any);

      const result = await controller.findOne('project-1', buildAuth());

      expect(service.findOneForUser).toHaveBeenCalledWith(
        'project-1',
        'org-1',
        'user-1',
      );
      expect(result).toBe(project);
    });
  });

  describe('create', () => {
    it('creates a project for the caller in their active organization', async () => {
      const created = { uid: 'project-1', name: 'Sanlam' };
      service.create.mockResolvedValue(created as any);
      const body = { name: 'Sanlam' };

      const result = await controller.create(body, buildAuth());

      expect(service.create).toHaveBeenCalledWith(body, 'user-1', 'org-1');
      expect(result).toBe(created);
    });

    it('logs a PROJECT_CREATED entry', async () => {
      const created = { uid: 'project-1', name: 'Sanlam' };
      service.create.mockResolvedValue(created as any);

      await controller.create({ name: 'Sanlam' }, buildAuth());

      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'PROJECT_CREATED',
        project_id: 'project-1',
        message: 'Created project "Sanlam"',
      });
    });
  });

  describe('update', () => {
    it('updates a project and returns just the project', async () => {
      const updated = { uid: 'project-1', name: 'Renamed' };
      service.update.mockResolvedValue({
        project: updated,
        addedUsers: [],
        removedUsers: [],
      } as any);
      const body = { name: 'Renamed' };

      const result = await controller.update('project-1', body, buildAuth());

      expect(service.update).toHaveBeenCalledWith(
        'project-1',
        body,
        'user-1',
        'org-1',
      );
      expect(result).toBe(updated);
    });

    it('logs a PROJECT_UPDATED entry when non-user fields are included', async () => {
      const updated = { uid: 'project-1', name: 'Renamed' };
      service.update.mockResolvedValue({
        project: updated,
        addedUsers: [],
        removedUsers: [],
      } as any);

      await controller.update('project-1', { name: 'Renamed' }, buildAuth());

      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'PROJECT_UPDATED',
        project_id: 'project-1',
        message: 'Updated project "Renamed"',
      });
    });

    it('logs PROJECT_USERS_ADDED and PROJECT_USERS_REMOVED when the users list changes', async () => {
      const updated = { uid: 'project-1', name: 'Sanlam' };
      service.update.mockResolvedValue({
        project: updated,
        addedUsers: ['user-4'],
        removedUsers: ['user-2'],
      } as any);

      await controller.update(
        'project-1',
        { users: ['user-3', 'user-4'] },
        buildAuth(),
      );

      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'PROJECT_USERS_ADDED',
        project_id: 'project-1',
        message: 'Added 1 user(s) to project "Sanlam"',
      });
      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'PROJECT_USERS_REMOVED',
        project_id: 'project-1',
        message: 'Removed 1 user(s) from project "Sanlam"',
      });
      // Only "users" was in the body, no other fields changed.
      expect(logsService.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PROJECT_UPDATED' }),
      );
    });

    it('does not log added/removed users when the diff is empty', async () => {
      const updated = { uid: 'project-1', name: 'Sanlam' };
      service.update.mockResolvedValue({
        project: updated,
        addedUsers: [],
        removedUsers: [],
      } as any);

      await controller.update('project-1', { users: [] }, buildAuth());

      expect(logsService.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PROJECT_USERS_ADDED' }),
      );
      expect(logsService.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PROJECT_USERS_REMOVED' }),
      );
    });
  });

  describe('remove', () => {
    it('deletes a project and returns a success acknowledgement', async () => {
      service.remove.mockResolvedValue({
        uid: 'project-1',
        name: 'Sanlam',
      } as any);

      const result = await controller.remove('project-1', buildAuth());

      expect(service.remove).toHaveBeenCalledWith(
        'project-1',
        'user-1',
        'org-1',
      );
      expect(result).toEqual({ success: true });
    });

    it('logs a PROJECT_DELETED entry', async () => {
      service.remove.mockResolvedValue({
        uid: 'project-1',
        name: 'Sanlam',
      } as any);

      await controller.remove('project-1', buildAuth());

      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'PROJECT_DELETED',
        project_id: 'project-1',
        message: 'Deleted project "Sanlam"',
      });
    });
  });
});
