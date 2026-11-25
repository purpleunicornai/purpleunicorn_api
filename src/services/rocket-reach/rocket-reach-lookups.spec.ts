import { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../../common/database/prisma.service';
import {
  lookupLogRow,
  lookupTotals,
  type LookupLogInput,
} from './rocket-reach-lookups';
import { RocketReachLookupsService } from './rocket-reach-lookups.service';
import type { RocketReachPerson } from './rocket-reach.service';

const QUERY = {
  type: 'linkedin_url' as const,
  params: { linkedin_url: 'https://linkedin.com/in/jane' },
};
const person = {
  id: 42,
  status: 'complete',
  recommended_email: 'jane@acme.com',
} as RocketReachPerson;
const base = {
  organizationId: 'org-1',
  userId: 'user-1',
  candidateId: 'candidate-1',
  purpose: 'CONTACT_DETAILS',
} as const;
const row = (input: Partial<LookupLogInput> & Pick<LookupLogInput, 'lookup'>) =>
  lookupLogRow({ ...base, ...input });

describe('lookupLogRow', () => {
  it('logs a found lookup as charged and likely billed, without contact data', () => {
    const logged = row({
      lookup: { outcome: 'found', query: QUERY, person },
      chargeEntryId: 'charge-1',
    });

    expect(logged).toEqual({
      organization_id: 'org-1',
      user_id: 'user-1',
      candidate_id: 'candidate-1',
      role_id: null,
      role_result_id: null,
      purpose: 'CONTACT_DETAILS',
      query_type: 'linkedin_url',
      query: QUERY.params,
      outcome: 'FOUND',
      from_cache: false,
      likely_billed: true,
      rocketreach_profile_id: '42',
      http_status: null,
      error: null,
      org_charge: 'CHARGED',
      charge_entry_id: 'charge-1',
      refund_entry_id: null,
    });
    expect(JSON.stringify(logged)).not.toContain('jane@acme.com');
  });

  it.each([
    [
      'a miss',
      { outcome: 'not_found' as const, query: QUERY },
      'NOT_FOUND',
      false,
    ],
    [
      'a timeout (may still bill)',
      { outcome: 'pending_timeout' as const, query: QUERY, profileId: 7 },
      'PENDING_TIMEOUT',
      true,
    ],
    [
      'an error',
      {
        outcome: 'error' as const,
        query: QUERY,
        httpStatus: 500,
        error: 'ERR_BAD_RESPONSE',
      },
      'ERROR',
      false,
    ],
  ])('logs %s as refunded', (_why, lookup, outcome, likelyBilled) => {
    expect(
      row({ lookup, chargeEntryId: 'charge-1', refundEntryId: 'refund-1' }),
    ).toMatchObject({
      outcome,
      likely_billed: likelyBilled,
      org_charge: 'REFUNDED',
      refund_entry_id: 'refund-1',
    });
  });

  it('keeps an error’s status and code', () => {
    expect(
      row({
        lookup: {
          outcome: 'error',
          query: QUERY,
          httpStatus: 429,
          error: 'ERR_BAD_REQUEST',
        },
      }),
    ).toMatchObject({ http_status: 429, error: 'ERR_BAD_REQUEST' });
  });

  it('logs a cache hit as a charged but unbilled find with no query', () => {
    expect(
      row({
        lookup: { outcome: 'cached', profileId: '42' },
        chargeEntryId: 'charge-1',
      }),
    ).toMatchObject({
      outcome: 'FOUND',
      from_cache: true,
      likely_billed: false,
      query: Prisma.DbNull,
      query_type: null,
      rocketreach_profile_id: '42',
      org_charge: 'CHARGED',
      charge_entry_id: 'charge-1',
      refund_entry_id: null,
    });
  });
});

describe('lookupTotals', () => {
  it('counts lookups sent to RocketReach apart from cache hits, and the cache hits charged', () => {
    const group = (
      outcome: 'FOUND' | 'NOT_FOUND' | 'ERROR' | 'PENDING_TIMEOUT',
      from_cache: boolean,
      likely_billed: boolean,
      org_charge: 'CHARGED' | 'REFUNDED',
      count: number,
    ) => ({ outcome, from_cache, likely_billed, org_charge, count });

    expect(
      lookupTotals([
        group('FOUND', false, true, 'CHARGED', 5),
        group('FOUND', true, false, 'CHARGED', 3),
        // A cache hit refunded because the research around it failed.
        group('FOUND', true, false, 'REFUNDED', 1),
        group('NOT_FOUND', false, false, 'REFUNDED', 2),
        group('ERROR', false, false, 'REFUNDED', 1),
        group('PENDING_TIMEOUT', false, true, 'REFUNDED', 1),
      ]),
    ).toEqual({
      lookups: 9,
      found: 5,
      misses: 2,
      errors: 1,
      pendingTimeouts: 1,
      cacheHits: 4,
      chargedFromCache: 3,
      likelyBilled: 6,
    });
  });
});

describe('RocketReachLookupsService', () => {
  const NOW = new Date('2026-11-18T12:00:00.000Z');
  const DAYS_AGO = (days: number) =>
    new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

  function setup(ttlDays = 30, results: { metadata: unknown }[] = []) {
    const prisma = {
      rocketreach_lookup: {
        create: jest.fn(async ({ data }: { data: object }) => data),
        findMany: jest.fn().mockResolvedValue([{ uid: 'lookup-1' }]),
        groupBy: jest.fn().mockResolvedValue([
          {
            outcome: 'FOUND',
            from_cache: false,
            likely_billed: true,
            org_charge: 'CHARGED',
            _count: { _all: 4 },
          },
        ]),
      },
      role_result: { findMany: jest.fn().mockResolvedValue(results) },
    };
    const service = new RocketReachLookupsService(
      prisma as unknown as PrismaService,
      { rocketReachCacheTtlDays: ttlDays },
    );
    return { prisma, service };
  }

  it('records the log row', async () => {
    const { service, prisma } = setup();

    await service.record({
      ...base,
      lookup: { outcome: 'not_found', query: QUERY },
    });

    expect(prisma.rocketreach_lookup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ outcome: 'NOT_FOUND' }),
    });
  });

  it('turns the cache off with a TTL of 0', async () => {
    const { service, prisma } = setup(0, [
      {
        metadata: {
          rocketReach: { fetchedAt: NOW.toISOString(), profile: person },
        },
      },
    ]);

    await expect(service.recentProfile('candidate-1', NOW)).resolves.toBeNull();
    expect(prisma.role_result.findMany).not.toHaveBeenCalled();
  });

  it('reuses a profile research stored within the TTL, skipping stale or malformed ones', async () => {
    const { service } = setup(30, [
      {
        metadata: { rocketReach: { fetchedAt: 'not a date', profile: person } },
      },
      {
        metadata: {
          rocketReach: {
            fetchedAt: DAYS_AGO(45).toISOString(),
            profile: { id: 1 },
          },
        },
      },
      { metadata: null },
      {
        metadata: {
          rocketReach: {
            fetchedAt: DAYS_AGO(2).toISOString(),
            profile: person,
          },
        },
      },
    ]);

    await expect(service.recentProfile('candidate-1', NOW)).resolves.toBe(
      person,
    );
  });

  it('lists with filters, a capped limit, and totals', async () => {
    const { service, prisma } = setup();
    const from = new Date('2026-11-01');
    const to = new Date('2026-12-01');

    const listed = await service.list({
      organizationId: 'org-1',
      candidateId: 'candidate-1',
      from,
      to,
      limit: 10_000,
    });

    const where = {
      organization_id: 'org-1',
      candidate_id: 'candidate-1',
      created: { gte: from, lt: to },
    };
    expect(prisma.rocketreach_lookup.findMany).toHaveBeenCalledWith({
      where,
      orderBy: { created: 'desc' },
      take: 500,
    });
    expect(prisma.rocketreach_lookup.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
    expect(listed).toEqual({
      totals: expect.objectContaining({
        lookups: 4,
        found: 4,
        likelyBilled: 4,
      }),
      lookups: [{ uid: 'lookup-1' }],
    });
  });

  it('lists everything when unfiltered', async () => {
    const { service, prisma } = setup();

    await service.list({});

    expect(prisma.rocketreach_lookup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 100 }),
    );
  });
});
