import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import CreditsConfig from '../../config/credits.config';
import { PrismaService } from '../../common/database/prisma.service';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import {
  OrganizationCreditEntryKind as Kind,
  OrganizationCreditsType,
  Prisma,
  type organization_credits,
} from '../../generated/prisma/client';
import {
  creditPeriodOf,
  expiryKey,
  grantKey,
  periodResetsAt,
  refundKey,
  type RocketReachPlan,
  unusedAllowance,
} from './credit-ledger';

const CREDITS = OrganizationCreditsType.CREDITS;
const RECENT_ENTRIES = 20;

export type CreditEntry = {
  id: string;
  kind: Kind;
  amount: number;
  period: string | null;
  userId: string | null;
  roleId: string | null;
  roleResultId: string | null;
  reason: string | null;
  createdAt: string;
};

// A ledger row as the usage history shows it: with the names of the
// candidate and role it was for, while they still exist (null otherwise).
export type CreditHistoryEntry = CreditEntry & {
  candidate: { id: string; name: string } | null;
  roleName: string | null;
};

export type CreditSummary = {
  balance: number;
  allowance: number;
  // What one deep research run costs.
  costPerRun: number;
  period: string;
  usedThisPeriod: number;
  periodResetsAt: string;
  recent: CreditHistoryEntry[];
};

export class InsufficientCreditsException extends RequestException {
  constructor(balance: number, required: number) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        message: 'Not enough credits for this research',
        balance,
        required,
      },
      HttpStatus.PAYMENT_REQUIRED,
      'INSUFFICIENT_CREDITS',
    );
  }
}

// An organization's research credits, kept as an append-only ledger
// (organization_credits): the balance is the sum of its rows.
//
// The monthly allowance is granted lazily, by whichever read or charge
// first touches an org in a new month, rather than by a scheduled job:
// nothing to schedule or monitor, idle orgs cost nothing, and the grant's
// unique idempotency key makes it safe however many requests race to it.
// Every write runs in a transaction holding a per-org advisory lock, so
// concurrent research runs can't both spend the last credit.
@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CreditsConfig.KEY)
    private readonly config: ConfigType<typeof CreditsConfig>,
  ) {}

  // One deep research run, RocketReach included.
  get costPerRun(): number {
    return this.config.costPerRun;
  }

  async summary(organizationId: string, now = new Date()) {
    return this.locked(organizationId, async (tx): Promise<CreditSummary> => {
      const grant = await this.ensurePeriod(tx, organizationId, now);
      const period = creditPeriodOf(now);
      const recent = await tx.organization_credits.findMany({
        where: { organization_id: organizationId, type: CREDITS },
        orderBy: { created: 'desc' },
        take: RECENT_ENTRIES,
      });
      return {
        balance: await this.balanceOf(tx, organizationId),
        allowance: grant.amount,
        costPerRun: this.costPerRun,
        period,
        usedThisPeriod: await this.netSpend(tx, organizationId, period),
        periodResetsAt: periodResetsAt(now).toISOString(),
        recent: await this.withNames(tx, organizationId, recent.map(entryOf)),
      };
    });
  }

  async balance(organizationId: string, now = new Date()): Promise<number> {
    return this.locked(organizationId, async (tx) => {
      await this.ensurePeriod(tx, organizationId, now);
      return this.balanceOf(tx, organizationId);
    });
  }

  // Takes a research run's credits up front, or throws 402 when the balance
  // doesn't cover them. The returned row is what refund() reverses.
  async charge(
    {
      organizationId,
      userId,
      roleId,
      roleResultId,
      candidateId,
      rocketReach,
    }: {
      organizationId: string;
      userId: string;
      roleId?: string;
      roleResultId?: string;
      candidateId?: string;
      // How the run gets RocketReach's profile; recorded, not priced.
      rocketReach: RocketReachPlan;
    },
    now = new Date(),
  ): Promise<organization_credits> {
    const required = this.costPerRun;
    return this.locked(organizationId, async (tx) => {
      await this.ensurePeriod(tx, organizationId, now);
      const balance = await this.balanceOf(tx, organizationId);
      if (balance < required) {
        throw new InsufficientCreditsException(balance, required);
      }
      return tx.organization_credits.create({
        data: {
          organization_id: organizationId,
          type: CREDITS,
          kind: Kind.RESEARCH,
          amount: -required,
          period: creditPeriodOf(now),
          user_id: userId,
          role_id: roleId ?? null,
          role_result_id: roleResultId ?? null,
          metadata: { rocketReach, ...(candidateId ? { candidateId } : {}) },
        },
      });
    });
  }

  // Gives back `credits` of a charge. `part` names what's refunded ("all"),
  // so refunding the same part twice is a no-op. The refund
  // counts against the charge's period, not today's. Returns the refund row
  // (the existing one on a repeat), or null when there was nothing to give.
  async refund(
    charge: organization_credits,
    {
      credits,
      part,
      reason,
    }: { credits: number; part: string; reason: string },
  ): Promise<organization_credits | null> {
    if (credits <= 0) return null;
    const key = refundKey(charge.uid, part);
    return this.locked(charge.organization_id, async (tx) => {
      await tx.organization_credits.createMany({
        data: [
          {
            organization_id: charge.organization_id,
            type: CREDITS,
            kind: Kind.REFUND,
            amount: credits,
            period: charge.period,
            user_id: charge.user_id,
            role_id: charge.role_id,
            role_result_id: charge.role_result_id,
            reason,
            metadata: { chargeId: charge.uid },
            idempotency_key: key,
          },
        ],
        skipDuplicates: true,
      });
      return tx.organization_credits.findUnique({
        where: { idempotency_key: key },
      });
    });
  }

  // An admin's manual correction, positive or negative; it can't take the
  // balance below zero.
  async adjust(
    {
      organizationId,
      userId,
      amount,
      reason,
    }: {
      organizationId: string;
      userId: string;
      amount: number;
      reason: string;
    },
    now = new Date(),
  ): Promise<CreditEntry> {
    return this.locked(organizationId, async (tx) => {
      await this.ensurePeriod(tx, organizationId, now);
      const balance = await this.balanceOf(tx, organizationId);
      if (balance + amount < 0) {
        throw new RequestException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'An adjustment can’t take the balance below zero',
            balance,
          },
          HttpStatus.BAD_REQUEST,
          'ADJUSTMENT_BELOW_ZERO',
        );
      }
      const entry = await tx.organization_credits.create({
        data: {
          organization_id: organizationId,
          type: CREDITS,
          kind: Kind.ADJUSTMENT,
          amount,
          period: creditPeriodOf(now),
          user_id: userId,
          reason,
        },
      });
      return entryOf(entry);
    });
  }

  private async withNames(
    tx: Prisma.TransactionClient,
    organizationId: string,
    entries: CreditEntry[],
  ): Promise<CreditHistoryEntry[]> {
    const { candidates, roles } = await namesFor(tx, organizationId, entries);
    return entries.map((entry) => ({
      ...entry,
      candidate: entry.roleResultId
        ? (candidates.get(entry.roleResultId) ?? null)
        : null,
      roleName: entry.roleId ? (roles.get(entry.roleId) ?? null) : null,
    }));
  }

  private locked<T>(
    organizationId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        // Released when the transaction ends. hashtext() maps the key onto
        // the lock's integer space; a rare collision only serializes two
        // orgs, it can't mix their balances.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`credits:${organizationId}`}))`;
        return work(tx);
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
  }

  // Grants this period's allowance if it hasn't been yet, first expiring
  // what's left of the previous grant (the allowance doesn't roll over).
  // Returns this period's grant row.
  private async ensurePeriod(
    tx: Prisma.TransactionClient,
    organizationId: string,
    now: Date,
  ): Promise<organization_credits> {
    const period = creditPeriodOf(now);
    const key = grantKey(organizationId, period);
    const current = await tx.organization_credits.findUnique({
      where: { idempotency_key: key },
    });
    if (current) return current;

    const previous = await tx.organization_credits.findFirst({
      where: {
        organization_id: organizationId,
        type: CREDITS,
        kind: Kind.MONTHLY_GRANT,
      },
      orderBy: { created: 'desc' },
    });
    if (previous?.period && previous.period !== period) {
      const unused = unusedAllowance({
        granted: previous.amount,
        netSpend: await this.netSpend(tx, organizationId, previous.period),
        balance: await this.balanceOf(tx, organizationId),
      });
      if (unused > 0) {
        await tx.organization_credits.createMany({
          data: [
            {
              organization_id: organizationId,
              type: CREDITS,
              kind: Kind.ALLOWANCE_EXPIRY,
              amount: -unused,
              period: previous.period,
              reason: `Unused ${previous.period} allowance`,
              idempotency_key: expiryKey(organizationId, previous.period),
            },
          ],
          skipDuplicates: true,
        });
      }
    }

    await tx.organization_credits.createMany({
      data: [
        {
          organization_id: organizationId,
          type: CREDITS,
          kind: Kind.MONTHLY_GRANT,
          amount: await this.allowanceFor(tx, organizationId),
          period,
          reason: `${period} allowance`,
          idempotency_key: key,
        },
      ],
      skipDuplicates: true,
    });
    return tx.organization_credits.findUniqueOrThrow({
      where: { idempotency_key: key },
    });
  }

  private async allowanceFor(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<number> {
    const settings = await tx.organization_settings.findUnique({
      where: { organization_id: organizationId },
      select: { monthly_credit_allowance: true },
    });
    return settings?.monthly_credit_allowance ?? this.config.monthlyAllowance;
  }

  private async balanceOf(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<number> {
    const { _sum } = await tx.organization_credits.aggregate({
      where: { organization_id: organizationId, type: CREDITS },
      _sum: { amount: true },
    });
    return _sum.amount ?? 0;
  }

  // What research spent in a period, net of refunds, as a positive number.
  // CONTACT_LOOKUP rows are from before contact lookups were folded into
  // research; they still count against their period.
  private async netSpend(
    tx: Prisma.TransactionClient,
    organizationId: string,
    period: string,
  ): Promise<number> {
    const { _sum } = await tx.organization_credits.aggregate({
      where: {
        organization_id: organizationId,
        type: CREDITS,
        period,
        kind: { in: [Kind.RESEARCH, Kind.CONTACT_LOOKUP, Kind.REFUND] },
      },
      _sum: { amount: true },
    });
    return -(_sum.amount ?? 0);
  }
}

// Ledger rows hold plain ids, so the names come from two batched reads,
// limited to the org's own results and roles.
async function namesFor(
  tx: Prisma.TransactionClient,
  organizationId: string,
  entries: CreditEntry[],
) {
  const ids = (key: 'roleResultId' | 'roleId') => [
    ...new Set(entries.flatMap((e) => (e[key] ? [e[key]] : []))),
  ];
  const inOrg = { project: { organization_id: organizationId } };
  const [results, roles] = await Promise.all([
    tx.role_result.findMany({
      where: { uid: { in: ids('roleResultId') }, role: inOrg },
      select: {
        uid: true,
        candidate: { select: { uid: true, first_name: true, last_name: true } },
      },
    }),
    tx.roles.findMany({
      where: { uid: { in: ids('roleId') }, ...inOrg },
      select: { uid: true, name: true },
    }),
  ]);
  return {
    candidates: new Map(
      results.flatMap(({ uid, candidate }) => {
        const name = [candidate?.first_name, candidate?.last_name]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join(' ');
        return candidate && name
          ? [[uid, { id: candidate.uid, name }] as const]
          : [];
      }),
    ),
    roles: new Map(roles.map((role) => [role.uid, role.name] as const)),
  };
}

function entryOf(row: organization_credits): CreditEntry {
  return {
    id: row.uid,
    kind: row.kind,
    amount: row.amount,
    period: row.period,
    userId: row.user_id,
    roleId: row.role_id,
    roleResultId: row.role_result_id,
    reason: row.reason,
    createdAt: row.created.toISOString(),
  };
}
