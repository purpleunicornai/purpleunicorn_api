import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
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
  let controller: ProjectsController;

  beforeEach(() => {
    service = buildService();
    controller = new ProjectsController(service);
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
      const created = { uid: 'project-1' };
      service.create.mockResolvedValue(created as any);
      const body = { name: 'Sanlam' };

      const result = await controller.create(body, buildAuth());

      expect(service.create).toHaveBeenCalledWith(body, 'user-1', 'org-1');
      expect(result).toBe(created);
    });
  });

  describe('update', () => {
    it('updates a project', async () => {
      const updated = { uid: 'project-1', name: 'Renamed' };
      service.update.mockResolvedValue(updated as any);
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
  });

  describe('remove', () => {
    it('deletes a project and returns a success acknowledgement', async () => {
      service.remove.mockResolvedValue(undefined);

      const result = await controller.remove('project-1', buildAuth());

      expect(service.remove).toHaveBeenCalledWith(
        'project-1',
        'user-1',
        'org-1',
      );
      expect(result).toEqual({ success: true });
    });
  });
});
