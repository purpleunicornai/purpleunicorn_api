import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { SearchService } from './search/search.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import type { ClerkAuthContext } from '../auth/auth.types';

function buildAuth(overrides: Partial<ClerkAuthContext> = {}): ClerkAuthContext {
  return {
    userId: 'user-1',
    orgId: 'org-1',
    claims: {},
    ...overrides,
  };
}

function buildRolesService(): jest.Mocked<RolesService> {
  return {
    findAllForProject: jest.fn(),
    findOne: jest.fn(),
    getRole: jest.fn(),
    create: jest.fn(),
    createFilter: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  } as unknown as jest.Mocked<RolesService>;
}

function buildSearchService(): jest.Mocked<SearchService> {
  return {
    search: jest.fn(),
    streamSearch: jest.fn(),
  } as unknown as jest.Mocked<SearchService>;
}

async function captureError(promise: Promise<unknown>): Promise<RequestException> {
  try {
    await promise;
  } catch (error) {
    return error as RequestException;
  }
  throw new Error('Expected promise to reject');
}

describe('RolesController', () => {
  let rolesService: jest.Mocked<RolesService>;
  let searchService: jest.Mocked<SearchService>;
  let controller: RolesController;

  beforeEach(() => {
    rolesService = buildRolesService();
    searchService = buildSearchService();
    controller = new RolesController(rolesService, searchService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('lists roles for the given project in the caller\'s active organization', async () => {
      const roles = [{ uid: 'role-1' }];
      rolesService.findAllForProject.mockResolvedValue(roles as any);

      const result = await controller.findAll('project-1', buildAuth());

      expect(rolesService.findAllForProject).toHaveBeenCalledWith(
        'project-1',
        'org-1',
        'user-1',
      );
      expect(result).toBe(roles);
    });

    it('throws a 400 RequestException when projectId is missing', async () => {
      const error = await captureError(
        controller.findAll(undefined as any, buildAuth()),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.getStatus()).toBe(400);
      expect(rolesService.findAllForProject).not.toHaveBeenCalled();
    });

    it('throws a 400 RequestException when the caller has no active organization', async () => {
      const error = await captureError(
        controller.findAll('project-1', buildAuth({ orgId: undefined })),
      );

      expect(error.getStatus()).toBe(400);
      expect(rolesService.findAllForProject).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('fetches a single role', async () => {
      const role = { uid: 'role-1' };
      rolesService.findOne.mockResolvedValue(role as any);

      const result = await controller.findOne('role-1', buildAuth());

      expect(rolesService.findOne).toHaveBeenCalledWith(
        'role-1',
        'org-1',
        'user-1',
      );
      expect(result).toBe(role);
    });
  });

  describe('create', () => {
    it('creates a role', async () => {
      const created = { uid: 'role-1' };
      rolesService.create.mockResolvedValue(created as any);
      const body = { project_id: 'project-1', name: 'Fullstack Developer' };

      const result = await controller.create(body as any, buildAuth());

      expect(rolesService.create).toHaveBeenCalledWith(body, 'user-1', 'org-1');
      expect(result).toBe(created);
    });
  });

  describe('update', () => {
    it('updates a role', async () => {
      const updated = { uid: 'role-1', name: 'Renamed' };
      rolesService.update.mockResolvedValue(updated as any);
      const body = { name: 'Renamed' };

      const result = await controller.update('role-1', body as any, buildAuth());

      expect(rolesService.update).toHaveBeenCalledWith(
        'role-1',
        body,
        'user-1',
        'org-1',
      );
      expect(result).toBe(updated);
    });
  });

  describe('remove', () => {
    it('deletes a role and returns a success acknowledgement', async () => {
      rolesService.remove.mockResolvedValue(undefined);

      const result = await controller.remove('role-1', buildAuth());

      expect(rolesService.remove).toHaveBeenCalledWith('role-1', 'user-1', 'org-1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('createFilter', () => {
    it('saves the filter criteria for the role', async () => {
      const created = { uid: 'filter-1' };
      rolesService.createFilter.mockResolvedValue(created as any);
      const body = { title: 'Fullstack Developer' };

      const result = await controller.createFilter(
        'role-1',
        body as any,
        buildAuth(),
      );

      expect(rolesService.createFilter).toHaveBeenCalledWith(
        'role-1',
        body,
        'org-1',
        'user-1',
      );
      expect(result).toBe(created);
    });
  });

  describe('fixedSearch', () => {
    it('resolves the role, then runs the search against the saved filter', async () => {
      const role = { uid: 'role-1' };
      rolesService.getRole.mockResolvedValue(role as any);
      const results = [{ uid: 'result-1' }];
      searchService.search.mockResolvedValue(results as any);

      const result = await controller.fixedSearch(
        'role-1',
        { filterId: 'filter-1' },
        buildAuth(),
      );

      expect(rolesService.getRole).toHaveBeenCalledWith(
        'role-1',
        'org-1',
        'user-1',
      );
      expect(searchService.search).toHaveBeenCalledWith('filter-1', role);
      expect(result).toBe(results);
    });
  });

  describe('search (SSE)', () => {
    it('delegates to SearchService.streamSearch for the given role', () => {
      const stream = { subscribe: jest.fn() };
      searchService.streamSearch.mockReturnValue(stream as any);

      const result = controller.search('role-1');

      expect(searchService.streamSearch).toHaveBeenCalledWith('role-1');
      expect(result).toBe(stream);
    });
  });
});
