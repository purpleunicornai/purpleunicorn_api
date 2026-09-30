import { LogsService } from './logs.service';
import { PrismaService } from '../database/prisma.service';

function buildPrisma() {
  return {
    organization_log: {
      create: jest.fn(),
    },
  };
}

describe('LogsService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: LogsService;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new LogsService(prisma as unknown as PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('log', () => {
    it('creates an organization_log row with the given fields', async () => {
      prisma.organization_log.create.mockResolvedValue({ uid: 'log-1' });

      await service.log({
        organization_id: 'org-1',
        user_id: 'user-1',
        type: 'PROJECT_CREATED',
        message: 'Created project "Sanlam"',
      });

      expect(prisma.organization_log.create).toHaveBeenCalledWith({
        data: {
          organization_id: 'org-1',
          user_id: 'user-1',
          type: 'PROJECT_CREATED',
          message: 'Created project "Sanlam"',
        },
      });
    });

    it('passes through optional linkage and token fields when provided', async () => {
      prisma.organization_log.create.mockResolvedValue({ uid: 'log-1' });

      await service.log({
        organization_id: 'org-1',
        type: 'ROLE_SEARCH',
        role_id: 'role-1',
        tokens_used: 250,
      });

      expect(prisma.organization_log.create).toHaveBeenCalledWith({
        data: {
          organization_id: 'org-1',
          type: 'ROLE_SEARCH',
          role_id: 'role-1',
          tokens_used: 250,
        },
      });
    });

    it('does not throw when the write fails', async () => {
      prisma.organization_log.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.log({ organization_id: 'org-1', type: 'PROJECT_CREATED' }),
      ).resolves.toBeUndefined();
    });
  });
});
