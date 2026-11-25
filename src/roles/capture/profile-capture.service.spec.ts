import type { PrismaService } from '../../common/database/prisma.service';
import type { ProjectsService } from '../../projects/projects.service';
import { CandidateScoringService } from '../search/candidate-scoring.service';
import type { CapturedProfileDto } from './captured-profile.dto';
import { ProfileCaptureService } from './profile-capture.service';

const SKILLS_ITEM = {
  uid: 'item-1',
  category: 'skills',
  priority: 'ESSENTIAL',
  non_negotiable: false,
  list_value: ['IFRS', 'SAP'],
  value: null,
  children: [],
};

const PROFILE: CapturedProfileDto = {
  linkedinUrl: 'https://za.linkedin.com/in/thandiwe-nkosi/',
  name: 'Thandiwe Nkosi',
  headline: 'Finance Manager',
  skills: ['IFRS'],
  experience: [
    { title: 'Finance Manager', company: 'Northvale', startDate: '2021-03-01' },
  ],
};

function candidateRow(over: Record<string, unknown> = {}) {
  return {
    uid: 'cand-1',
    first_name: 'Thandiwe',
    last_name: 'Nkosi',
    skills: ['ifrs'],
    languages: [],
    current_title: 'Finance Manager',
    experience: [],
    education: [],
    ...over,
  };
}

type SetupOptions = {
  filterSet?: unknown;
  candidate?: unknown;
  result?: unknown;
};

type Write = { where?: { uid: string }; data: Record<string, unknown> };

function setup({
  filterSet = { uid: 'filter-1', role_filter_items: [SKILLS_ITEM] },
  candidate = null,
  result = null,
}: SetupOptions = {}) {
  const prisma = {
    role_filters: { findFirst: jest.fn().mockResolvedValue(filterSet) },
    candidate: {
      findFirst: jest.fn().mockResolvedValue(candidate),
      // Rows as Prisma returns them: scalars only, history read back empty.
      create: jest.fn((args: Write) =>
        Promise.resolve(candidateRow({ first_name: args.data.first_name })),
      ),
      update: jest.fn((args: Write) =>
        Promise.resolve(candidateRow({ skills: args.data.skills })),
      ),
    },
    role_result: {
      findFirst: jest.fn().mockResolvedValue(result),
      findMany: jest.fn(),
      create: jest.fn((args: Write) =>
        Promise.resolve({ uid: 'result-new', shortlist: false, ...args.data }),
      ),
      update: jest.fn((args: Write) =>
        Promise.resolve({ uid: 'result-1', shortlist: true, ...args.data }),
      ),
    },
    role_result_score_breakdown: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const projects = {
    visibleToUser: jest.fn().mockReturnValue({ OR: [{ user_id: 'user-1' }] }),
  };
  const service = new ProfileCaptureService(
    prisma as unknown as PrismaService,
    new CandidateScoringService(),
    projects as unknown as ProjectsService,
  );
  return { prisma, service };
}

describe('ProfileCaptureService.capture', () => {
  it('adds a new profile to the role, scored and sourced from the extension', async () => {
    const { prisma, service } = setup();

    const score = await service.capture('role-1', PROFILE);

    expect(prisma.candidate.create.mock.calls[0][0].data).toMatchObject({
      sources: {
        create: [
          {
            url: 'https://www.linkedin.com/in/thandiwe-nkosi',
            type: 'PLUGIN',
            main: true,
          },
        ],
      },
      experience: { create: [{ company_name: 'Northvale' }] },
    });
    expect(prisma.role_result.create.mock.calls[0][0].data).toMatchObject({
      role_id: 'role-1',
      candidate_uid: 'cand-1',
      filter_id: 'filter-1',
      sources: ['Chrome extension'],
      score: 40,
    });
    expect(prisma.role_result_score_breakdown.createMany).toHaveBeenCalled();
    expect(score).toMatchObject({
      resultId: 'result-new',
      alreadyInRole: false,
      score: 40,
      matchedSkills: ['IFRS'],
      missingSkills: ['SAP'],
      checks: [{ category: 'skills', outcome: 'partial' }],
    });
  });

  it('re-capturing refreshes the same result and keeps its deep research', async () => {
    const { prisma, service } = setup({
      candidate: candidateRow({ skills: ['sap'], experience: [{ uid: 'x' }] }),
      result: {
        uid: 'result-1',
        sources: ['Vertex'],
        metadata: {
          findings: ['kept'],
          researchEvidence: { skills: ['ifrs'] },
        },
      },
    });

    const score = await service.capture('role-1', PROFILE);

    const update = prisma.candidate.update.mock.calls[0][0];
    expect(update.data.skills).toEqual(['sap', 'ifrs']);
    expect(update.data).not.toHaveProperty('experience');
    expect(prisma.role_result.create).not.toHaveBeenCalled();
    const resultUpdate = prisma.role_result.update.mock.calls[0][0];
    expect(resultUpdate.where).toEqual({ uid: 'result-1' });
    expect(resultUpdate.data).toMatchObject({
      sources: ['Vertex', 'Chrome extension'],
      metadata: { findings: ['kept'] },
    });
    expect(score).toMatchObject({
      alreadyInRole: true,
      shortlisted: true,
      score: 80,
    });
  });

  it('refuses a page that is not a LinkedIn profile', async () => {
    const { prisma, service } = setup();
    await expect(
      service.capture('role-1', {
        ...PROFILE,
        linkedinUrl: 'https://example.com/in/x',
      }),
    ).rejects.toMatchObject({
      message: 'Not a LinkedIn profile URL',
      status: 400,
    });
    expect(prisma.candidate.create).not.toHaveBeenCalled();
  });

  it('refuses a role with no filters and writes nothing', async () => {
    const { prisma, service } = setup({ filterSet: null });
    await expect(service.capture('role-1', PROFILE)).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.candidate.create).not.toHaveBeenCalled();
  });
});

describe('ProfileCaptureService.membership', () => {
  it('is empty for a profile Purple Unicorn has never seen', async () => {
    const { service } = setup();
    await expect(
      service.membership('https://www.linkedin.com/in/new', 'org-1', 'user-1'),
    ).resolves.toEqual({ candidateId: null, roles: [] });
  });

  it('lists the roles in the org, visible to the user, it is already in', async () => {
    const { prisma, service } = setup({ candidate: { uid: 'cand-1' } });
    prisma.role_result.findMany.mockResolvedValue([
      {
        uid: 'result-1',
        role_id: 'role-1',
        score: 86,
        shortlist: null,
        role: {
          name: 'Senior Finance Manager',
          project_id: 'p-1',
          project: { name: 'Cape Town finance' },
        },
      },
    ]);

    await expect(
      service.membership(
        'https://www.linkedin.com/in/thandiwe-nkosi',
        'org-1',
        'user-1',
      ),
    ).resolves.toEqual({
      candidateId: 'cand-1',
      roles: [
        {
          roleId: 'role-1',
          roleName: 'Senior Finance Manager',
          projectId: 'p-1',
          projectName: 'Cape Town finance',
          resultId: 'result-1',
          score: 86,
          shortlisted: false,
        },
      ],
    });
    expect(prisma.role_result.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          candidate_uid: 'cand-1',
          role: {
            project: { organization_id: 'org-1', OR: [{ user_id: 'user-1' }] },
          },
        },
      }),
    );
  });
});
