import type { PrismaService } from '../../common/database/prisma.service';
import type { organization_credits } from '../../generated/prisma/client';
import {
  CreditsService,
  InsufficientCreditsException,
} from './credits.service';

type Row = organization_credits;
type Where = {
  organization_id?: string;
  type?: string;
  kind?: string | { in: string[] };
  period?: string;
  idempotency_key?: string;
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

// An in-memory organization_credits table. Every query yields to the event
// loop, so concurrent callers interleave the way they would against
// Postgres; pg_advisory_xact_lock is a per-key mutex held until the
// transaction's work settles (`lockless` turns it off, to show the specs
// would catch an overspend).
class FakeLedger {
  rows: Row[] = [];
  allowances = new Map<string, number>();
  // role_result and roles, for the names on ledger rows.
  results: {
    uid: string;
    org: string;
    candidate: {
      uid: string;
      first_name: string | null;
      last_name: string | null;
    } | null;
  }[] = [];
  roles: { uid: string; org: string; name: string }[] = [];
  private locks = new Map<string, Promise<void>>();
  private clock = 0;

  constructor(private readonly lockless = false) {}

  balance(organizationId: string) {
    return this.rows
      .filter((row) => row.organization_id === organizationId)
      .reduce((sum, row) => sum + row.amount, 0);
  }

  kinds(organizationId: string) {
    return this.rows
      .filter((row) => row.organization_id === organizationId)
      .map((row) => `${row.kind}:${row.amount}`);
  }

  get prisma(): PrismaService {
    return {
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
        let release: () => void = () => {};
        const tx = {
          ...this.client(),
          $executeRaw: async (_sql: TemplateStringsArray, key: string) => {
            if (this.lockless) return 0;
            const previous = this.locks.get(key) ?? Promise.resolve();
            const mine = new Promise<void>((resolve) => (release = resolve));
            this.locks.set(
              key,
              previous.then(() => mine),
            );
            await previous;
            return 0;
          },
        };
        try {
          return await work(tx);
        } finally {
          release();
        }
      },
    } as unknown as PrismaService;
  }

  private matches(row: Row, where: Where) {
    return (
      (where.organization_id === undefined ||
        row.organization_id === where.organization_id) &&
      (where.type === undefined || row.type === where.type) &&
      (where.period === undefined || row.period === where.period) &&
      (where.idempotency_key === undefined ||
        row.idempotency_key === where.idempotency_key) &&
      (where.kind === undefined ||
        (typeof where.kind === 'string'
          ? row.kind === where.kind
          : where.kind.in.includes(row.kind)))
    );
  }

  private insert(data: Partial<Row>): Row {
    const row = {
      uid: `row-${this.rows.length + 1}`,
      created: new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock++)),
      updated: new Date(),
      kind: 'ADJUSTMENT',
      period: null,
      user_id: null,
      role_id: null,
      role_result_id: null,
      reason: null,
      metadata: null,
      idempotency_key: null,
      ...data,
    } as Row;
    this.rows.push(row);
    return row;
  }

  private client() {
    const find = async ({ where }: { where: Where }) => {
      await tick();
      return this.rows.find((row) => this.matches(row, where)) ?? null;
    };
    return {
      organization_credits: {
        findUnique: find,
        findUniqueOrThrow: async (args: { where: Where }) => {
          const row = await find(args);
          if (!row) throw new Error('not found');
          return row;
        },
        findFirst: async ({ where }: { where: Where }) => {
          await tick();
          return (
            this.rows
              .filter((row) => this.matches(row, where))
              .sort((a, b) => b.created.getTime() - a.created.getTime())[0] ??
            null
          );
        },
        findMany: async ({ where, take }: { where: Where; take: number }) => {
          await tick();
          return this.rows
            .filter((row) => this.matches(row, where))
            .sort((a, b) => b.created.getTime() - a.created.getTime())
            .slice(0, take);
        },
        aggregate: async ({ where }: { where: Where }) => {
          await tick();
          const rows = this.rows.filter((row) => this.matches(row, where));
          return {
            _sum: {
              amount: rows.length
                ? rows.reduce((sum, row) => sum + row.amount, 0)
                : null,
            },
          };
        },
        create: async ({ data }: { data: Partial<Row> }) => {
          await tick();
          return this.insert(data);
        },
        createMany: async ({ data }: { data: Partial<Row>[] }) => {
          await tick();
          let count = 0;
          for (const entry of data) {
            const taken =
              entry.idempotency_key &&
              this.rows.some(
                (row) => row.idempotency_key === entry.idempotency_key,
              );
            if (!taken) {
              this.insert(entry);
              count++;
            }
          }
          return { count };
        },
      },
      role_result: {
        findMany: async ({
          where,
        }: {
          where: {
            uid: { in: string[] };
            role: { project: { organization_id: string } };
          };
        }) => {
          await tick();
          return this.results
            .filter(
              (r) =>
                where.uid.in.includes(r.uid) &&
                r.org === where.role.project.organization_id,
            )
            .map(({ uid, candidate }) => ({ uid, candidate }));
        },
      },
      roles: {
        findMany: async ({
          where,
        }: {
          where: {
            uid: { in: string[] };
            project: { organization_id: string };
          };
        }) => {
          await tick();
          return this.roles
            .filter(
              (r) =>
                where.uid.in.includes(r.uid) &&
                r.org === where.project.organization_id,
            )
            .map(({ uid, name }) => ({ uid, name }));
        },
      },
      organization_settings: {
        findUnique: async ({
          where,
        }: {
          where: { organization_id: string };
        }) => {
          await tick();
          const allowance = this.allowances.get(where.organization_id);
          return allowance === undefined
            ? null
            : { monthly_credit_allowance: allowance };
        },
      },
    };
  }
}

const NOV = new Date('2026-11-18T12:00:00Z');
const DEC = new Date('2026-12-02T09:00:00Z');
function setup({ allowance = 5, lockless = false } = {}) {
  const ledger = new FakeLedger(lockless);
  const config = {
    monthlyAllowance: allowance,
    costPerRun: 1,
    adminUserIds: [],
  };
  const service = new CreditsService(ledger.prisma, config);
  // `credits` stands in for the configured cost of a run.
  const charge = (organizationId = 'org-1', credits = 1, at = NOV) => {
    config.costPerRun = credits;
    return service.charge(
      {
        organizationId,
        userId: 'user-1',
        roleId: 'role-1',
        roleResultId: 'result-1',
        rocketReach: 'lookup',
      },
      at,
    );
  };
  return { ledger, service, charge };
}

describe('CreditsService', () => {
  describe('balance', () => {
    it('is the sum of the ledger: grant, charges, refunds and adjustments', async () => {
      const { ledger, service, charge } = setup({ allowance: 10 });

      const first = await charge('org-1', 3);
      await charge('org-1', 2);
      await service.refund(first, {
        credits: 3,
        part: 'all',
        reason: 'failed',
      });
      await service.adjust(
        { organizationId: 'org-1', userId: 'staff', amount: 4, reason: 'gift' },
        NOV,
      );

      expect(await service.balance('org-1', NOV)).toBe(10 - 3 - 2 + 3 + 4);
      expect(ledger.kinds('org-1')).toEqual([
        'MONTHLY_GRANT:10',
        'RESEARCH:-3',
        'RESEARCH:-2',
        'REFUND:3',
        'ADJUSTMENT:4',
      ]);
    });

    it('keeps organizations apart', async () => {
      const { service, charge } = setup({ allowance: 5 });

      await charge('org-1', 4);

      expect(await service.balance('org-1', NOV)).toBe(1);
      expect(await service.balance('org-2', NOV)).toBe(5);
    });
  });

  describe('monthly grant', () => {
    it('is granted once per period, however many reads race to it', async () => {
      const { ledger, service } = setup({ allowance: 5 });

      await Promise.all(
        Array.from({ length: 8 }, () => service.balance('org-1', NOV)),
      );
      await service.summary('org-1', NOV);

      expect(ledger.kinds('org-1')).toEqual(['MONTHLY_GRANT:5']);
    });

    it('uses the org’s own allowance over the default', async () => {
      const { ledger, service } = setup({ allowance: 5 });
      ledger.allowances.set('org-1', 200);

      expect(await service.balance('org-1', NOV)).toBe(200);
      expect(await service.balance('org-2', NOV)).toBe(5);
    });

    it('expires the unused allowance next month but keeps adjusted credits', async () => {
      const { ledger, service, charge } = setup({ allowance: 5 });
      await charge('org-1', 2);
      await service.adjust(
        { organizationId: 'org-1', userId: 'staff', amount: 7, reason: 'gift' },
        NOV,
      );

      const summary = await service.summary('org-1', DEC);

      // 3 of November's 5 went unused and expire; the 7 stay.
      expect(summary.balance).toBe(7 + 5);
      expect(summary.period).toBe('2026-12');
      expect(summary.allowance).toBe(5);
      expect(summary.periodResetsAt).toBe('2027-01-01T00:00:00.000Z');
      expect(ledger.kinds('org-1').slice(-2)).toEqual([
        'ALLOWANCE_EXPIRY:-3',
        'MONTHLY_GRANT:5',
      ]);

      await service.summary('org-1', DEC);
      expect(ledger.rows).toHaveLength(5);
    });

    it('reports this period’s research spend net of refunds', async () => {
      const { service, charge } = setup({ allowance: 10 });
      const failed = await charge('org-1', 2);
      await charge('org-1', 3);
      await service.refund(failed, {
        credits: 2,
        part: 'all',
        reason: 'failed',
      });

      const summary = await service.summary('org-1', NOV);

      expect(summary.usedThisPeriod).toBe(3);
      expect(summary.recent[0]).toMatchObject({ kind: 'REFUND', amount: 2 });
    });

    it('states the cost of one run, RocketReach included', async () => {
      const { service } = setup();

      await expect(service.summary('org-1', NOV)).resolves.toMatchObject({
        costPerRun: 1,
      });
    });

    it('names the candidate and role on each row, only from the org’s own results', async () => {
      const { service, charge, ledger } = setup({ allowance: 10 });
      ledger.results.push({
        uid: 'result-1',
        org: 'org-1',
        candidate: {
          uid: 'candidate-1',
          first_name: 'Jane',
          last_name: ' Doe ',
        },
      });
      ledger.roles.push({
        uid: 'role-1',
        org: 'org-1',
        name: 'Founding Engineer',
      });
      ledger.roles.push({ uid: 'role-1', org: 'org-2', name: 'Not ours' });
      const charged = await charge('org-1');
      await service.refund(charged, {
        credits: 1,
        part: 'all',
        reason: 'failed',
      });

      const { recent } = await service.summary('org-1', NOV);

      expect(recent.slice(0, 2)).toEqual([
        expect.objectContaining({
          kind: 'REFUND',
          candidate: { id: 'candidate-1', name: 'Jane Doe' },
          roleName: 'Founding Engineer',
        }),
        expect.objectContaining({
          kind: 'RESEARCH',
          candidate: { id: 'candidate-1', name: 'Jane Doe' },
          roleName: 'Founding Engineer',
        }),
      ]);
      expect(recent.at(-1)).toMatchObject({
        kind: 'MONTHLY_GRANT',
        candidate: null,
        roleName: null,
      });
    });

    it('leaves names null when the result or role is gone', async () => {
      const { service, charge } = setup();
      await charge('org-1');

      const { recent } = await service.summary('org-1', NOV);

      expect(recent[0]).toMatchObject({ candidate: null, roleName: null });
    });

    it('records how RocketReach was served on the charge, not as a price', async () => {
      const { charge } = setup();

      const row = await charge('org-1', 1);

      expect(row).toMatchObject({ kind: 'RESEARCH', amount: -1 });
      expect(row.metadata).toEqual({ rocketReach: 'lookup' });
    });
  });

  describe('charging', () => {
    it('blocks with 402 INSUFFICIENT_CREDITS, the balance and what was needed', async () => {
      const { ledger, charge } = setup({ allowance: 1 });

      const error = await charge('org-1', 2).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InsufficientCreditsException);
      const exception = error as InsufficientCreditsException;
      expect(exception.getStatus()).toBe(402);
      expect(exception.getResponse()).toMatchObject({
        balance: 1,
        required: 2,
      });
      expect(ledger.kinds('org-1')).toEqual(['MONTHLY_GRANT:1']);
    });

    it('never overspends under concurrent research runs', async () => {
      const { ledger, charge } = setup({ allowance: 3 });

      const outcomes = await Promise.allSettled(
        Array.from({ length: 10 }, () => charge('org-1', 1)),
      );

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(3);
      const rejected = outcomes.filter(
        (o): o is PromiseRejectedResult => o.status === 'rejected',
      );
      expect(rejected).toHaveLength(7);
      for (const { reason } of rejected) {
        expect(reason).toBeInstanceOf(InsufficientCreditsException);
      }
      expect(ledger.balance('org-1')).toBe(0);
    });

    it('(control) the same race overspends without the lock', async () => {
      const { ledger, charge } = setup({ allowance: 3, lockless: true });

      await Promise.allSettled(
        Array.from({ length: 10 }, () => charge('org-1', 1)),
      );

      expect(ledger.balance('org-1')).toBeLessThan(0);
    });
  });

  describe('refunds', () => {
    it('refunds a part once, into the charge’s period', async () => {
      const { ledger, service, charge } = setup({ allowance: 5 });
      const charged = await charge('org-1', 2);

      const refund = () =>
        service.refund(charged, {
          credits: 1,
          part: 'rocketreach',
          reason: 'no match',
        });
      await refund();
      await refund();

      expect(ledger.balance('org-1')).toBe(5 - 2 + 1);
      const refunds = ledger.rows.filter((row) => row.kind === 'REFUND');
      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({
        period: '2026-11',
        idempotency_key: `refund:${charged.uid}:rocketreach`,
      });
    });
  });

  describe('adjustments', () => {
    it('can’t take the balance below zero', async () => {
      const { ledger, service } = setup({ allowance: 5 });

      await expect(
        service.adjust(
          {
            organizationId: 'org-1',
            userId: 'staff',
            amount: -6,
            reason: 'oops',
          },
          NOV,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(ledger.balance('org-1')).toBe(5);
    });
  });
});
