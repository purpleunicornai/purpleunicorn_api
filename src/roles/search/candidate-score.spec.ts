import { applyScores, IndexedCandidateScore } from './candidate-score';
import { seedCandidate } from './candidate-profile';
import { Candidate } from './extract-candidate';

const candidates: Candidate[] = ['A', 'B', 'C'].map((name) => {
  const linkedinUrl = `https://www.linkedin.com/in/${name.toLowerCase()}`;
  return {
    name,
    key: name.toLowerCase(),
    linkedinUrl,
    candidate: seedCandidate({ name, linkedinUrl }),
  };
});

function score(index: number, value: number): IndexedCandidateScore {
  return {
    index,
    score: value,
    skills_matched: [],
    missing: [],
    reasoning: `${index}`,
    nonNegotiableUnconfirmed: [],
  };
}

describe('applyScores', () => {
  it('merges by index and sorts by score, best first', () => {
    const result = applyScores(candidates, [
      score(0, 20),
      score(1, 90),
      score(2, 55),
    ]);
    expect(result.map((c) => [c.name, c.score, c.reasoning])).toEqual([
      ['B', 90, '1'],
      ['C', 55, '2'],
      ['A', 20, '0'],
    ]);
  });

  it('keeps candidates the model skipped, unscored, at the end in order', () => {
    const result = applyScores(candidates, [score(2, 10)]);
    expect(result.map((c) => c.name)).toEqual(['C', 'A', 'B']);
    expect(result[1].score).toBeUndefined();
  });

  it('ignores unknown or duplicate indexes and clamps scores', () => {
    const result = applyScores(candidates, [
      score(7, 99),
      score(0, 140),
      score(0, 5),
      score(1, -3),
    ]);
    expect(result.map((c) => [c.name, c.score])).toEqual([
      ['A', 100],
      ['B', 0],
      ['C', undefined],
    ]);
  });

  it('merges a grounded candidate record onto the seed while sorting', () => {
    const result = applyScores(candidates, [
      {
        ...score(1, 90),
        candidate: { skills: ['ReactJS', 'TypeScript'] },
      },
    ]);
    expect(result[0]).toMatchObject({
      name: 'B',
      score: 90,
      candidate: {
        first_name: 'B',
        skills: ['react', 'typescript'],
        sources: [
          {
            title: 'B',
            source: 'LinkedIn',
            url: 'https://www.linkedin.com/in/b',
            main: true,
            type: 'SEARCH',
          },
        ],
      },
    });
    expect(result[1].candidate.skills).toBeUndefined();
  });
});
