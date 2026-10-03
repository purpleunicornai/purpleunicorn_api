import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { SearchService } from './search/search.service';
import { LogsService } from '../common/logs/logs.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import type { ClerkAuthContext } from '../auth/auth.types';
import { of, lastValueFrom, toArray } from 'rxjs';

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

function buildRolesService(): jest.Mocked<RolesService> {
  return {
    findAllForProject: jest.fn(),
    findOne: jest.fn(),
    getRole: jest.fn(),
    create: jest.fn(),
    createFilter: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getRoleResult: jest.fn(),
  } as unknown as jest.Mocked<RolesService>;
}

function buildSearchService(): jest.Mocked<SearchService> {
  return {
    search: jest.fn(),
    streamSearch: jest.fn(),
    deepSearchCandidate: jest.fn(),
  } as unknown as jest.Mocked<SearchService>;
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

describe('RolesController', () => {
  let rolesService: jest.Mocked<RolesService>;
  let searchService: jest.Mocked<SearchService>;
  let logsService: jest.Mocked<LogsService>;
  let controller: RolesController;

  beforeEach(() => {
    rolesService = buildRolesService();
    searchService = buildSearchService();
    logsService = buildLogsService();
    controller = new RolesController(rolesService, searchService, logsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it("lists roles for the given project in the caller's active organization", async () => {
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
      const created = { uid: 'role-1', name: 'Fullstack Developer' };
      rolesService.create.mockResolvedValue(created as any);
      const body = { project_id: 'project-1', name: 'Fullstack Developer' };

      const result = await controller.create(body as any, buildAuth());

      expect(rolesService.create).toHaveBeenCalledWith(body, 'user-1', 'org-1');
      expect(result).toBe(created);
    });

    it('logs a ROLE_CREATED entry', async () => {
      const created = { uid: 'role-1', name: 'Fullstack Developer' };
      rolesService.create.mockResolvedValue(created as any);

      await controller.create(
        { project_id: 'project-1', name: 'Fullstack Developer' } as any,
        buildAuth(),
      );

      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'ROLE_CREATED',
        role_id: 'role-1',
        message: 'Created role "Fullstack Developer"',
      });
    });
  });

  describe('update', () => {
    it('updates a role', async () => {
      const updated = { uid: 'role-1', name: 'Renamed' };
      rolesService.update.mockResolvedValue(updated as any);
      const body = { name: 'Renamed' };

      const result = await controller.update(
        'role-1',
        body as any,
        buildAuth(),
      );

      expect(rolesService.update).toHaveBeenCalledWith(
        'role-1',
        body,
        'user-1',
        'org-1',
      );
      expect(result).toBe(updated);
    });

    it('logs a ROLE_UPDATED entry', async () => {
      const updated = { uid: 'role-1', name: 'Renamed' };
      rolesService.update.mockResolvedValue(updated as any);

      await controller.update(
        'role-1',
        { name: 'Renamed' } as any,
        buildAuth(),
      );

      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'ROLE_UPDATED',
        role_id: 'role-1',
        message: 'Updated role "Renamed"',
      });
    });
  });

  describe('remove', () => {
    it('deletes a role and returns a success acknowledgement', async () => {
      rolesService.remove.mockResolvedValue({
        uid: 'role-1',
        name: 'Fullstack Developer',
      } as any);

      const result = await controller.remove('role-1', buildAuth());

      expect(rolesService.remove).toHaveBeenCalledWith(
        'role-1',
        'user-1',
        'org-1',
      );
      expect(result).toEqual({ success: true });
    });

    it('logs a ROLE_DELETED entry', async () => {
      rolesService.remove.mockResolvedValue({
        uid: 'role-1',
        name: 'Fullstack Developer',
      } as any);

      await controller.remove('role-1', buildAuth());

      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'ROLE_DELETED',
        role_id: 'role-1',
        message: 'Deleted role "Fullstack Developer"',
      });
    });
  });

  describe('createFilter', () => {
    it('saves the filter criteria for the role and returns the filters', async () => {
      const created = [{ uid: 'filter-1', category: 'skills' }];
      rolesService.createFilter.mockResolvedValue({
        filters: created,
        isFirst: true,
      } as any);
      const body = {
        filters: [
          { category: 'skills', list_value: ['React'], priority: 'essential' },
        ],
      };

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

    it('logs ROLE_FILTERS_CREATED when this is the first set of filters for the role', async () => {
      rolesService.createFilter.mockResolvedValue({
        filters: [{ uid: 'filter-1' }],
        isFirst: true,
      } as any);

      await controller.createFilter(
        'role-1',
        { filters: [] } as any,
        buildAuth(),
      );

      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'ROLE_FILTERS_CREATED',
        role_id: 'role-1',
        message: 'Created search filters for role',
      });
    });

    it('logs ROLE_FILTERS_UPDATED when previous filters existed for the role', async () => {
      rolesService.createFilter.mockResolvedValue({
        filters: [{ uid: 'filter-2' }],
        isFirst: false,
      } as any);

      await controller.createFilter(
        'role-1',
        { filters: [] } as any,
        buildAuth(),
      );

      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'ROLE_FILTERS_UPDATED',
        role_id: 'role-1',
        message: 'Updated search filters for role',
      });
    });
  });

  describe('fixedSearch', () => {
    it('resolves the role, then runs the search against the saved filter', async () => {
      const role = { uid: 'role-1', name: 'Fullstack Developer' };
      rolesService.getRole.mockResolvedValue(role as any);
      const results = [{ uid: 'result-1', tokens_used: 100 }];
      searchService.search.mockResolvedValue(results as any);

      const result = await controller.fixedSearch('role-1', {}, buildAuth());

      expect(rolesService.getRole).toHaveBeenCalledWith(
        'role-1',
        'org-1',
        'user-1',
      );
      expect(searchService.search).toHaveBeenCalledWith('role-1', role);
      expect(result).toBe(results);
    });

    it('logs a ROLE_SEARCH entry with the summed tokens used', async () => {
      const role = { uid: 'role-1', name: 'Fullstack Developer' };
      rolesService.getRole.mockResolvedValue(role as any);
      const results = [
        { uid: 'result-1', tokens_used: 100 },
        { uid: 'result-2', tokens_used: 50 },
      ];
      searchService.search.mockResolvedValue(results as any);

      await controller.fixedSearch('role-1', {}, buildAuth());

      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'ROLE_SEARCH',
        role_id: 'role-1',
        tokens_used: 150,
        message:
          'Ran search for role "Fullstack Developer", found 2 candidate(s)',
      });
    });
  });

  describe('getRoleResult', () => {
    it('resolves the role for auth, then returns the result with a freshly deep-searched candidate', async () => {
      const role = { uid: 'role-1' };
      rolesService.getRole.mockResolvedValue(role as any);
      const candidate = { uid: 'candidate-1', enriched_at: null };
      const result = { uid: 'result-1', candidate };
      rolesService.getRoleResult.mockResolvedValue(result as any);
      const enrichedCandidate = { uid: 'candidate-1', enriched_at: new Date() };
      searchService.deepSearchCandidate.mockResolvedValue(
        enrichedCandidate as any,
      );

      const response = await controller.getRoleResult(
        'role-1',
        'result-1',
        buildAuth(),
      );

      expect(rolesService.getRole).toHaveBeenCalledWith(
        'role-1',
        'org-1',
        'user-1',
      );
      expect(rolesService.getRoleResult).toHaveBeenCalledWith(
        'result-1',
        'org-1',
      );
      expect(searchService.deepSearchCandidate).toHaveBeenCalledWith(
        'candidate-1',
        'role-1',
        false,
      );
      expect(response).toEqual({
        uid: 'result-1',
        candidate: enrichedCandidate,
      });
    });

    it('logs a CANDIDATE_DEEP_SEARCH entry when a fresh search actually ran', async () => {
      const role = { uid: 'role-1' };
      rolesService.getRole.mockResolvedValue(role as any);
      const candidate = { uid: 'candidate-1', enriched_at: null };
      const result = { uid: 'result-1', candidate };
      rolesService.getRoleResult.mockResolvedValue(result as any);
      const enrichedCandidate = {
        uid: 'candidate-1',
        first_name: 'Jane',
        last_name: 'Doe',
        enriched_at: new Date(),
      };
      searchService.deepSearchCandidate.mockResolvedValue(
        enrichedCandidate as any,
      );

      await controller.getRoleResult('role-1', 'result-1', buildAuth());

      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'CANDIDATE_DEEP_SEARCH',
        role_id: 'role-1',
        role_result_id: 'result-1',
        message: 'Deep search for candidate "Jane Doe"',
      });
    });

    it('skips the deep search when the candidate has already been enriched', async () => {
      rolesService.getRole.mockResolvedValue({ uid: 'role-1' } as any);
      const candidate = { uid: 'candidate-1', enriched_at: new Date() };
      const result = { uid: 'result-1', candidate };
      rolesService.getRoleResult.mockResolvedValue(result as any);

      const response = await controller.getRoleResult(
        'role-1',
        'result-1',
        buildAuth(),
      );

      expect(searchService.deepSearchCandidate).not.toHaveBeenCalled();
      expect(logsService.log).not.toHaveBeenCalled();
      expect(response).toBe(result);
    });

    it('forces a fresh deep search even when already enriched when refresh=true is passed', async () => {
      rolesService.getRole.mockResolvedValue({ uid: 'role-1' } as any);
      const candidate = { uid: 'candidate-1', enriched_at: new Date() };
      const result = { uid: 'result-1', candidate };
      rolesService.getRoleResult.mockResolvedValue(result as any);
      const refreshedCandidate = {
        uid: 'candidate-1',
        enriched_at: new Date(),
      };
      searchService.deepSearchCandidate.mockResolvedValue(
        refreshedCandidate as any,
      );

      const response = await controller.getRoleResult(
        'role-1',
        'result-1',
        buildAuth(),
        'true',
      );

      expect(searchService.deepSearchCandidate).toHaveBeenCalledWith(
        'candidate-1',
        'role-1',
        true,
      );
      expect(logsService.log).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CANDIDATE_DEEP_SEARCH' }),
      );
      expect(response).toEqual({
        uid: 'result-1',
        candidate: refreshedCandidate,
      });
    });

    it('does not force a refresh when refresh is anything other than the string "true"', async () => {
      rolesService.getRole.mockResolvedValue({ uid: 'role-1' } as any);
      const candidate = { uid: 'candidate-1', enriched_at: new Date() };
      const result = { uid: 'result-1', candidate };
      rolesService.getRoleResult.mockResolvedValue(result as any);

      await controller.getRoleResult(
        'role-1',
        'result-1',
        buildAuth(),
        'false',
      );

      expect(searchService.deepSearchCandidate).not.toHaveBeenCalled();
    });

    it('skips the deep search when the result has no matched candidate', async () => {
      rolesService.getRole.mockResolvedValue({ uid: 'role-1' } as any);
      const result = { uid: 'result-1', candidate: null };
      rolesService.getRoleResult.mockResolvedValue(result as any);

      const response = await controller.getRoleResult(
        'role-1',
        'result-1',
        buildAuth(),
      );

      expect(searchService.deepSearchCandidate).not.toHaveBeenCalled();
      expect(response).toBe(result);
    });

    it('falls back to the un-enriched result when the deep search fails, without logging', async () => {
      rolesService.getRole.mockResolvedValue({ uid: 'role-1' } as any);
      const candidate = { uid: 'candidate-1', enriched_at: null };
      const result = { uid: 'result-1', candidate };
      rolesService.getRoleResult.mockResolvedValue(result as any);
      searchService.deepSearchCandidate.mockRejectedValue(new Error('boom'));

      const response = await controller.getRoleResult(
        'role-1',
        'result-1',
        buildAuth(),
      );

      expect(logsService.log).not.toHaveBeenCalled();
      expect(response).toBe(result);
    });
  });

  describe('search (SSE)', () => {
    it('resolves the role for auth, then delegates to SearchService.streamSearch', async () => {
      rolesService.getRole.mockResolvedValue({ uid: 'role-1' } as any);
      searchService.streamSearch.mockReturnValue(of());

      await lastValueFrom(
        controller.search('role-1', buildAuth()).pipe(toArray()),
      );

      expect(rolesService.getRole).toHaveBeenCalledWith(
        'role-1',
        'org-1',
        'user-1',
      );
      expect(searchService.streamSearch).toHaveBeenCalledWith('role-1');
    });

    it("checks the caller's access to the role before streaming", async () => {
      rolesService.getRole.mockRejectedValue(
        new RequestException('Role not found', 404, 'ROLE_NOT_FOUND'),
      );
      searchService.streamSearch.mockReturnValue(of());

      const observable = controller.search('role-1', buildAuth());

      await expect(lastValueFrom(observable)).rejects.toBeInstanceOf(
        RequestException,
      );
      expect(searchService.streamSearch).not.toHaveBeenCalled();
    });

    it('logs a ROLE_SEARCH entry with the summed tokens used once the stream completes', async () => {
      rolesService.getRole.mockResolvedValue({
        uid: 'role-1',
        name: 'Fullstack Developer',
      } as any);
      searchService.streamSearch.mockReturnValue(
        of(
          { type: 'stage', data: { stage: 'searching', status: 'started' } },
          {
            type: 'done',
            data: {
              result: [
                { uid: 'result-1', tokens_used: 100 },
                { uid: 'result-2', tokens_used: 50 },
              ],
            },
          },
        ) as any,
      );

      await lastValueFrom(
        controller.search('role-1', buildAuth()).pipe(toArray()),
      );

      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'ROLE_SEARCH',
        role_id: 'role-1',
        tokens_used: 150,
        message:
          'Ran search for role "Fullstack Developer", found 2 candidate(s)',
      });
    });

    it('does not log when the stream errors out', async () => {
      rolesService.getRole.mockResolvedValue({
        uid: 'role-1',
        name: 'Fullstack Developer',
      } as any);
      searchService.streamSearch.mockReturnValue(
        of({
          type: 'error',
          data: { message: 'boom' },
        }) as any,
      );

      await lastValueFrom(
        controller.search('role-1', buildAuth()).pipe(toArray()),
      );

      expect(logsService.log).not.toHaveBeenCalled();
    });
  });
});
