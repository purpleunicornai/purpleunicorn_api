import type { CreditsService } from '../../organization/credits/credits.service';
import type { RocketReachLookupsService } from '../../services/rocket-reach/rocket-reach-lookups.service';
import type {
  RocketReachLookup,
  RocketReachPerson,
  RocketReachService,
} from '../../services/rocket-reach/rocket-reach.service';
import type { SearchService } from '../search/search.service';
import { PaidResearchService } from './paid-research.service';

const CHARGE = { uid: 'charge-1', organization_id: 'org-1', amount: -1 };
const REFUND = { uid: 'refund-1', organization_id: 'org-1', amount: 1 };
const QUERY = { type: 'linkedin_url' as const, params: { linkedin_url: 'x' } };
const person = { id: 9, status: 'complete' } as RocketReachPerson;
const jane = {
  uid: 'candidate-1',
  first_name: 'Jane',
  last_name: 'Doe',
  sources: [],
} as never;

function setup({
  enabled = true,
  canLookUp = true,
  result = { outcome: 'not_found', query: QUERY },
  cached = null,
}: {
  enabled?: boolean;
  canLookUp?: boolean;
  result?: RocketReachLookup;
  cached?: RocketReachPerson | null;
} = {}) {
  const credits = {
    costPerRun: 1,
    balance: jest.fn().mockResolvedValue(10),
    charge: jest.fn().mockResolvedValue(CHARGE),
    refund: jest.fn().mockResolvedValue(REFUND),
  };
  const search = {
    deepSearchCandidate: jest.fn().mockResolvedValue({ uid: 'candidate-1' }),
  };
  const rocketReach = {
    enabled,
    canLookUp: jest.fn().mockReturnValue(canLookUp),
    lookup: jest.fn().mockResolvedValue(result),
  };
  const lookups = {
    recentProfile: jest.fn().mockResolvedValue(cached),
    record: jest.fn().mockResolvedValue({}),
  };
  const service = new PaidResearchService(
    credits as unknown as CreditsService,
    search as unknown as SearchService,
    rocketReach as unknown as RocketReachService,
    lookups as unknown as RocketReachLookupsService,
  );
  const run = () =>
    service.research({
      organizationId: 'org-1',
      userId: 'user-1',
      roleId: 'role-1',
      roleResultId: 'result-1',
      candidate: jane,
    });
  const profilePassed = () =>
    (
      (search.deepSearchCandidate.mock.calls[0] as unknown[])[3] as {
        rocketReach?: Promise<unknown>;
      }
    ).rocketReach;
  return {
    credits,
    search,
    rocketReach,
    lookups,
    service,
    run,
    profilePassed,
  };
}

describe('PaidResearchService', () => {
  describe('quote', () => {
    it('is one price per run, saying RocketReach will look the candidate up', async () => {
      const { service } = setup();

      const quote = await service.quote('org-1', jane, new Date('2026-11-18'));

      expect(quote).toEqual({
        credits: 1,
        rocketReach: 'lookup',
        balance: 10,
        sufficient: true,
        periodResetsAt: '2026-12-01T00:00:00.000Z',
      });
    });

    it('costs the same when a recent RocketReach profile answers it', async () => {
      const { service } = setup({ cached: person });

      await expect(service.quote('org-1', jane)).resolves.toMatchObject({
        credits: 1,
        rocketReach: 'cached',
      });
    });

    it.each([
      ['disabled (no API key)', { enabled: false }],
      ['nothing on file to look up by', { canLookUp: false }],
    ])('costs the same without RocketReach when %s', async (_why, options) => {
      const { service } = setup(options);

      await expect(service.quote('org-1', jane)).resolves.toMatchObject({
        credits: 1,
        rocketReach: 'none',
      });
    });

    it('says when the balance doesn’t cover it', async () => {
      const { service, credits } = setup();
      credits.balance.mockResolvedValue(0);

      await expect(service.quote('org-1', jane)).resolves.toMatchObject({
        credits: 1,
        balance: 0,
        sufficient: false,
      });
    });

    it('rejects a result with no named candidate', async () => {
      const { service } = setup();

      await expect(
        service.quote('org-1', {
          ...(jane as object),
          first_name: ' ',
          last_name: null,
        } as never),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  describe('research', () => {
    it('charges one run, RocketReach included, and logs the lookup against the charge', async () => {
      const found = { outcome: 'found' as const, query: QUERY, person };
      const { run, credits, rocketReach, lookups, profilePassed } = setup({
        result: found,
      });

      await run();

      expect(credits.charge).toHaveBeenCalledWith({
        organizationId: 'org-1',
        userId: 'user-1',
        roleId: 'role-1',
        roleResultId: 'result-1',
        candidateId: 'candidate-1',
        rocketReach: 'lookup',
      });
      expect(rocketReach.lookup).toHaveBeenCalledWith(jane);
      await expect(profilePassed()).resolves.toBe(person);
      expect(credits.refund).not.toHaveBeenCalled();
      expect(lookups.record).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'DEEP_RESEARCH',
          candidateId: 'candidate-1',
          lookup: found,
          chargeEntryId: 'charge-1',
          refundEntryId: undefined,
        }),
      );
    });

    it.each<[string, RocketReachLookup]>([
      ['finds nobody', { outcome: 'not_found', query: QUERY }],
      ['errors', { outcome: 'error', query: QUERY, error: 'HTTP_500' }],
      ['times out', { outcome: 'pending_timeout', query: QUERY }],
    ])(
      'refunds the whole run when the research succeeds but RocketReach %s, and logs the miss',
      async (_why, result) => {
        const { run, credits, lookups } = setup({ result });

        await expect(run()).resolves.toEqual({ uid: 'candidate-1' });

        expect(credits.refund).toHaveBeenCalledTimes(1);
        expect(credits.refund).toHaveBeenCalledWith(CHARGE, {
          credits: 1,
          part: 'all',
          reason: 'RocketReach found nothing',
        });
        expect(lookups.record).toHaveBeenCalledWith(
          expect.objectContaining({
            lookup: result,
            chargeEntryId: 'charge-1',
            refundEntryId: 'refund-1',
          }),
        );
      },
    );

    it('refunds a failed run once, even when RocketReach also missed', async () => {
      const { run, credits, search } = setup();
      search.deepSearchCandidate.mockRejectedValue(new Error('Gemini down'));

      await expect(run()).rejects.toThrow('Gemini down');
      expect(credits.refund).toHaveBeenCalledTimes(1);
      expect(credits.refund).toHaveBeenCalledWith(
        CHARGE,
        expect.objectContaining({ part: 'all' }),
      );
    });

    it('returns the research when the miss refund itself fails', async () => {
      const { run, credits } = setup();
      credits.refund.mockRejectedValue(new Error('db down'));

      await expect(run()).resolves.toEqual({ uid: 'candidate-1' });
    });

    it('keeps the charge when RocketReach is disabled or has nothing to look up by', async () => {
      for (const options of [{ enabled: false }, { canLookUp: false }]) {
        const { run, credits } = setup(options);
        await run();
        expect(credits.refund).not.toHaveBeenCalled();
      }
    });

    it('reuses a recent profile at the same price instead of calling RocketReach', async () => {
      const { run, credits, rocketReach, lookups, profilePassed } = setup({
        cached: person,
      });

      await run();

      expect(rocketReach.lookup).not.toHaveBeenCalled();
      expect(credits.charge).toHaveBeenCalledWith(
        expect.objectContaining({ rocketReach: 'cached' }),
      );
      await expect(profilePassed()).resolves.toBe(person);
      expect(credits.refund).not.toHaveBeenCalled();
      expect(lookups.record).toHaveBeenCalledWith(
        expect.objectContaining({
          lookup: { outcome: 'cached', profileId: '9' },
          chargeEntryId: 'charge-1',
          refundEntryId: undefined,
        }),
      );
    });

    it('never calls (or logs) RocketReach when it’s disabled', async () => {
      const { run, rocketReach, search, lookups } = setup({ enabled: false });

      await run();

      expect(rocketReach.lookup).not.toHaveBeenCalled();
      expect(lookups.record).not.toHaveBeenCalled();
      expect(search.deepSearchCandidate).toHaveBeenCalledWith(
        'candidate-1',
        'role-1',
        true,
        { rocketReach: undefined },
      );
    });

    it('refunds everything, logs the lookup, and rethrows when research fails', async () => {
      const { run, credits, search, lookups } = setup();
      const failure = new Error('Gemini down');
      search.deepSearchCandidate.mockRejectedValue(failure);

      await expect(run()).rejects.toBe(failure);
      expect(credits.refund).toHaveBeenCalledTimes(1);
      expect(credits.refund).toHaveBeenCalledWith(CHARGE, {
        credits: 1,
        part: 'all',
        reason: 'Deep research failed',
      });
      expect(lookups.record).toHaveBeenCalledWith(
        expect.objectContaining({ refundEntryId: 'refund-1' }),
      );
    });

    it('still reports the research failure when the refund itself fails', async () => {
      const { run, credits, search } = setup();
      const failure = new Error('Gemini down');
      search.deepSearchCandidate.mockRejectedValue(failure);
      credits.refund.mockRejectedValue(new Error('db down'));

      await expect(run()).rejects.toBe(failure);
    });

    it('returns the research even when the lookup log write fails', async () => {
      const { run, lookups } = setup();
      lookups.record.mockRejectedValue(new Error('db down'));

      await expect(run()).resolves.toEqual({ uid: 'candidate-1' });
    });
  });
});
