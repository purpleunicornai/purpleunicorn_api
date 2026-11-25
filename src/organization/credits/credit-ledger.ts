// Pure credit arithmetic; CreditsService does the reads and writes.

// Allowance periods are calendar months in UTC, e.g. "2026-11".
export function creditPeriodOf(at: Date): string {
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${at.getUTCFullYear()}-${month}`;
}

// When the next period's allowance is granted: the 1st of next month, UTC.
export function periodResetsAt(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

// How much of a period's grant went unspent, and so expires when the next
// period starts. Research spends the allowance before purchased or adjusted
// credits, and those never expire: the result is at most the grant minus
// what research used, and never more than the balance.
export function unusedAllowance({
  granted,
  netSpend,
  balance,
}: {
  granted: number;
  // Research charges minus refunds in the period, as a positive number.
  netSpend: number;
  balance: number;
}): number {
  return Math.max(0, Math.min(balance, granted - netSpend));
}

// How a research run gets RocketReach's profile: a new lookup, a recent
// lookup reused (same price; it saves a round trip, not credits), or not at
// all (disabled, nothing to look the candidate up by). Either way the run
// costs the same: RocketReach is part of the one research request.
export type RocketReachPlan = 'lookup' | 'cached' | 'none';

// Idempotency keys: writing the same one twice is a no-op.
export const grantKey = (organizationId: string, period: string) =>
  `grant:${organizationId}:${period}`;
export const expiryKey = (organizationId: string, period: string) =>
  `expire:${organizationId}:${period}`;
export const refundKey = (chargeId: string, part: string) =>
  `refund:${chargeId}:${part}`;
