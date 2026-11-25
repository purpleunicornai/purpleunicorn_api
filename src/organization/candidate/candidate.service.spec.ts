import type { PrismaService } from '../../common/database/prisma.service';
import { CandidateService } from './candidate.service';

const UPDATED_AT = new Date('2026-11-18T12:00:00.000Z');

function setup(found: unknown) {
  const prisma = {
    candidate: { findFirst: jest.fn().mockResolvedValue(found) },
  };
  return {
    prisma,
    service: new CandidateService(prisma as unknown as PrismaService),
  };
}

describe('CandidateService.contactDetails', () => {
  it('returns what’s on file, looking only within the org’s own results', async () => {
    const { service, prisma } = setup({
      uid: 'candidate-1',
      email: 'jane@acme.com',
      phone: '+44 7700 900000',
      rocketreach_profile_id: '42',
      contact_info_last_updated: UPDATED_AT,
    });

    await expect(
      service.contactDetails('org-1', 'candidate-1'),
    ).resolves.toEqual({
      candidateId: 'candidate-1',
      email: 'jane@acme.com',
      phone: '+44 7700 900000',
      rocketReachProfileId: '42',
      contactInfoUpdatedAt: UPDATED_AT.toISOString(),
    });
    expect(prisma.candidate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          uid: 'candidate-1',
          role_results: {
            some: { role: { project: { organization_id: 'org-1' } } },
          },
        },
      }),
    );
  });

  it('returns nulls when research hasn’t found anything yet', async () => {
    const { service } = setup({
      uid: 'candidate-1',
      email: null,
      phone: null,
      rocketreach_profile_id: null,
      contact_info_last_updated: null,
    });

    await expect(
      service.contactDetails('org-1', 'candidate-1'),
    ).resolves.toMatchObject({ email: null, contactInfoUpdatedAt: null });
  });

  it('404s for a candidate outside the org', async () => {
    const { service } = setup(null);

    await expect(
      service.contactDetails('org-2', 'candidate-1'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
