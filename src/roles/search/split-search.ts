import { Candidate } from './extract-candidate';

export const LOCATION_MATCH = 'location';
export const REMOTE_MATCH = 'remote';
export type StreamMatch = typeof LOCATION_MATCH | typeof REMOTE_MATCH;

export type StreamCandidate = Candidate & { matchedBy: StreamMatch };

export function splitStreamPageSizes(
  pageSize: number,
  active: { local: boolean; remote: boolean },
): { local?: number; remote?: number } {
  if (active.local && active.remote) {
    return {
      local: Math.ceil(pageSize / 2),
      remote: Math.max(1, Math.floor(pageSize / 2)),
    };
  }
  if (active.local) return { local: pageSize };
  if (active.remote) return { remote: pageSize };
  return {};
}

// Local hits keep their order and win on a duplicate key, then remotes
// fill in. The page is already local-first before scoring reorders it.
export function mergeStreamCandidates(
  local: Candidate[],
  remote: Candidate[],
): StreamCandidate[] {
  const seen = new Set<string>();
  const merged: StreamCandidate[] = [];
  for (const candidate of local) {
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    merged.push({ ...candidate, matchedBy: LOCATION_MATCH });
  }
  for (const candidate of remote) {
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    merged.push({ ...candidate, matchedBy: REMOTE_MATCH });
  }
  return merged;
}

// applyScores sorts by score globally; put location-stream candidates
// back in front so a high-scoring remote cannot bury a local match.
export function rankLocalFirst<T extends { matchedBy?: StreamMatch }>(
  candidates: T[],
): T[] {
  return [
    ...candidates.filter((candidate) => candidate.matchedBy === LOCATION_MATCH),
    ...candidates.filter((candidate) => candidate.matchedBy !== LOCATION_MATCH),
  ];
}

export function sumEstimates(
  ...sizes: Array<number | undefined>
): number | undefined {
  const present = sizes.filter((size): size is number => size != null);
  return present.length > 0
    ? present.reduce((sum, size) => sum + size, 0)
    : undefined;
}
