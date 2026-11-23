import {
  creditPeriodOf,
  periodResetsAt,
  unusedAllowance,
} from './credit-ledger';

describe('credit periods', () => {
  it('is the UTC calendar month', () => {
    expect(creditPeriodOf(new Date('2026-11-30T23:59:59Z'))).toBe('2026-11');
    expect(creditPeriodOf(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12');
  });

  it('resets on the 1st of next month, across a year end', () => {
    expect(periodResetsAt(new Date('2026-11-18T12:00:00Z')).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
    expect(periodResetsAt(new Date('2026-12-31T23:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('unusedAllowance', () => {
  it('is the grant minus what research used', () => {
    expect(unusedAllowance({ granted: 50, netSpend: 12, balance: 38 })).toBe(
      38,
    );
  });

  it('never takes purchased credits: capped at the grant left, not the balance', () => {
    expect(unusedAllowance({ granted: 50, netSpend: 12, balance: 138 })).toBe(
      38,
    );
  });

  it('is zero once research used the whole grant (and dipped into purchases)', () => {
    expect(unusedAllowance({ granted: 50, netSpend: 70, balance: 80 })).toBe(0);
  });

  it('never exceeds the balance (e.g. after a negative adjustment)', () => {
    expect(unusedAllowance({ granted: 50, netSpend: 0, balance: 20 })).toBe(20);
  });
});
