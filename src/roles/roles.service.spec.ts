import { RolesService } from './roles.service';
import { ProjectsService } from '../projects/projects.service';
import { PrismaService } from '../common/database/prisma.service';
import { RequestException } from '../common/exception/core/ExceptionBase';
import { RoleFilterDto } from './dto/role_filter.dto';
import { GeminiService } from '../services/gemini/gemini.service';
import { reasoningServiceFor } from '../services/reasoning/reasoning.testing';
import { DEFAULT_REASONING_MODEL } from '../services/reasoning/reasoning-model';

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
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    role_result: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    organization_log: {
      create: jest.fn(),
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
    visibleToUser: jest.fn().mockReturnValue({ OR: [{ user_id: 'user-1' }] }),
  } as unknown as jest.Mocked<ProjectsService>;
}

// Gemini is the only thing that can't run locally; by default it finds
// nothing to add, so a save stores no expansions.
function buildGeminiService(): jest.Mocked<GeminiService> {
  return {
    expandSearchTerms: jest.fn().mockResolvedValue({
      byCategory: {},
      model: 'gemini-2.5-flash',
      tokensUsed: 0,
    }),
  } as unknown as jest.Mocked<GeminiService>;
}

describe('RolesService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let projectsService: jest.Mocked<ProjectsService>;
  let geminiService: jest.Mocked<GeminiService>;
  let service: RolesService;

  beforeEach(() => {
    prisma = buildPrisma();
    projectsService = buildProjectsService();
    geminiService = buildGeminiService();
    service = new RolesService(
      prisma as unknown as PrismaService,
      projectsService,
      reasoningServiceFor(geminiService),
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
            include: {
              role_filter_items: { include: { children: true } },
            },
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

  describe('createFilter', () => {
    it('checks the role is visible to the caller, then archives the previous filter set and saves the new one', async () => {
      prisma.roles.findFirst.mockResolvedValue(buildRole());
      prisma.role_filters.create.mockResolvedValue({ uid: 'filter-1' });
      const dto = buildRoleFilterDto({
        filters: [
          {
            category: 'skills',
            list_value: ['React', 'Node.js'],
            priority: 'essential',
          },
        ],
      });

      const result = await service.createFilter(
        'role-1',
        dto,
        'org-1',
        'user-1',
      );

      expect(projectsService.findOneForUser).toHaveBeenCalledWith(
        'project-1',
        'org-1',
        'user-1',
      );
      expect(prisma.role_filters.updateMany).toHaveBeenCalledWith({
        where: { role_id: 'role-1', archived: false },
        data: { archived: true, archived_at: expect.any(Date) },
      });
      expect(prisma.role_filters.create).toHaveBeenCalledWith({
        data: {
          role_id: 'role-1',
          metadata: {},
          role_filter_items: {
            create: [
              {
                category: 'skills',
                value: undefined,
                list_value: ['React', 'Node.js'],
                priority: 'ESSENTIAL',
                non_negotiable: false,
                children: { create: [] },
              },
            ],
          },
        },
        include: { role_filter_items: { include: { children: true } } },
      });
      expect(result).toEqual({ filter: { uid: 'filter-1' }, isFirst: true });
    });

    it('reports isFirst false when a previous filter set existed for the role', async () => {
      prisma.roles.findFirst.mockResolvedValue(buildRole());
      prisma.role_filters.updateMany.mockResolvedValue({ count: 1 });
      prisma.role_filters.create.mockResolvedValue({ uid: 'filter-2' });

      const result = await service.createFilter(
        'role-1',
        buildRoleFilterDto(),
        'org-1',
        'user-1',
      );

      expect(result.isFirst).toBe(false);
    });

    it('nest-creates one role_filter_item per filter item in the dto, in a single role_filters row', async () => {
      prisma.roles.findFirst.mockResolvedValue(buildRole());
      prisma.role_filters.create.mockResolvedValue({ uid: 'filter-1' });
      const dto = buildRoleFilterDto({
        filters: [
          {
            category: 'job_titles',
            list_value: ['Head of Engineering'],
            priority: 'essential',
          },
          {
            category: 'job_titles',
            list_value: ['Tech Lead'],
            priority: 'optional',
          },
        ],
      });

      const result = await service.createFilter(
        'role-1',
        dto,
        'org-1',
        'user-1',
      );

      expect(prisma.role_filters.create).toHaveBeenCalledTimes(1);
      const data = prisma.role_filters.create.mock.calls[0][0].data;
      expect(data.role_filter_items.create).toHaveLength(2);
      expect(result.filter).toEqual({ uid: 'filter-1' });
    });

    it('nest-creates children, mapping boolean_value to the boolean column', async () => {
      prisma.roles.findFirst.mockResolvedValue(buildRole());
      prisma.role_filters.create.mockResolvedValue({ uid: 'filter-1' });
      const dto = buildRoleFilterDto({
        filters: [
          {
            category: 'location',
            value: 'ZA',
            priority: 'essential',
            children: [
              { title: 'province', value: 'GP' },
              { title: 'remote_work', boolean_value: true },
            ],
          },
        ],
      });

      await service.createFilter('role-1', dto, 'org-1', 'user-1');

      const data = prisma.role_filters.create.mock.calls[0][0].data;
      expect(data.role_filter_items.create[0].children).toEqual({
        create: [
          {
            title: 'province',
            value: 'GP',
            list_value: undefined,
            boolean: undefined,
          },
          {
            title: 'remote_work',
            value: undefined,
            list_value: undefined,
            boolean: true,
          },
        ],
      });
    });

    it('defaults non_negotiable to false and lowercases priority into the stored enum', async () => {
      prisma.roles.findFirst.mockResolvedValue(buildRole());
      prisma.role_filters.create.mockResolvedValue({ uid: 'filter-1' });
      const dto = buildRoleFilterDto({
        filters: [
          { category: 'industry', value: 'finance', priority: 'optional' },
        ],
      });

      await service.createFilter('role-1', dto, 'org-1', 'user-1');

      const data = prisma.role_filters.create.mock.calls[0][0].data;
      expect(data.role_filter_items.create[0].priority).toBe('OPTIONAL');
      expect(data.role_filter_items.create[0].non_negotiable).toBe(false);
    });

    it('throws a 404 RequestException when the role does not exist', async () => {
      prisma.roles.findFirst.mockResolvedValue(null);

      const error = await captureError(
        service.createFilter('role-1', buildRoleFilterDto(), 'org-1', 'user-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('Role not found');
      expect(error.getStatus()).toBe(404);
      expect(prisma.role_filters.create).not.toHaveBeenCalled();
    });
  });

  describe('createFilter work types', () => {
    beforeEach(() => {
      prisma.roles.findFirst.mockResolvedValue(buildRole());
      prisma.role_filters.create.mockResolvedValue({ uid: 'filter-2' });
    });
    const storedChildren = () =>
      prisma.role_filters.create.mock.calls[0][0].data.role_filter_items
        .create[0].children.create;

    it('stores work_types as a child on the location row and syncs remote_work', async () => {
      await service.createFilter(
        'role-1',
        {
          filters: [
            {
              category: 'location',
              value: 'ZA',
              priority: 'ESSENTIAL',
              work_types: ['REMOTE', 'HYBRID'],
              children: [
                { title: 'city', value: 'Cape Town' },
                { title: 'remote_work', boolean_value: false },
              ],
            },
          ],
        },
        'org-1',
        'user-1',
      );

      expect(storedChildren()).toEqual([
        {
          title: 'city',
          value: 'Cape Town',
          list_value: undefined,
          boolean: undefined,
        },
        {
          title: 'work_types',
          value: undefined,
          list_value: ['HYBRID', 'REMOTE'],
          boolean: undefined,
        },
        {
          title: 'remote_work',
          value: undefined,
          list_value: undefined,
          boolean: true,
        },
      ]);
    });

    it('leaves children as sent when work_types is omitted', async () => {
      await service.createFilter(
        'role-1',
        {
          filters: [
            {
              category: 'location',
              value: 'ZA',
              priority: 'ESSENTIAL',
              children: [{ title: 'remote_work', boolean_value: true }],
            },
          ],
        },
        'org-1',
        'user-1',
      );

      expect(storedChildren()).toEqual([
        {
          title: 'remote_work',
          value: undefined,
          list_value: undefined,
          boolean: true,
        },
      ]);
    });
  });

  describe('createFilter search-term expansions', () => {
    const founderGroup = {
      seed: 'founder',
      terms: [
        'founder',
        'co-founder',
        'entrepreneur',
        'startup',
        'side hustle',
      ],
    };
    const roleNameGroup = {
      seed: 'Fullstack Developer',
      terms: ['Fullstack Developer', 'Full Stack Engineer'],
    };
    const pythonGroup = { seed: 'Python', terms: ['Python', 'Django'] };
    const founderDto = (skills: string[] = []): RoleFilterDto => ({
      filters: [
        {
          category: 'job_titles',
          list_value: ['founder'],
          priority: 'essential',
        },
        ...(skills.length
          ? [{ category: 'skills', list_value: skills, priority: 'essential' }]
          : []),
      ],
    });
    const savedMetadata = () =>
      prisma.role_filters.create.mock.calls[0][0].data.metadata;

    beforeEach(() => {
      prisma.roles.findFirst.mockResolvedValue(buildRole());
      prisma.role_filters.create.mockResolvedValue({ uid: 'filter-2' });
    });

    it('saves the AI-elaborated OR groups for new titles on the filter set', async () => {
      geminiService.expandSearchTerms.mockResolvedValue({
        byCategory: { job_titles: [founderGroup, roleNameGroup] },
        model: 'gemini-2.5-flash',
        tokensUsed: 42,
      });

      await service.createFilter('role-1', founderDto(), 'org-1', 'user-1');

      // The role name is a seed too: with no alternative_title row the query
      // builder falls back to it.
      expect(geminiService.expandSearchTerms).toHaveBeenCalledWith(
        {
          seeds: { job_titles: ['founder', 'Fullstack Developer'], skills: [] },
          roleName: 'Fullstack Developer',
        },
        { model: DEFAULT_REASONING_MODEL.model },
      );
      expect(savedMetadata()).toEqual({
        criterionExpansions: {
          version: 1,
          generatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
          model: 'gemini-2.5-flash',
          byCategory: { job_titles: [founderGroup, roleNameGroup] },
        },
      });
    });

    it('reuses the saved groups with no AI call when the criteria are unchanged', async () => {
      const previous = {
        criterionExpansions: {
          version: 1,
          generatedAt: '2026-11-01T10:00:00.000Z',
          model: 'gemini-2.5-flash',
          byCategory: {
            job_titles: [founderGroup, roleNameGroup],
            skills: [pythonGroup],
          },
        },
      };
      prisma.role_filters.findFirst.mockResolvedValue({ metadata: previous });

      // Different casing/whitespace is still the same criterion.
      await service.createFilter(
        'role-1',
        founderDto([' python ']),
        'org-1',
        'user-1',
      );

      expect(geminiService.expandSearchTerms).not.toHaveBeenCalled();
      expect(savedMetadata()).toEqual(previous);
    });

    it('asks Gemini only for criteria that have no saved group yet', async () => {
      prisma.role_filters.findFirst.mockResolvedValue({
        metadata: {
          criterionExpansions: {
            version: 1,
            generatedAt: '2026-11-01T10:00:00.000Z',
            model: 'gemini-2.5-flash',
            byCategory: { job_titles: [founderGroup, roleNameGroup] },
          },
        },
      });
      geminiService.expandSearchTerms.mockResolvedValue({
        byCategory: { skills: [pythonGroup] },
        model: 'gemini-2.5-flash',
        tokensUsed: 10,
      });

      await service.createFilter(
        'role-1',
        founderDto(['Python']),
        'org-1',
        'user-1',
      );

      expect(geminiService.expandSearchTerms).toHaveBeenCalledTimes(1);
      expect(geminiService.expandSearchTerms).toHaveBeenCalledWith(
        {
          seeds: { job_titles: [], skills: ['Python'] },
          roleName: 'Fullstack Developer',
        },
        { model: DEFAULT_REASONING_MODEL.model },
      );
      const saved = savedMetadata().criterionExpansions;
      expect(saved.byCategory).toEqual({
        job_titles: [founderGroup, roleNameGroup],
        skills: [pythonGroup],
      });
      expect(saved.generatedAt).not.toBe('2026-11-01T10:00:00.000Z');
    });

    it('drops groups for criteria that were removed, without an AI call', async () => {
      prisma.role_filters.findFirst.mockResolvedValue({
        metadata: {
          criterionExpansions: {
            version: 1,
            generatedAt: '2026-11-01T10:00:00.000Z',
            model: 'gemini-2.5-flash',
            byCategory: {
              job_titles: [founderGroup, roleNameGroup],
              skills: [pythonGroup],
            },
          },
        },
      });

      await service.createFilter('role-1', founderDto(), 'org-1', 'user-1');

      expect(geminiService.expandSearchTerms).not.toHaveBeenCalled();
      expect(savedMetadata()).toEqual({
        criterionExpansions: {
          version: 1,
          generatedAt: '2026-11-01T10:00:00.000Z',
          model: 'gemini-2.5-flash',
          byCategory: { job_titles: [founderGroup, roleNameGroup] },
        },
      });
    });

    it('still saves the filter with literal terms when Gemini fails, and only archives the old set after the AI call', async () => {
      let archivedBeforeAi = false;
      geminiService.expandSearchTerms.mockImplementation(() => {
        archivedBeforeAi = prisma.role_filters.updateMany.mock.calls.length > 0;
        return Promise.reject(new Error('secret prompt text in error'));
      });
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      const result = await service.createFilter(
        'role-1',
        founderDto(['Python']),
        'org-1',
        'user-1',
      );

      expect(archivedBeforeAi).toBe(false);
      expect(prisma.role_filters.updateMany).toHaveBeenCalledTimes(1);
      expect(savedMetadata()).toEqual({});
      expect(result.filter).toEqual({ uid: 'filter-2' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).not.toContain('secret prompt text');
    });

    it('asks again on the next save for a criterion Gemini gave no terms for', async () => {
      // Python came back without alternates, so normalization left it out.
      geminiService.expandSearchTerms.mockResolvedValue({
        byCategory: { job_titles: [founderGroup, roleNameGroup] },
        model: 'gemini-2.5-flash',
        tokensUsed: 42,
      });
      await service.createFilter(
        'role-1',
        founderDto(['Python']),
        'org-1',
        'user-1',
      );
      const firstSave = savedMetadata();
      expect(firstSave.criterionExpansions.byCategory).toEqual({
        job_titles: [founderGroup, roleNameGroup],
      });

      prisma.role_filters.findFirst.mockResolvedValue({ metadata: firstSave });
      geminiService.expandSearchTerms.mockResolvedValue({
        byCategory: { skills: [pythonGroup] },
        model: 'gemini-2.5-flash',
        tokensUsed: 10,
      });
      await service.createFilter(
        'role-1',
        founderDto(['Python']),
        'org-1',
        'user-1',
      );

      expect(geminiService.expandSearchTerms).toHaveBeenLastCalledWith(
        {
          seeds: { job_titles: [], skills: ['Python'] },
          roleName: 'Fullstack Developer',
        },
        { model: DEFAULT_REASONING_MODEL.model },
      );
      expect(
        prisma.role_filters.create.mock.calls[1][0].data.metadata
          .criterionExpansions.byCategory,
      ).toEqual({
        job_titles: [founderGroup, roleNameGroup],
        skills: [pythonGroup],
      });
    });

    it('keeps a valid saved seed-only group and reuses it with no AI call', async () => {
      const previous = {
        criterionExpansions: {
          version: 1,
          generatedAt: '2026-11-01T10:00:00.000Z',
          model: 'gemini-2.5-flash',
          byCategory: {
            job_titles: [
              { seed: 'founder', terms: ['founder'] },
              roleNameGroup,
            ],
          },
        },
      };
      prisma.role_filters.findFirst.mockResolvedValue({ metadata: previous });

      await service.createFilter('role-1', founderDto(), 'org-1', 'user-1');

      expect(geminiService.expandSearchTerms).not.toHaveBeenCalled();
      expect(savedMetadata()).toEqual(previous);
    });

    it('keeps the previous stamp when Gemini returns nothing usable for the new criteria', async () => {
      const previous = {
        criterionExpansions: {
          version: 1,
          generatedAt: '2026-11-01T10:00:00.000Z',
          model: 'gemini-2.5-flash',
          byCategory: { job_titles: [founderGroup, roleNameGroup] },
        },
      };
      prisma.role_filters.findFirst.mockResolvedValue({ metadata: previous });

      await service.createFilter(
        'role-1',
        founderDto(['Python']),
        'org-1',
        'user-1',
      );

      expect(geminiService.expandSearchTerms).toHaveBeenCalledTimes(1);
      expect(savedMetadata()).toEqual(previous);
    });

    it('keeps only the previous groups when Gemini fails for new criteria', async () => {
      const previous = {
        criterionExpansions: {
          version: 1,
          generatedAt: '2026-11-01T10:00:00.000Z',
          model: 'gemini-2.5-flash',
          byCategory: { job_titles: [founderGroup, roleNameGroup] },
        },
      };
      prisma.role_filters.findFirst.mockResolvedValue({ metadata: previous });
      geminiService.expandSearchTerms.mockRejectedValue(new Error('timeout'));
      jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await service.createFilter(
        'role-1',
        founderDto(['Python']),
        'org-1',
        'user-1',
      );

      // No [Python] placeholder, so the next save retries it.
      expect(savedMetadata()).toEqual(previous);
    });

    describe('recruiter-edited groups', () => {
      const previous = {
        criterionExpansions: {
          version: 1,
          generatedAt: '2026-11-01T10:00:00.000Z',
          model: 'gemini-2.5-flash',
          byCategory: {
            job_titles: [founderGroup, roleNameGroup],
            skills: [pythonGroup],
          },
        },
      };

      it('saves edited groups as given, seed first, with no AI call', async () => {
        prisma.role_filters.findFirst.mockResolvedValue({ metadata: previous });

        await service.createFilter(
          'role-1',
          {
            ...founderDto(['Python']),
            criterion_expansions: {
              job_titles: [
                { seed: 'Founder', terms: ['co-founder', 'owner', 'founder'] },
              ],
              skills: [{ seed: 'python', terms: ['FastAPI'] }],
            },
          },
          'org-1',
          'user-1',
        );

        expect(geminiService.expandSearchTerms).not.toHaveBeenCalled();
        expect(savedMetadata().criterionExpansions).toEqual({
          ...previous.criterionExpansions,
          byCategory: {
            job_titles: [
              { seed: 'founder', terms: ['founder', 'co-founder', 'owner'] },
              roleNameGroup,
            ],
            skills: [{ seed: 'Python', terms: ['Python', 'FastAPI'] }],
          },
        });
      });

      it('keeps a group cleared down to its seed, so it stays literal and is not regenerated', async () => {
        await service.createFilter(
          'role-1',
          {
            ...founderDto(),
            criterion_expansions: {
              job_titles: [
                { seed: 'founder', terms: [] },
                { seed: 'Fullstack Developer', terms: ['Full Stack Engineer'] },
              ],
            },
          },
          'org-1',
          'user-1',
        );

        expect(geminiService.expandSearchTerms).not.toHaveBeenCalled();
        expect(savedMetadata().criterionExpansions).toEqual({
          version: 1,
          generatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
          model: 'recruiter-edited',
          byCategory: {
            job_titles: [
              { seed: 'founder', terms: ['founder'] },
              roleNameGroup,
            ],
          },
        });
      });

      it('asks Gemini only for seeds that are neither edited nor saved, and ignores edits for removed seeds', async () => {
        geminiService.expandSearchTerms.mockResolvedValue({
          byCategory: { skills: [{ seed: 'Go', terms: ['Go', 'Golang'] }] },
          model: 'gemini-2.5-flash',
          tokensUsed: 9,
        });

        await service.createFilter(
          'role-1',
          {
            ...founderDto(['Go']),
            criterion_expansions: {
              job_titles: [
                { seed: 'founder', terms: ['co-founder'] },
                { seed: 'Fullstack Developer', terms: [] },
                { seed: 'CEO', terms: ['Chief Executive'] },
              ],
            },
          },
          'org-1',
          'user-1',
        );

        expect(geminiService.expandSearchTerms).toHaveBeenCalledWith(
          {
            seeds: { job_titles: [], skills: ['Go'] },
            roleName: 'Fullstack Developer',
          },
          { model: DEFAULT_REASONING_MODEL.model },
        );
        expect(savedMetadata().criterionExpansions.byCategory).toEqual({
          job_titles: [
            { seed: 'founder', terms: ['founder', 'co-founder'] },
            { seed: 'Fullstack Developer', terms: ['Fullstack Developer'] },
          ],
          skills: [{ seed: 'Go', terms: ['Go', 'Golang'] }],
        });
      });
    });

    it('ignores unreadable previous metadata and treats every criterion as new', async () => {
      prisma.role_filters.findFirst.mockResolvedValue({
        metadata: { criterionExpansions: { version: 2 } },
      });

      await service.createFilter('role-1', founderDto(), 'org-1', 'user-1');

      expect(geminiService.expandSearchTerms).toHaveBeenCalledWith(
        {
          seeds: { job_titles: ['founder', 'Fullstack Developer'], skills: [] },
          roleName: 'Fullstack Developer',
        },
        { model: DEFAULT_REASONING_MODEL.model },
      );
    });
  });

  describe('getRoleResult', () => {
    it("fetches a role_result scoped to the caller's organization and the role, including its candidate and their experience/education/sources", async () => {
      const result = {
        uid: 'result-1',
        role_id: 'role-1',
        candidate: { uid: 'candidate-1' },
      };
      prisma.role_result.findFirst.mockResolvedValue(result);

      const found = await service.getRoleResult('result-1', 'org-1', 'role-1');

      expect(prisma.role_result.findFirst).toHaveBeenCalledWith({
        where: {
          uid: 'result-1',
          role_id: 'role-1',
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
        service.getRoleResult('result-1', 'org-1', 'role-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('Role result not found');
      expect(error.getStatus()).toBe(404);
    });
  });

  describe('shortlistCandidate', () => {
    it("updates a role_result scoped to the caller's organization", async () => {
      prisma.role_result.findFirst.mockResolvedValue({ uid: 'result-1' });
      const updated = { uid: 'result-1', shortlist: true };
      prisma.role_result.update.mockResolvedValue(updated);

      const result = await service.shortlistCandidate(
        'result-1',
        true,
        'org-1',
      );

      expect(prisma.role_result.findFirst).toHaveBeenCalledWith({
        where: {
          uid: 'result-1',
          role: { project: { organization_id: 'org-1' } },
        },
      });
      expect(prisma.role_result.update).toHaveBeenCalledWith({
        where: { uid: 'result-1' },
        data: { shortlist: true },
      });
      expect(result).toBe(updated);
    });

    it('throws a 404 RequestException rather than updating when the role_result belongs to a different organization (IDOR guard)', async () => {
      prisma.role_result.findFirst.mockResolvedValue(null);

      const error = await captureError(
        service.shortlistCandidate('result-1', true, 'org-1'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.message).toBe('Role result not found');
      expect(error.getStatus()).toBe(404);
      expect(prisma.role_result.update).not.toHaveBeenCalled();
    });

    it("logs CANDIDATE_SHORTLISTED under the caller's organization when shortlisting", async () => {
      prisma.role_result.findFirst.mockResolvedValue({ uid: 'result-1' });
      prisma.role_result.update.mockResolvedValue({ uid: 'result-1' });

      await service.shortlistCandidate('result-1', true, 'org-1');

      expect(prisma.organization_log.create).toHaveBeenCalledWith({
        data: {
          type: 'CANDIDATE_SHORTLISTED',
          message: 'Candidate shortlisted for role result result-1',
          role_result_id: 'result-1',
          organization_id: 'org-1',
        },
      });
    });

    it('logs CANDIDATE_UNSHORTLISTED when un-shortlisting', async () => {
      prisma.role_result.findFirst.mockResolvedValue({ uid: 'result-1' });
      prisma.role_result.update.mockResolvedValue({ uid: 'result-1' });

      await service.shortlistCandidate('result-1', false, 'org-1');

      expect(prisma.organization_log.create).toHaveBeenCalledWith({
        data: {
          type: 'CANDIDATE_UNSHORTLISTED',
          message: 'Candidate unshortlisted for role result result-1',
          role_result_id: 'result-1',
          organization_id: 'org-1',
        },
      });
    });
  });

  describe('markNotSuitable', () => {
    it("marks a result of the caller's role not suitable and dates it", async () => {
      prisma.role_result.findFirst.mockResolvedValue({
        uid: 'result-1',
        shortlist: false,
      });
      prisma.role_result.update.mockImplementation(({ data }) => ({
        uid: 'result-1',
        ...data,
      }));

      const result = await service.markNotSuitable(
        'result-1',
        'role-1',
        true,
        'org-1',
      );

      expect(prisma.role_result.findFirst).toHaveBeenCalledWith({
        where: {
          uid: 'result-1',
          role_id: 'role-1',
          role: { project: { organization_id: 'org-1' } },
        },
        select: { uid: true, shortlist: true },
      });
      expect(result.not_suitable).toBe(true);
      expect(result.not_suitable_date).toBeInstanceOf(Date);
      expect(result.shortlist).toBe(false);
      // Wasn't shortlisted, so there's nothing to log.
      expect(prisma.organization_log.create).not.toHaveBeenCalled();
    });

    it('takes a shortlisted result off the shortlist and logs it like an unshortlist', async () => {
      prisma.role_result.findFirst.mockResolvedValue({
        uid: 'result-1',
        shortlist: true,
      });
      prisma.role_result.update.mockImplementation(({ data }) => data);

      const result = await service.markNotSuitable(
        'result-1',
        'role-1',
        true,
        'org-1',
      );

      expect(result).toEqual(
        expect.objectContaining({ not_suitable: true, shortlist: false }),
      );
      expect(prisma.organization_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'CANDIDATE_UNSHORTLISTED',
          role_result_id: 'result-1',
          organization_id: 'org-1',
        }),
      });
    });

    it('undoes the mark and clears its date without re-shortlisting', async () => {
      prisma.role_result.findFirst.mockResolvedValue({
        uid: 'result-1',
        shortlist: false,
      });
      prisma.role_result.update.mockImplementation(({ data }) => data);

      const result = await service.markNotSuitable(
        'result-1',
        'role-1',
        false,
        'org-1',
      );

      expect(result).toEqual({ not_suitable: false, not_suitable_date: null });
    });

    it("404s without writing for a result outside the caller's role or org", async () => {
      prisma.role_result.findFirst.mockResolvedValue(null);

      const error = await captureError(
        service.markNotSuitable('result-1', 'role-1', true, 'org-2'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.getStatus()).toBe(404);
      expect(prisma.role_result.update).not.toHaveBeenCalled();
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

    it('saves the descriptive details, clearing an emptied one, and nothing else', async () => {
      prisma.roles.findFirst.mockResolvedValue(buildRole());
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ user_id: 'user-1' }) as any,
      );
      prisma.roles.update.mockResolvedValue(buildRole());

      await service.update(
        'role-1',
        {
          description: 'Leads the close.',
          location: 'Cape Town, ZA',
          seniority: '',
          hiring_manager: 'Kyle Winter',
        },
        'user-1',
        'org-1',
      );

      expect(prisma.roles.update).toHaveBeenCalledWith({
        where: { uid: 'role-1' },
        data: {
          description: 'Leads the close.',
          location: 'Cape Town, ZA',
          seniority: null,
          hiring_manager: 'Kyle Winter',
        },
      });
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

  describe('searchHistory', () => {
    it("reads the role's searched filter sets in projects the caller can see, and their suitable results", async () => {
      prisma.role_filters.findMany.mockResolvedValue([
        {
          uid: 'f1',
          role_id: 'role-1',
          archived: false,
          search_run_date: new Date('2026-11-23T14:32:00Z'),
          search_run_by: 'Kyle Winter',
          search_run_by_id: 'user-1',
          metadata: null,
          role: { name: 'CFO', project_id: 'p1', project: { name: 'P' } },
          role_filter_items: [],
        },
      ]);
      prisma.role_result.findMany.mockResolvedValue([
        { filter_id: 'f1', candidate_uid: 'c1', score: 90 },
      ]);

      const runs = await service.searchHistory('org-1', 'user-1', 'role-1');

      expect(prisma.role_filters.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            search_run_date: { not: null },
            role_id: 'role-1',
            role: {
              project: {
                organization_id: 'org-1',
                OR: [{ user_id: 'user-1' }],
              },
            },
          },
        }),
      );
      expect(prisma.role_result.findMany).toHaveBeenCalledWith({
        where: {
          filter_id: { in: ['f1'] },
          OR: [{ not_suitable: false }, { not_suitable: null }],
        },
        select: { filter_id: true, candidate_uid: true, score: true },
      });
      expect(runs).toEqual([
        expect.objectContaining({
          id: 'f1',
          current: true,
          candidates: 1,
          topScore: 90,
        }),
      ]);
    });

    it('covers every role in the org when no role is given', async () => {
      prisma.role_result.findMany.mockResolvedValue([]);
      await service.searchHistory('org-1', 'user-1');

      const { where } = prisma.role_filters.findMany.mock.calls[0][0];
      expect(where).not.toHaveProperty('role_id');
    });
  });

  describe('listResults', () => {
    it("lists one past run's results when asked for that run", async () => {
      prisma.role_result.findMany.mockResolvedValue([]);

      await service.listResults('role-1', 'f-old');

      expect(prisma.role_result.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role_id: 'role-1', role_filter: { uid: 'f-old' } },
        }),
      );
    });

    it("lists the active filter set's results, best score first, with each candidate's sources", async () => {
      prisma.role_result.findMany.mockResolvedValue([{ uid: 'result-1' }]);

      await expect(service.listResults('role-1')).resolves.toEqual([
        { uid: 'result-1' },
      ]);
      expect(prisma.role_result.findMany).toHaveBeenCalledWith({
        where: { role_id: 'role-1', role_filter: { archived: false } },
        include: { candidate: { include: { sources: true } } },
        orderBy: [
          { score: { sort: 'desc', nulls: 'last' } },
          { created: 'asc' },
        ],
      });
    });
  });
});
