import { ExistingCandidateSearchService } from './existing-candidate-search.service';
import { PrismaService } from '../../common/database/prisma.service';
import { ParsedRoleFilters } from './role-filter-parser';

function buildFilters(
  overrides: Partial<ParsedRoleFilters> = {},
): ParsedRoleFilters {
  return {
    jobTitles: [],
    skills: [],
    languages: [],
    companies: [],
    education: [],
    ...overrides,
  };
}

function buildPrisma() {
  return {
    candidate: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('ExistingCandidateSearchService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: ExistingCandidateSearchService;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new ExistingCandidateSearchService(
      prisma as unknown as PrismaService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findCandidates', () => {
    it('returns an empty array without querying when the filters carry no searchable criteria', async () => {
      const result = await service.findCandidates('role-1', buildFilters());

      expect(prisma.candidate.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('excludes candidates already linked to this role', async () => {
      await service.findCandidates(
        'role-1',
        buildFilters({
          skills: [
            {
              value: ['TypeScript'],
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
        }),
      );

      expect(prisma.candidate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role_results: { none: { role_id: 'role-1' } },
          }),
        }),
      );
    });

    it('includes experience and education so the result is directly scoreable', async () => {
      await service.findCandidates(
        'role-1',
        buildFilters({
          skills: [
            {
              value: ['TypeScript'],
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
        }),
      );

      expect(prisma.candidate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { experience: true, education: true },
        }),
      );
    });

    it('caps the query at a fixed pool size regardless of how big the table is', async () => {
      await service.findCandidates(
        'role-1',
        buildFilters({
          skills: [
            {
              value: ['TypeScript'],
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
        }),
      );

      expect(prisma.candidate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('ORs together a matching condition per selected category', async () => {
      await service.findCandidates(
        'role-1',
        buildFilters({
          jobTitles: [
            {
              value: { titles: ['Software Engineer'], option: 'main_title' },
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
          skills: [
            {
              value: ['TypeScript', 'Go'],
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
          languages: [
            { value: ['English'], priority: 'OPTIONAL', nonNegotiable: false },
          ],
          companies: [
            {
              value: { names: ['Acme'], type: 'include' },
              priority: 'OPTIONAL',
              nonNegotiable: false,
            },
          ],
          location: {
            value: {
              countryCode: 'GB',
              regions: [],
              remoteWork: false,
              workAuthorizationRequired: false,
            },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
          experience: {
            value: { minYears: 5 },
            priority: 'ESSENTIAL',
            nonNegotiable: false,
          },
        }),
      );

      const where = prisma.candidate.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual(
        expect.arrayContaining([
          {
            current_title: { equals: 'Software Engineer', mode: 'insensitive' },
          },
          { skills: { hasSome: ['TypeScript', 'Go'] } },
          { languages: { hasSome: ['English'] } },
          { current_location_country_code: 'GB' },
          { current_company: { equals: 'Acme', mode: 'insensitive' } },
          { experience_years: { gte: 5 } },
        ]),
      );
    });

    it('excludes a company condition for an exclude-type companies row', async () => {
      await service.findCandidates(
        'role-1',
        buildFilters({
          companies: [
            {
              value: { names: ['Acme'], type: 'exclude' },
              priority: 'OPTIONAL',
              nonNegotiable: false,
            },
          ],
        }),
      );

      expect(prisma.candidate.findMany).not.toHaveBeenCalled();
    });

    it('returns whatever Prisma resolves', async () => {
      const candidates = [{ uid: 'candidate-1' }];
      prisma.candidate.findMany.mockResolvedValue(candidates);

      const result = await service.findCandidates(
        'role-1',
        buildFilters({
          skills: [
            {
              value: ['TypeScript'],
              priority: 'ESSENTIAL',
              nonNegotiable: false,
            },
          ],
        }),
      );

      expect(result).toBe(candidates);
    });
  });
});
