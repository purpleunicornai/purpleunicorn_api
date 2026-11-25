import { CandidateActionsService, statusOf } from './candidate-actions.service';
import { PrismaService } from '../common/database/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RolesService } from './roles.service';
import { SearchService } from './search/search.service';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const prisma = {
    candidate: { findUnique: jest.fn().mockResolvedValue({ uid: 'cand-1' }) },
    role_filters: {
      findFirst: jest.fn().mockResolvedValue({ uid: 'filter-2' }),
    },
    role_result: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({
        metadata: { addedFrom: 'role-1', scoring: 'pending' },
      }),
      findMany: jest.fn(),
      create: jest.fn().mockResolvedValue({ uid: 'result-2' }),
      update: jest.fn(),
    },
  };
  const rolesService = { getRole: jest.fn().mockResolvedValue({}) };
  // Stands in for the AI scoring pass: no real model is called.
  const searchService = {
    scoreCandidateForRole: jest.fn().mockResolvedValue({ uid: 'result-2' }),
  };
  const projectsService = { visibleToUser: jest.fn().mockReturnValue({}) };
  const service = new CandidateActionsService(
    prisma as unknown as PrismaService,
    projectsService as unknown as ProjectsService,
    rolesService as unknown as RolesService,
    searchService as unknown as SearchService,
  );
  return { prisma, rolesService, searchService, service };
}

const add = {
  candidateUid: 'cand-1',
  roleIds: ['role-2'],
  score: true,
  shortlist: false,
};

describe('CandidateActionsService.addToRoles', () => {
  it('adds the candidate to the other role as Reviewing and scores them there', async () => {
    const { prisma, rolesService, searchService, service } = setup();

    const outcome = await service.addToRoles('role-1', add, 'org-1', 'user-1');
    await flush();

    expect(outcome).toEqual({ added: ['role-2'], skipped: [] });
    expect(rolesService.getRole).toHaveBeenCalledWith(
      'role-2',
      'org-1',
      'user-1',
    );
    expect(prisma.role_result.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role_id: 'role-2',
        candidate_uid: 'cand-1',
        filter_id: 'filter-2',
        shortlist: false,
        metadata: { addedFrom: 'role-1', scoring: 'pending' },
      }),
    });
    expect(searchService.scoreCandidateForRole).toHaveBeenCalledWith(
      'role-2',
      'cand-1',
    );
    expect(prisma.role_result.update).not.toHaveBeenCalled();
  });

  it('skips roles they are already in (such as the current one) or that have no filters', async () => {
    const { prisma, searchService, service } = setup();
    prisma.role_result.findFirst.mockResolvedValueOnce({ uid: 'old' });
    prisma.role_filters.findFirst
      .mockResolvedValueOnce({ uid: 'f' })
      .mockResolvedValueOnce(null);

    const outcome = await service.addToRoles(
      'role-1',
      { ...add, roleIds: ['role-1', 'role-3'] },
      'org-1',
      'user-1',
    );

    expect(outcome).toEqual({
      added: [],
      skipped: [
        { roleId: 'role-1', reason: 'ALREADY_ADDED' },
        { roleId: 'role-3', reason: 'NO_FILTERS' },
      ],
    });
    expect(prisma.role_result.create).not.toHaveBeenCalled();
    expect(searchService.scoreCandidateForRole).not.toHaveBeenCalled();
  });

  it('adds as Shortlisted without scoring when asked', async () => {
    const { prisma, searchService, service } = setup();

    await service.addToRoles(
      'role-1',
      { ...add, score: false, shortlist: true },
      'org-1',
      'user-1',
    );

    expect(prisma.role_result.create.mock.calls[0][0].data).toMatchObject({
      shortlist: true,
      metadata: { addedFrom: 'role-1' },
    });
    expect(searchService.scoreCandidateForRole).not.toHaveBeenCalled();
  });

  it('marks the score failed when the scoring pass throws', async () => {
    const { prisma, searchService, service } = setup();
    searchService.scoreCandidateForRole.mockRejectedValue(
      new Error('model down'),
    );

    await service.addToRoles('role-1', add, 'org-1', 'user-1');
    await flush();

    expect(prisma.role_result.update).toHaveBeenCalledWith({
      where: { uid: 'result-2' },
      data: { metadata: { addedFrom: 'role-1', scoring: 'failed' } },
    });
  });
});

describe('statusOf', () => {
  const base = {
    shortlist: false,
    not_suitable: false,
    score: 80,
    metadata: null,
  };
  it.each([
    [{}, 'REVIEWING'],
    [{ shortlist: true }, 'SHORTLISTED'],
    [{ shortlist: true, not_suitable: true }, 'NOT_SUITABLE'],
    [{ score: null, metadata: { scoring: 'pending' } }, 'SCORING'],
    [{ score: null, metadata: { scoring: 'failed' } }, 'REVIEWING'],
  ])('%j is %s', (patch, status) => {
    expect(statusOf({ ...base, ...patch })).toBe(status);
  });
});

describe('CandidateActionsService.rolesFor', () => {
  it("lists the person's roles in the org with score and status", async () => {
    const { prisma, service } = setup();
    prisma.role_result.findFirst.mockResolvedValue({
      candidate: { uid: 'cand-1' },
    });
    prisma.role_result.findMany.mockResolvedValue([
      {
        uid: 'r1',
        role_id: 'role-1',
        score: 92,
        shortlist: true,
        not_suitable: false,
        metadata: null,
        role: {
          name: 'Senior Finance Manager',
          project_id: 'p1',
          project: { name: 'Cape Town finance' },
        },
      },
    ]);

    await expect(
      service.rolesFor('role-1', 'r1', 'org-1', 'user-1'),
    ).resolves.toEqual([
      {
        resultId: 'r1',
        roleId: 'role-1',
        roleName: 'Senior Finance Manager',
        projectId: 'p1',
        projectName: 'Cape Town finance',
        score: 92,
        status: 'SHORTLISTED',
      },
    ]);
    expect(prisma.role_result.findMany.mock.calls[0][0].where).toMatchObject({
      candidate_uid: 'cand-1',
      role: { project: { organization_id: 'org-1' } },
    });
  });
});
