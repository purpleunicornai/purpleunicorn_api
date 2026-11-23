// Gemini token counts for one or more calls, from the AI SDK's `usage`
// (promptTokenCount → inputTokens; candidates + thinking → outputTokens).
// Type aliases, not interfaces, so they fit Prisma's JSON input type.
export type GeminiUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

// Usage recorded against one role_result, summed over every call that
// spent tokens on it; `calls` counts those calls (or research runs).
export type RecordedUsage = GeminiUsage & {
  calls: number;
};

// Where a result's usage lives: role_result.metadata.geminiUsage.
export type ResultGeminiUsage = {
  // The result's even share of each scoring batch it was scored in.
  scoring?: RecordedUsage;
  // This candidate's own deep research runs (search + structuring calls).
  research?: RecordedUsage;
};

type SdkUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
};

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Null when the SDK didn't report all three counts, so a missing count is
// never stored as a spend of 0.
export function fromSdkUsage(
  usage: SdkUsage | undefined | null,
): GeminiUsage | null {
  if (
    !usage ||
    !isCount(usage.inputTokens) ||
    !isCount(usage.outputTokens) ||
    !isCount(usage.totalTokens)
  ) {
    return null;
  }
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

// Sums usages; null only when none of them were reported.
export function addUsage(
  ...usages: (GeminiUsage | null | undefined)[]
): GeminiUsage | null {
  const known = usages.filter((usage): usage is GeminiUsage => !!usage);
  if (known.length === 0) return null;
  return {
    inputTokens: known.reduce((sum, usage) => sum + usage.inputTokens, 0),
    outputTokens: known.reduce((sum, usage) => sum + usage.outputTokens, 0),
    totalTokens: known.reduce((sum, usage) => sum + usage.totalTokens, 0),
  };
}

// One result's even share of a call that scored `count` results at once.
export function shareOf(usage: GeminiUsage, count: number): GeminiUsage {
  const share = (value: number) => Math.round(value / Math.max(count, 1));
  return {
    inputTokens: share(usage.inputTokens),
    outputTokens: share(usage.outputTokens),
    totalTokens: share(usage.totalTokens),
  };
}

function parseRecorded(value: unknown): RecordedUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  return isCount(v.inputTokens) &&
    isCount(v.outputTokens) &&
    isCount(v.totalTokens) &&
    isCount(v.calls)
    ? {
        inputTokens: v.inputTokens,
        outputTokens: v.outputTokens,
        totalTokens: v.totalTokens,
        calls: v.calls,
      }
    : undefined;
}

// Reads metadata.geminiUsage off a stored role_result, dropping anything
// malformed rather than trusting it.
export function parseResultUsage(metadata: unknown): ResultGeminiUsage {
  const raw =
    typeof metadata === 'object' && metadata !== null
      ? (metadata as { geminiUsage?: unknown }).geminiUsage
      : undefined;
  if (typeof raw !== 'object' || raw === null) return {};
  const { scoring, research } = raw as Record<string, unknown>;
  const parsed: ResultGeminiUsage = {};
  const s = parseRecorded(scoring);
  const r = parseRecorded(research);
  if (s) parsed.scoring = s;
  if (r) parsed.research = r;
  return parsed;
}

// Adds one more call's usage to what's already recorded. An unreported
// usage leaves the record as it was.
export function recordUsage(
  previous: RecordedUsage | undefined,
  next: GeminiUsage | null,
): RecordedUsage | undefined {
  if (!next) return previous;
  const sum = addUsage(previous, next)!;
  return { ...sum, calls: (previous?.calls ?? 0) + 1 };
}
