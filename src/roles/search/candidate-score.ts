import { Candidate } from './extract-candidate';
import {
  normalizeCandidate,
  type CandidateRecord,
  type RawCandidate,
} from './candidate-profile';

// Query-specific judgment. Field names follow purple_unicorn_api's
// role_result (score, summary, reasoning, skills_matched). `missing`
// and `nonNegotiableUnconfirmed` have no column there yet.
export interface CandidateScore {
  score: number;
  summary?: string;
  reasoning: string;
  skills_matched: string[];
  missing: string[];
  // Non-negotiable criteria the snippet doesn't confirm either way.
  nonNegotiableUnconfirmed: string[];
}

export interface IndexedCandidateScore extends CandidateScore {
  index: number;
  candidate?: RawCandidate;
}

export type ScoredCandidate = Candidate & Partial<CandidateScore>;

// Merges model scores onto candidates by index and sorts best first.
// Candidates the model skipped (or gave an unknown index) keep their
// original order at the end, unscored, rather than disappearing.
export function applyScores(
  candidates: Candidate[],
  scores: IndexedCandidateScore[],
): ScoredCandidate[] {
  const byIndex = new Map<number, IndexedCandidateScore>();
  for (const row of scores) {
    if (
      row.index >= 0 &&
      row.index < candidates.length &&
      !byIndex.has(row.index)
    ) {
      byIndex.set(row.index, {
        ...row,
        score: Math.max(0, Math.min(100, Math.round(row.score))),
      });
    }
  }
  const merged: ScoredCandidate[] = candidates.map((candidate, index) => {
    const row = byIndex.get(index);
    if (!row) return candidate;
    const { index: _index, candidate: extracted, ...score } = row;
    void _index;
    return {
      ...candidate,
      ...score,
      candidate: extracted
        ? normalizeCandidate(extracted, candidate.candidate)
        : candidate.candidate,
    };
  });
  return merged
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        (b.candidate.score ?? -1) - (a.candidate.score ?? -1) ||
        a.index - b.index,
    )
    .map(({ candidate }) => candidate);
}

export type { CandidateRecord };
