import type { ClerkAuthContext } from '../../auth/auth.types';
import type { RocketReachLookupsService } from '../../services/rocket-reach/rocket-reach-lookups.service';
import { CreditsController } from './credits.controller';
import type { CreditsService } from './credits.service';

const auth = (overrides: Partial<ClerkAuthContext> = {}): ClerkAuthContext =>
  ({
    userId: 'user-1',
    orgId: 'org-1',
    claims: {},
    ...overrides,
  }) as ClerkAuthContext;

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    const e = error as {
      getStatus(): number;
      options?: { description?: string };
    };
    return [e.getStatus(), e.options?.description];
  }
  throw new Error('Expected a throw');
};

describe('CreditsController', () => {
  const lookups = {
    list: jest.fn().mockResolvedValue({ totals: {}, lookups: [] }),
  };
  const controller = new CreditsController(
    {} as CreditsService,
    lookups as unknown as RocketReachLookupsService,
    {
      monthlyAllowance: 50,
      costPerRun: 1,
      adminUserIds: ['staff-1'],
    },
  );

  describe('purchase', () => {
    it('is for org admins only', () => {
      expect(
        codeOf(() => controller.purchase(auth({ orgRole: 'org:member' }))),
      ).toEqual([403, 'ORG_ADMIN_REQUIRED']);
    });

    it('isn’t available yet, even to an admin', () => {
      expect(
        codeOf(() => controller.purchase(auth({ orgRole: 'org:admin' }))),
      ).toEqual([501, 'CREDIT_PURCHASE_NOT_AVAILABLE']);
    });
  });

  describe('RocketReach lookups', () => {
    it('is staff only, even for an org admin', () => {
      expect(
        codeOf(() =>
          controller.rocketReachLookups({}, auth({ orgRole: 'org:admin' })),
        ),
      ).toEqual([403, 'CREDITS_ADMIN_REQUIRED']);
      expect(lookups.list).not.toHaveBeenCalled();
    });

    it('passes staff’s filters through, dates parsed', async () => {
      await controller.rocketReachLookups(
        {
          organizationId: 'org-2',
          candidateId: 'c0ffee00-0000-4000-8000-000000000000',
          from: '2026-11-01T00:00:00Z',
          to: '2026-12-01T00:00:00Z',
          limit: 50,
        },
        auth({ userId: 'staff-1' }),
      );

      expect(lookups.list).toHaveBeenCalledWith({
        organizationId: 'org-2',
        candidateId: 'c0ffee00-0000-4000-8000-000000000000',
        from: new Date('2026-11-01T00:00:00Z'),
        to: new Date('2026-12-01T00:00:00Z'),
        limit: 50,
      });
    });
  });
});
