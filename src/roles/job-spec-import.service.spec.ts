import { JobSpecImportService } from './job-spec-import.service';
import { PrismaService } from '../common/database/prisma.service';
import { GeminiService } from '../services/gemini/gemini.service';
import { RequestException } from '../common/exception/core/ExceptionBase';

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

function buildGeminiService(): jest.Mocked<GeminiService> {
  return {
    parseJobSpec: jest.fn().mockResolvedValue({ items: [], tokensUsed: 0 }),
  } as unknown as jest.Mocked<GeminiService>;
}

function buildPrisma() {
  return {
    job_spec_import: {
      create: jest.fn(),
    },
  };
}

describe('JobSpecImportService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let geminiService: jest.Mocked<GeminiService>;
  let service: JobSpecImportService;

  beforeEach(() => {
    prisma = buildPrisma();
    geminiService = buildGeminiService();
    service = new JobSpecImportService(
      prisma as unknown as PrismaService,
      geminiService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('importJobSpec', () => {
    it('parses pasted text directly and persists the result scoped to the role, with its items and children', async () => {
      geminiService.parseJobSpec.mockResolvedValue({
        items: [
          {
            category: 'skills',
            list_value: ['TypeScript', 'React'],
            priority: 'ESSENTIAL',
            non_negotiable: false,
            children: [],
          },
          {
            category: 'location',
            value: 'GB',
            priority: 'ESSENTIAL',
            non_negotiable: true,
            children: [{ title: 'remote_work', boolean_value: true }],
          },
        ],
        tokensUsed: 150,
      });
      const created = { uid: 'import-1' };
      prisma.job_spec_import.create.mockResolvedValue(created);

      const result = await service.importJobSpec(
        'role-1',
        { text: 'Senior Engineer, London, TypeScript required.' },
        'user-1',
        'Jane Admin',
      );

      expect(geminiService.parseJobSpec).toHaveBeenCalledWith(
        'Senior Engineer, London, TypeScript required.',
      );
      expect(prisma.job_spec_import.create).toHaveBeenCalledWith({
        data: {
          role_id: 'role-1',
          original_text: 'Senior Engineer, London, TypeScript required.',
          created_by: 'Jane Admin',
          created_by_id: 'user-1',
          ai_model_used: 'gemini-2.5-flash',
          tokens_used: 150,
          role_filter_items: {
            create: [
              {
                category: 'skills',
                value: undefined,
                list_value: ['TypeScript', 'React'],
                priority: 'ESSENTIAL',
                non_negotiable: false,
                children: { create: [] },
              },
              {
                category: 'location',
                value: 'GB',
                list_value: [],
                priority: 'ESSENTIAL',
                non_negotiable: true,
                children: {
                  create: [
                    {
                      title: 'remote_work',
                      value: undefined,
                      list_value: [],
                      boolean: true,
                    },
                  ],
                },
              },
            ],
          },
        },
        include: { role_filter_items: { include: { children: true } } },
      });
      expect(result).toBe(created);
    });

    it('attaches a default 5-year UTC date range to a companies item', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-24T13:00:00+05:00'));
      geminiService.parseJobSpec.mockResolvedValue({
        items: [
          {
            category: 'companies',
            list_value: ['Acme Corp'],
            priority: 'ESSENTIAL',
            non_negotiable: false,
            children: [],
          },
        ],
        tokensUsed: 50,
      });
      prisma.job_spec_import.create.mockResolvedValue({ uid: 'import-1' });

      await service.importJobSpec(
        'role-1',
        { text: 'Must have worked at Acme Corp.' },
        'user-1',
        'Jane Admin',
      );

      const children =
        prisma.job_spec_import.create.mock.calls[0][0].data.role_filter_items
          .create[0].children.create;
      const startDate = children.find((c: any) => c.title === 'start_date');
      const endDate = children.find((c: any) => c.title === 'end_date');

      // The test's system clock is set to a +05:00 local offset — if the
      // service ever formats in local time instead of UTC, these would
      // carry a "+05:00" offset (or a shifted clock-hour) instead of "Z".
      expect(startDate.value).toBe('2021-10-24T08:00:00.000Z');
      expect(endDate.value).toBe('2026-10-24T08:00:00.000Z');

      jest.useRealTimers();
    });

    it('throws a 400 RequestException when the uploaded file exceeds 5MB', async () => {
      const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 'a').toString(
        'base64',
      );

      const error = await captureError(
        service.importJobSpec(
          'role-1',
          { file_base64: oversized, file_name: 'job-spec.txt' },
          'user-1',
          'Jane Admin',
        ),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.getStatus()).toBe(400);
      expect(error.message).toBe(
        'File exceeds the maximum allowed size of 5MB',
      );
      expect(geminiService.parseJobSpec).not.toHaveBeenCalled();
    });

    it('accepts a file at exactly the 5MB limit', async () => {
      prisma.job_spec_import.create.mockResolvedValue({ uid: 'import-1' });
      const atLimit = Buffer.alloc(5 * 1024 * 1024, 'a').toString('base64');

      await service.importJobSpec(
        'role-1',
        { file_base64: atLimit, file_name: 'job-spec.txt' },
        'user-1',
        'Jane Admin',
      );

      expect(geminiService.parseJobSpec).toHaveBeenCalled();
    });

    it('decodes a plain .txt file upload before parsing', async () => {
      prisma.job_spec_import.create.mockResolvedValue({ uid: 'import-1' });
      const base64 = Buffer.from('Plain text job spec.', 'utf-8').toString(
        'base64',
      );

      await service.importJobSpec(
        'role-1',
        { file_base64: base64, file_name: 'job-spec.txt' },
        'user-1',
        'Jane Admin',
      );

      expect(geminiService.parseJobSpec).toHaveBeenCalledWith(
        'Plain text job spec.',
      );
    });

    it('throws a 400 RequestException when neither text nor file_base64 is provided', async () => {
      const error = await captureError(
        service.importJobSpec('role-1', {}, 'user-1', 'Jane Admin'),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.getStatus()).toBe(400);
      expect(error.message).toBe('Either text or file_base64 must be provided');
      expect(geminiService.parseJobSpec).not.toHaveBeenCalled();
    });

    it('throws a 400 RequestException for an unsupported file extension', async () => {
      const base64 = Buffer.from('data', 'utf-8').toString('base64');

      const error = await captureError(
        service.importJobSpec(
          'role-1',
          { file_base64: base64, file_name: 'job-spec.exe' },
          'user-1',
          'Jane Admin',
        ),
      );

      expect(error).toBeInstanceOf(RequestException);
      expect(error.getStatus()).toBe(400);
      expect(geminiService.parseJobSpec).not.toHaveBeenCalled();
    });

    it('prefers pasted text over a file when both are somehow provided', async () => {
      prisma.job_spec_import.create.mockResolvedValue({ uid: 'import-1' });
      const base64 = Buffer.from('file text', 'utf-8').toString('base64');

      await service.importJobSpec(
        'role-1',
        { text: 'pasted text', file_base64: base64, file_name: 'spec.txt' },
        'user-1',
        'Jane Admin',
      );

      expect(geminiService.parseJobSpec).toHaveBeenCalledWith('pasted text');
    });
  });
});
