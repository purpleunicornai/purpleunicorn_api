import {
  addUsage,
  fromSdkUsage,
  parseResultUsage,
  recordUsage,
  shareOf,
} from './gemini-usage';

const usage = (inputTokens: number, outputTokens: number) => ({
  inputTokens,
  outputTokens,
  totalTokens: inputTokens + outputTokens,
});

describe('gemini usage', () => {
  it('reads input, output and total tokens off the SDK usage', () => {
    expect(
      fromSdkUsage({ inputTokens: 900, outputTokens: 120, totalTokens: 1020 }),
    ).toEqual(usage(900, 120));
  });

  it('treats a usage with any count missing as unreported, never as 0', () => {
    expect(fromSdkUsage({ totalTokens: 1020 })).toBeNull();
    expect(fromSdkUsage(undefined)).toBeNull();
  });

  it('sums the usages that were reported and is null when none were', () => {
    expect(addUsage(usage(10, 5), null, usage(20, 5))).toEqual(usage(30, 10));
    expect(addUsage(null, undefined)).toBeNull();
  });

  it("splits a batch call's usage evenly per result", () => {
    expect(shareOf(usage(1000, 300), 4)).toEqual({
      inputTokens: 250,
      outputTokens: 75,
      totalTokens: 325,
    });
  });

  it('adds a call to what is recorded, counting calls', () => {
    const first = recordUsage(undefined, usage(100, 20));
    expect(first).toEqual({ ...usage(100, 20), calls: 1 });
    expect(recordUsage(first, usage(50, 10))).toEqual({
      ...usage(150, 30),
      calls: 2,
    });
    expect(recordUsage(first, null)).toBe(first);
  });

  it("reads a result's recorded usage and drops anything malformed", () => {
    const scoring = { ...usage(100, 20), calls: 1 };
    expect(
      parseResultUsage({
        matchedBy: 'remote',
        geminiUsage: { scoring, research: { totalTokens: 'lots' } },
      }),
    ).toEqual({ scoring });
    expect(parseResultUsage(null)).toEqual({});
  });
});
