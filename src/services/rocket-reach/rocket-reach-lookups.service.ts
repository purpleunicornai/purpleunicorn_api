import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PrismaService } from '../../common/database/prisma.service';
import AiConfig from '../../config/ai.config';
import {
  type Prisma,
  type rocketreach_lookup,
} from '../../generated/prisma/client';
import {
  lookupLogRow,
  lookupTotals,
  type LookupLogInput,
  type LookupTotals,
} from './rocket-reach-lookups';
import type { RocketReachPerson } from './rocket-reach.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LIST = 500;

export type LookupFilter = {
  organizationId?: string;
  candidateId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
};

// The RocketReach lookup log (rocketreach_lookup), and reuse of a profile
// research stored recently so RocketReach isn't asked about the same
// candidate twice.
@Injectable()
export class RocketReachLookupsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AiConfig.KEY)
    private readonly aiConf: Pick<
      ConfigType<typeof AiConfig>,
      'rocketReachCacheTtlDays'
    >,
  ) {}

  async record(input: LookupLogInput): Promise<rocketreach_lookup> {
    return this.prisma.rocketreach_lookup.create({
      data: lookupLogRow(input),
    });
  }

  // A raw profile deep research stored for this candidate within the TTL
  // (on any of their results), for research to reuse.
  async recentProfile(
    candidateId: string,
    now = new Date(),
  ): Promise<RocketReachPerson | null> {
    const since = this.cacheSince(now);
    if (!since) return null;
    const results = await this.prisma.role_result.findMany({
      where: { candidate_uid: candidateId, updated: { gte: since } },
      select: { metadata: true },
      orderBy: { updated: 'desc' },
      take: 20,
    });
    for (const { metadata } of results) {
      const stored = storedProfileOf(metadata);
      if (stored && stored.fetchedAt >= since) return stored.profile;
    }
    return null;
  }

  async list({
    organizationId,
    candidateId,
    from,
    to,
    limit = 100,
  }: LookupFilter): Promise<{
    totals: LookupTotals;
    lookups: rocketreach_lookup[];
  }> {
    const where: Prisma.rocketreach_lookupWhereInput = {
      ...(organizationId ? { organization_id: organizationId } : {}),
      ...(candidateId ? { candidate_id: candidateId } : {}),
      ...(from || to
        ? {
            created: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lt: to } : {}),
            },
          }
        : {}),
    };
    const [lookups, groups] = await Promise.all([
      this.prisma.rocketreach_lookup.findMany({
        where,
        orderBy: { created: 'desc' },
        take: Math.min(limit, MAX_LIST),
      }),
      this.prisma.rocketreach_lookup.groupBy({
        by: ['outcome', 'from_cache', 'likely_billed', 'org_charge'],
        where,
        _count: { _all: true },
      }),
    ]);
    return {
      totals: lookupTotals(
        groups.map((group) => ({ ...group, count: group._count._all })),
      ),
      lookups,
    };
  }

  private cacheSince(now: Date): Date | null {
    const days = this.aiConf.rocketReachCacheTtlDays;
    return days > 0 ? new Date(now.getTime() - days * DAY_MS) : null;
  }
}

function storedProfileOf(
  metadata: unknown,
): { fetchedAt: Date; profile: RocketReachPerson } | null {
  const stored = (metadata as { rocketReach?: unknown } | null)?.rocketReach as
    { fetchedAt?: unknown; profile?: unknown } | undefined;
  if (
    typeof stored?.fetchedAt !== 'string' ||
    !stored.profile ||
    typeof stored.profile !== 'object'
  ) {
    return null;
  }
  const fetchedAt = new Date(stored.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) return null;
  return { fetchedAt, profile: stored.profile as RocketReachPerson };
}
