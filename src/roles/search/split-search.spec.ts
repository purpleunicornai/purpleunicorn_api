import { seedCandidate } from './candidate-profile';
import { Candidate } from './extract-candidate';
import {
  mergeStreamCandidates,
  rankLocalFirst,
  splitStreamPageSizes,
  sumEstimates,
} from './split-search';

function candidate(name: string): Candidate {
  const linkedinUrl = `https://www.linkedin.com/in/${name.toLowerCase()}`;
  return {
    name,
    key: name.toLowerCase(),
    linkedinUrl,
    candidate: seedCandidate({ name, linkedinUrl }),
  };
}

describe('splitStreamPageSizes', () => {
  it('splits pageSize across both streams and keeps each Vertex call at or below pageSize', () => {
    expect(splitStreamPageSizes(20, { local: true, remote: true })).toEqual({
      local: 10,
      remote: 10,
    });
    expect(splitStreamPageSizes(3, { local: true, remote: true })).toEqual({
      local: 2,
      remote: 1,
    });
    expect(splitStreamPageSizes(1, { local: true, remote: true })).toEqual({
      local: 1,
      remote: 1,
    });
  });

  it('gives the full pageSize to the stream that still has results', () => {
    expect(splitStreamPageSizes(20, { local: true, remote: false })).toEqual({
      local: 20,
    });
    expect(splitStreamPageSizes(20, { local: false, remote: true })).toEqual({
      remote: 20,
    });
    expect(splitStreamPageSizes(20, { local: false, remote: false })).toEqual(
      {},
    );
  });
});

describe('mergeStreamCandidates', () => {
  it('tags the stream, puts locals first and keeps the local copy on a duplicate key', () => {
    const localAnn = { ...candidate('Ann'), snippet: 'Cape Town' };
    const remoteAnn = { ...candidate('Ann'), snippet: 'Remote' };
    const bob = candidate('Bob');
    const merged = mergeStreamCandidates([localAnn], [remoteAnn, bob]);
    expect(merged.map((row) => [row.name, row.matchedBy, row.snippet])).toEqual(
      [
        ['Ann', 'location', 'Cape Town'],
        ['Bob', 'remote', undefined],
      ],
    );
  });
});

describe('rankLocalFirst', () => {
  it('keeps location matches ahead of remotes after a score sort', () => {
    const ranked = rankLocalFirst([
      { name: 'RemoteStar', matchedBy: 'remote' as const, score: 95 },
      { name: 'Local', matchedBy: 'location' as const, score: 40 },
      { name: 'Remote', matchedBy: 'remote' as const, score: 80 },
    ]);
    expect(ranked.map((row) => row.name)).toEqual([
      'Local',
      'RemoteStar',
      'Remote',
    ]);
  });
});

describe('sumEstimates', () => {
  it('sums the estimates that are present and stays undefined when none are', () => {
    expect(sumEstimates(100, 40)).toBe(140);
    expect(sumEstimates(100, undefined)).toBe(100);
    expect(sumEstimates(undefined, undefined)).toBeUndefined();
  });
});
