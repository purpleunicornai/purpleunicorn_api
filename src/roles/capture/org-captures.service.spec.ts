import type { PrismaService } from '../../common/database/prisma.service';
import { ExtensionCaptureStatus } from '../../generated/prisma/client';
import type { SyncedCaptureDto } from './org-captures.dto';
import { OrgCapturesService } from './org-captures.service';

const NOW = new Date('2026-11-18T10:00:00Z');
const row = (overrides: object = {}) => ({
  uid: 'cap-1',
  organization_id: 'org-1',
  captured_by: 'user-1',
  linkedin_slug: 'jane-doe',
  linkedin_url: 'https://www.linkedin.com/in/jane-doe',
  profile: { name: 'Jane Doe' },
  captured_at: new Date('2026-11-18T09:00:00Z'),
  status: ExtensionCaptureStatus.CAPTURED,
  role_ids: [] as string[],
  expires_at: new Date('2026-12-18T09:00:00Z'),
  ...overrides,
});
const capture = (
  overrides: Partial<SyncedCaptureDto> = {},
): SyncedCaptureDto => ({
  linkedinUrl: 'https://za.linkedin.com/in/jane-doe/',
  name: 'Jane Doe',
  capturedAt: '2026-11-18T09:00:00Z',
  ...overrides,
});

function setup(existing: ReturnType<typeof row> | null = null) {
  const table = {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([row()]),
    findUnique: jest.fn().mockResolvedValue(existing),
    upsert: jest.fn().mockResolvedValue(row()),
    update: jest
      .fn()
      .mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({ ...row(), ...data }),
      ),
  };
  const service = new OrgCapturesService({
    extension_capture: table,
  } as unknown as PrismaService);
  return { service, table };
}

describe('OrgCapturesService', () => {
  it('purges the org’s expired captures before a sync, then saves a new one under its canonical URL', async () => {
    const { service, table } = setup();

    const [synced] = await service.sync('org-1', 'user-1', [capture()], NOW);

    expect(table.deleteMany).toHaveBeenCalledWith({
      where: {
        organization_id: 'org-1',
        status: ExtensionCaptureStatus.CAPTURED,
        expires_at: { lt: NOW },
      },
    });
    expect(table.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          organization_id: 'org-1',
          captured_by: 'user-1',
          linkedin_slug: 'jane-doe',
          linkedin_url: 'https://www.linkedin.com/in/jane-doe',
          expires_at: new Date('2026-12-18T09:00:00Z'),
        }) as object,
      }),
    );
    expect(synced).toMatchObject({
      slug: 'jane-doe',
      mine: true,
      status: 'captured',
    });
  });

  it('does nothing for a capture it already has (a retried sync)', async () => {
    const { service, table } = setup(row());

    await service.sync('org-1', 'user-1', [capture()], NOW);

    expect(table.upsert).not.toHaveBeenCalled();
    expect(table.update).not.toHaveBeenCalled();
  });

  it('clamps a capture dated in the future to now', async () => {
    const { service, table } = setup(row());

    await service.sync(
      'org-1',
      'user-2',
      [capture({ capturedAt: '2027-01-01T00:00:00Z' })],
      NOW,
    );

    expect(table.update).toHaveBeenCalledWith({
      where: { uid: 'cap-1' },
      data: expect.objectContaining({
        captured_at: NOW,
        captured_by: 'user-2',
      }) as object,
    });
  });

  it('rejects a URL that isn’t a LinkedIn profile', async () => {
    const { service } = setup();
    await expect(
      service.sync(
        'org-1',
        'user-1',
        [capture({ linkedinUrl: 'https://example.com/in/x' })],
        NOW,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('lists the org’s captures without expired unassigned ones', async () => {
    const { service, table } = setup();

    const list = await service.list('org-1', 'user-2', NOW);

    expect(table.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organization_id: 'org-1',
          NOT: {
            organization_id: 'org-1',
            status: ExtensionCaptureStatus.CAPTURED,
            expires_at: { lt: NOW },
          },
        },
      }),
    );
    expect(list[0]).toMatchObject({ mine: false, capturedBy: 'user-1' });
  });

  it('keeps a capture once it is in a role, adding each role once', async () => {
    const { service, table } = setup(row({ role_ids: ['role-1'] }));
    const profile = { linkedinUrl: capture().linkedinUrl, name: 'Jane Doe' };

    await service.markAssigned('org-1', 'user-1', profile, 'role-1', NOW);

    expect(table.update).toHaveBeenLastCalledWith({
      where: { uid: 'cap-1' },
      data: {
        status: ExtensionCaptureStatus.ASSIGNED,
        expires_at: null,
        role_ids: ['role-1'],
      },
    });
  });

  it('clears only the caller’s unassigned captures', async () => {
    const { service, table } = setup();

    await service.clearMine('org-1', 'user-1');

    expect(table.deleteMany).toHaveBeenCalledWith({
      where: {
        organization_id: 'org-1',
        captured_by: 'user-1',
        status: ExtensionCaptureStatus.CAPTURED,
      },
    });
  });
});
