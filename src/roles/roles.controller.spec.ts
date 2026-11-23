import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { SearchService } from './search/search.service';
import { JobSpecImportService } from './job-spec-import.service';
import { LogsService } from '../common/logs/logs.service';
import { ClerkService } from '../common/clerk/clerk.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import type { ClerkAuthContext } from '../auth/auth.types';
import { of, lastValueFrom, toArray } from 'rxjs';
import type { RocketReachLookupsService } from '../services/rocket-reach/rocket-reach-lookups.service';
import { PaidResearchService } from './research/paid-research.service';
import {
  CreditsService,
  InsufficientCreditsException,
} from '../organization/credits/credits.service';
import type { RocketReachService } from '../services/rocket-reach/rocket-reach.service';

const RESEARCH_CHARGE = {
  uid: 'charge-1',
  organization_id: 'org-1',
  amount: -1,
  period: '2026-11',
};

function buildCreditsService(): jest.Mocked<CreditsService> {
  return {
    costPerRun: 1,
    balance: jest.fn().mockResolvedValue(10),
    charge: jest.fn().mockResolvedValue(RESEARCH_CHARGE),
    refund: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<CreditsService>;
}

// RocketReach off (no API key): research costs the base credit only.
const rocketReachOff = {
  enabled: false,
  canLookUp: () => true,
  lookup: jest.fn(),
} as unknown as RocketReachService;

const noRecentLookups = {
  recentProfile: jest.fn().mockResolvedValue(null),
  record: jest.fn(),
} as unknown as RocketReachLookupsService;

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

function buildClerkService(): jest.Mocked<ClerkService> {
  return {
    getUser: jest.fn().mockResolvedValue({
      firstName: 'Jane',
      lastName: 'Admin',
      username: null,
    }),
  } as unknown as jest.Mocked<ClerkService>;
}

function buildJobSpecImportService(): jest.Mocked<JobSpecImportService> {
  return {
    importJobSpec: jest.fn(),
  } as unknown as jest.Mocked<JobSpecImportService>;
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
  let clerkService: jest.Mocked<ClerkService>;
  let jobSpecImportService: jest.Mocked<JobSpecImportService>;
  let creditsService: jest.Mocked<CreditsService>;
  let controller: RolesController;

  beforeEach(() => {
    rolesService = buildRolesService();
    searchService = buildSearchService();
    logsService = buildLogsService();
    clerkService = buildClerkService();
    jobSpecImportService = buildJobSpecImportService();
    creditsService = buildCreditsService();
    controller = new RolesController(
      rolesService,
      searchService,
      logsService,
      clerkService,
      jobSpecImportService,
      new PaidResearchService(
        creditsService,
        searchService,
        rocketReachOff,
        noRecentLookups,
      ),
    );
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
    it('saves the filter criteria for the role and returns the filter', async () => {
      const created = { uid: 'filter-1', role_filter_items: [] };
      rolesService.createFilter.mockResolvedValue({
        filter: created,
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
        filter: { uid: 'filter-1' },
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
        filter: { uid: 'filter-2' },
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
      expect(clerkService.getUser).toHaveBeenCalledWith('user-1');
      expect(searchService.search).toHaveBeenCalledWith(
        'role-1',
        role,
        'user-1',
        'Jane Admin',
      );
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
    it('resolves the role for auth, then returns the result scoped to it without researching', async () => {
      rolesService.getRole.mockResolvedValue({ uid: 'role-1' } as any);
      const result = {
        uid: 'result-1',
        candidate: { uid: 'candidate-1', enriched_at: null },
      };
      rolesService.getRoleResult.mockResolvedValue(result as any);

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
        'role-1',
      );
      expect(searchService.deepSearchCandidate).not.toHaveBeenCalled();
      expect(logsService.log).not.toHaveBeenCalled();
      expect(response).toBe(result);
    });
  });

  describe('researchCandidate', () => {
    const jane = {
      uid: 'candidate-1',
      first_name: 'Jane',
      last_name: 'Doe',
      enriched_at: null,
      sources: [],
    };

    function givenResult(candidate: object | null) {
      rolesService.getRole.mockResolvedValue({ uid: 'role-1' } as any);
      rolesService.getRoleResult.mockResolvedValueOnce({
        uid: 'result-1',
        candidate,
      } as any);
    }

    it('charges, forces a deep research, logs it, and returns the result re-read after research', async () => {
      givenResult(jane);
      searchService.deepSearchCandidate.mockResolvedValue({
        ...jane,
        enriched_at: new Date('2026-11-17T10:00:00Z'),
      } as any);
      const refreshed = { uid: 'result-1', summary: 'Researched summary' };
      rolesService.getRoleResult.mockResolvedValueOnce(refreshed as any);

      const response = await controller.researchCandidate(
        'role-1',
        'result-1',
        buildAuth(),
      );

      expect(creditsService.charge).toHaveBeenCalledWith({
        organizationId: 'org-1',
        userId: 'user-1',
        roleId: 'role-1',
        roleResultId: 'result-1',
        candidateId: 'candidate-1',
        rocketReach: 'none',
      });
      expect(searchService.deepSearchCandidate).toHaveBeenCalledWith(
        'candidate-1',
        'role-1',
        true,
        { rocketReach: undefined },
      );
      expect(creditsService.refund).not.toHaveBeenCalled();
      expect(logsService.log).toHaveBeenCalledWith({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'CANDIDATE_DEEP_SEARCH',
        role_id: 'role-1',
        role_result_id: 'result-1',
        message: 'Deep search for candidate "Jane Doe"',
      });
      expect(response).toBe(refreshed);
    });

    it('surfaces a failed research as a 502 and refunds the whole charge', async () => {
      givenResult(jane);
      searchService.deepSearchCandidate.mockRejectedValue(new Error('boom'));

      const error = await captureError(
        controller.researchCandidate('role-1', 'result-1', buildAuth()),
      );

      expect(error.getStatus()).toBe(502);
      expect(creditsService.refund).toHaveBeenCalledWith(RESEARCH_CHARGE, {
        credits: 1,
        part: 'all',
        reason: 'Deep research failed',
      });
      expect(logsService.log).not.toHaveBeenCalled();
    });

    it('blocks with a 402 carrying the balance and what was needed, without researching', async () => {
      givenResult(jane);
      creditsService.charge.mockRejectedValue(
        new InsufficientCreditsException(0, 1),
      );

      const error = await captureError(
        controller.researchCandidate('role-1', 'result-1', buildAuth()),
      );

      expect(error.getStatus()).toBe(402);
      expect(error.getResponse()).toMatchObject({ balance: 0, required: 1 });
      expect(searchService.deepSearchCandidate).not.toHaveBeenCalled();
    });

    it('rejects with a 422, uncharged, when the candidate has no name to search on', async () => {
      givenResult({ ...jane, first_name: null, last_name: ' ' });

      const error = await captureError(
        controller.researchCandidate('role-1', 'result-1', buildAuth()),
      );

      expect(error.getStatus()).toBe(422);
      expect(creditsService.charge).not.toHaveBeenCalled();
      expect(searchService.deepSearchCandidate).not.toHaveBeenCalled();
    });

    it('rejects with a 422 when the result has no candidate', async () => {
      givenResult(null);

      const error = await captureError(
        controller.researchCandidate('role-1', 'result-1', buildAuth()),
      );

      expect(error.getStatus()).toBe(422);
      expect(creditsService.charge).not.toHaveBeenCalled();
      expect(searchService.deepSearchCandidate).not.toHaveBeenCalled();
    });
  });

  describe('researchQuote', () => {
    it('quotes the cost against the balance without charging', async () => {
      rolesService.getRole.mockResolvedValue({ uid: 'role-1' } as any);
      rolesService.getRoleResult.mockResolvedValue({
        uid: 'result-1',
        candidate: { uid: 'candidate-1', first_name: 'Jane', sources: [] },
      } as any);
      creditsService.balance.mockResolvedValue(0);

      const quote = await controller.researchQuote(
        'role-1',
        'result-1',
        buildAuth(),
      );

      expect(quote).toMatchObject({
        credits: 1,
        balance: 0,
        sufficient: false,
      });
      expect(creditsService.charge).not.toHaveBeenCalled();
    });
  });

  describe('search (SSE)', () => {
    it('resolves the role for auth, then delegates to SearchService.streamSearch', async () => {
      rolesService.getRole.mockResolvedValue({
        uid: 'role-1',
        name: 'Fullstack Developer',
      } as any);
      searchService.streamSearch.mockReturnValue(of());

      await lastValueFrom(
        controller.search('role-1', buildAuth()).pipe(toArray()),
      );

      expect(rolesService.getRole).toHaveBeenCalledWith(
        'role-1',
        'org-1',
        'user-1',
      );
      expect(clerkService.getUser).toHaveBeenCalledWith('user-1');
      expect(searchService.streamSearch).toHaveBeenCalledWith(
        'role-1',
        'user-1',
        'Jane Admin',
        'Fullstack Developer',
      );
    });

    it('falls back to the username, then the userId, when first/last name are unavailable', async () => {
      rolesService.getRole.mockResolvedValue({
        uid: 'role-1',
        name: 'Fullstack Developer',
      } as any);
      searchService.streamSearch.mockReturnValue(of());
      clerkService.getUser.mockResolvedValue({
        firstName: null,
        lastName: null,
        username: 'janedoe',
      } as any);

      await lastValueFrom(
        controller.search('role-1', buildAuth()).pipe(toArray()),
      );

      expect(searchService.streamSearch).toHaveBeenCalledWith(
        'role-1',
        'user-1',
        'janedoe',
        'Fullstack Developer',
      );

      clerkService.getUser.mockResolvedValue({
        firstName: null,
        lastName: null,
        username: null,
      } as any);

      await lastValueFrom(
        controller.search('role-1', buildAuth()).pipe(toArray()),
      );

      expect(searchService.streamSearch).toHaveBeenLastCalledWith(
        'role-1',
        'user-1',
        'user-1',
        'Fullstack Developer',
      );
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

  describe('importJobSpec', () => {
    it('checks the caller can access the role, resolves their display name, then delegates to JobSpecImportService', async () => {
      rolesService.getRole.mockResolvedValue({ uid: 'role-1' } as any);
      const result = { uid: 'import-1' };
      jobSpecImportService.importJobSpec.mockResolvedValue(result as any);

      const response = await controller.importJobSpec(
        'role-1',
        { text: 'Senior Engineer job spec.' },
        buildAuth(),
      );

      expect(rolesService.getRole).toHaveBeenCalledWith(
        'role-1',
        'org-1',
        'user-1',
      );
      expect(clerkService.getUser).toHaveBeenCalledWith('user-1');
      expect(jobSpecImportService.importJobSpec).toHaveBeenCalledWith(
        'role-1',
        { text: 'Senior Engineer job spec.' },
        'user-1',
        'Jane Admin',
      );
      expect(response).toBe(result);
    });

    it("checks the caller's access to the role before delegating", async () => {
      rolesService.getRole.mockRejectedValue(
        new RequestException('Role not found', 404, 'ROLE_NOT_FOUND'),
      );

      const error = await captureError(
        controller.importJobSpec('role-1', { text: 'spec' }, buildAuth()),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(jobSpecImportService.importJobSpec).not.toHaveBeenCalled();
    });
  });
});
