import {
  Prisma,
  RocketReachLookupCharge,
  RocketReachLookupOutcome,
  RocketReachLookupPurpose,
} from '../../generated/prisma/client';
import type { RocketReachLookup } from './rocket-reach.service';

// A lookup that reached RocketReach, or one a recent lookup answered.
export type LoggedLookup =
  | Exclude<RocketReachLookup, { outcome: 'skipped' }>
  | { outcome: 'cached'; profileId: string | null };

export type LookupLogInput = {
  organizationId: string;
  userId: string | null;
  candidateId: string;
  roleId?: string | null;
  roleResultId?: string | null;
  purpose: RocketReachLookupPurpose;
  lookup: LoggedLookup;
  // Ledger rows: the charge that paid for it, and its refund, if any.
  chargeEntryId?: string | null;
  refundEntryId?: string | null;
};

const OUTCOMES = {
  found: RocketReachLookupOutcome.FOUND,
  not_found: RocketReachLookupOutcome.NOT_FOUND,
  pending_timeout: RocketReachLookupOutcome.PENDING_TIMEOUT,
  error: RocketReachLookupOutcome.ERROR,
} as const;

export function lookupLogRow(
  input: LookupLogInput,
): Prisma.rocketreach_lookupUncheckedCreateInput {
  const { lookup } = input;
  const cached = lookup.outcome === 'cached';
  const profileId =
    lookup.outcome === 'found'
      ? String(lookup.person.id)
      : lookup.outcome === 'cached'
        ? lookup.profileId
        : lookup.outcome === 'error'
          ? null
          : lookup.profileId != null
            ? String(lookup.profileId)
            : null;
  return {
    organization_id: input.organizationId,
    user_id: input.userId,
    candidate_id: input.candidateId,
    role_id: input.roleId ?? null,
    role_result_id: input.roleResultId ?? null,
    purpose: input.purpose,
    query_type: cached ? null : lookup.query.type,
    query: cached ? Prisma.DbNull : lookup.query.params,
    outcome: cached ? RocketReachLookupOutcome.FOUND : OUTCOMES[lookup.outcome],
    from_cache: cached,
    // RocketReach doesn't bill a lookup that finds nobody; a pending one
    // may still complete (and bill) after we stopped waiting.
    likely_billed:
      lookup.outcome === 'found' || lookup.outcome === 'pending_timeout',
    rocketreach_profile_id: profileId,
    http_status:
      lookup.outcome === 'error' ? (lookup.httpStatus ?? null) : null,
    error: lookup.outcome === 'error' ? lookup.error : null,
    // A cache hit is charged like a lookup (but never billed to us).
    org_charge: input.refundEntryId
      ? RocketReachLookupCharge.REFUNDED
      : input.chargeEntryId
        ? RocketReachLookupCharge.CHARGED
        : RocketReachLookupCharge.FREE,
    charge_entry_id: input.chargeEntryId ?? null,
    refund_entry_id: input.refundEntryId ?? null,
  };
}

export type LookupTotals = {
  // Requests that reached RocketReach (cache hits excluded).
  lookups: number;
  found: number;
  misses: number;
  errors: number;
  pendingTimeouts: number;
  cacheHits: number;
  // Cache hits the org paid for: RocketReach requests saved at full price.
  chargedFromCache: number;
  likelyBilled: number;
};

export function lookupTotals(
  groups: {
    outcome: RocketReachLookupOutcome;
    from_cache: boolean;
    likely_billed: boolean;
    org_charge: RocketReachLookupCharge;
    count: number;
  }[],
): LookupTotals {
  const sum = (match: (group: (typeof groups)[number]) => boolean) =>
    groups.filter(match).reduce((total, group) => total + group.count, 0);
  const sent = (group: (typeof groups)[number]) => !group.from_cache;
  return {
    lookups: sum(sent),
    found: sum((g) => sent(g) && g.outcome === 'FOUND'),
    misses: sum((g) => sent(g) && g.outcome === 'NOT_FOUND'),
    errors: sum((g) => sent(g) && g.outcome === 'ERROR'),
    pendingTimeouts: sum((g) => sent(g) && g.outcome === 'PENDING_TIMEOUT'),
    cacheHits: sum((g) => g.from_cache),
    chargedFromCache: sum(
      (g) => g.from_cache && g.org_charge === RocketReachLookupCharge.CHARGED,
    ),
    likelyBilled: sum((g) => g.likely_billed),
  };
}
