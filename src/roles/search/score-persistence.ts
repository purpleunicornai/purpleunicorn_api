import type {
  CandidateScoreCategory,
  CandidateScoreResult,
} from './candidate-scoring.service';

// role_result's score columns from one run of the fixed algorithm.
export function scoreColumns(result: CandidateScoreResult) {
  return {
    score: result.score,
    disqualified: result.disqualified,
    pre_disqualification_score: result.disqualified ? result.rawScore : null,
    disqualified_reasons: result.missedNonNegotiables.map(
      (missed) => missed.requirement,
    ),
  };
}

// A role_result's score breakdown rows. The breakdown is replaced on every
// save rather than diffed, since the category set and weights are re-derived
// from scratch each time. weight is an Int column, but the scorer divides the
// 80/20 buckets evenly (80/3 = 26.666...); rounding it the same way score is
// rounded means a full match can never show more points than its weight.
export function scoreBreakdownRows(
  roleResultId: string,
  filterId: string,
  breakdown: CandidateScoreCategory[],
  // Per row: its points before research changed it, else null.
  researchBefore: (number | null)[] = [],
) {
  return breakdown.map((entry, index) => ({
    role_result_id: roleResultId,
    role_filter_id: filterId,
    category: entry.category,
    weight: Math.round(entry.weight),
    applicable: entry.applicable,
    score: Math.round(entry.earned),
    metadata: {
      requirement: entry.requirement,
      priority: entry.priority,
      nonNegotiable: entry.nonNegotiable,
      ...(researchBefore[index] != null
        ? { researchBefore: Math.round(researchBefore[index]) }
        : {}),
    },
  }));
}
