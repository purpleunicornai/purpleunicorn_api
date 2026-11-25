import { HttpStatus } from '@nestjs/common';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import { SearchQueryPlan } from './build-search-query';
import {
  MAX_SEEN_KEYS,
  SEARCH_PAGE_TOKEN_PREFIX,
  SEEN_KEY_LENGTH,
  appendSeenKeys,
  assertPageTokenMatchesPlan,
  dropSeen,
  encodeSearchPageToken,
  hashCandidateKey,
  parseSearchPageToken,
} from './search-page-token';

const splitPlan: SearchQueryPlan = {
  kind: 'split',
  locationQuery: 'location',
  remoteQuery: 'remote',
};
const singlePlan: SearchQueryPlan = { kind: 'single', query: 'q' };

function expectInvalidToken(token?: string) {
  try {
    parseSearchPageToken(token);
    throw new Error(`expected ${token} to throw`);
  } catch (error) {
    expect(error).toBeInstanceOf(RequestException);
    expect((error as RequestException).getStatus()).toBe(
      HttpStatus.BAD_REQUEST,
    );
  }
}

describe('search page tokens', () => {
  it('encodes a split token and decodes it back', () => {
    const seen = [hashCandidateKey('ann')];
    const token = encodeSearchPageToken({
      kind: 'split',
      page: 2,
      local: 'L1',
      remote: 'R1',
      seen,
    });
    expect(token).toMatch(new RegExp(`^${SEARCH_PAGE_TOKEN_PREFIX}`));
    expect(parseSearchPageToken(token)).toEqual({
      kind: 'split',
      page: 2,
      local: 'L1',
      remote: 'R1',
      seen,
    });
  });

  it('encodes a single-stream token around the Vertex token', () => {
    const seen = [hashCandidateKey('ann'), hashCandidateKey('cat')];
    const token = encodeSearchPageToken({
      kind: 'single',
      page: 2,
      token: 'AN1-vertex',
      seen,
    });
    expect(parseSearchPageToken(token)).toEqual({
      kind: 'single',
      page: 2,
      token: 'AN1-vertex',
      seen,
    });
  });

  it('drops exhausted streams and returns nothing when both are done', () => {
    expect(
      encodeSearchPageToken({ kind: 'split', page: 3, local: 'L1' }),
    ).toEqual(
      expect.stringMatching(new RegExp(`^${SEARCH_PAGE_TOKEN_PREFIX}`)),
    );
    expect(
      parseSearchPageToken(
        encodeSearchPageToken({ kind: 'split', page: 3, local: 'L1' }),
      ),
    ).toEqual({ kind: 'split', page: 3, local: 'L1', seen: [] });
    expect(
      encodeSearchPageToken({
        kind: 'split',
        page: 4,
        local: '',
        remote: undefined,
      }),
    ).toBeUndefined();
    expect(
      encodeSearchPageToken({ kind: 'single', page: 2, token: '' }),
    ).toBeUndefined();
  });

  it('treats a missing or blank token as the first page', () => {
    expect(parseSearchPageToken('  ')).toBeUndefined();
    expect(parseSearchPageToken()).toBeUndefined();
  });

  it('rejects a raw Vertex token or a malformed composite token with 400', () => {
    const bad = [
      'AN1-vertex-next',
      'vertex-next',
      `${SEARCH_PAGE_TOKEN_PREFIX}%%%`,
      `${SEARCH_PAGE_TOKEN_PREFIX}${Buffer.from('[]', 'utf8').toString('base64url')}`,
      `${SEARCH_PAGE_TOKEN_PREFIX}${Buffer.from('{}', 'utf8').toString('base64url')}`,
      // Old split payload without kind/page.
      `${SEARCH_PAGE_TOKEN_PREFIX}${Buffer.from(JSON.stringify({ local: 'L1', remote: 'R1' }), 'utf8').toString('base64url')}`,
      `${SEARCH_PAGE_TOKEN_PREFIX}${Buffer.from(JSON.stringify({ kind: 'single', page: 2, token: '' }), 'utf8').toString('base64url')}`,
      `${SEARCH_PAGE_TOKEN_PREFIX}${Buffer.from(JSON.stringify({ kind: 'split', page: 0, local: 'L1' }), 'utf8').toString('base64url')}`,
      `${SEARCH_PAGE_TOKEN_PREFIX}${Buffer.from(JSON.stringify({ kind: 'split', page: 2, local: '' }), 'utf8').toString('base64url')}`,
      `${SEARCH_PAGE_TOKEN_PREFIX}${Buffer.from(JSON.stringify({ kind: 'single', page: 2, token: 'x', extra: 'y' }), 'utf8').toString('base64url')}`,
      `${SEARCH_PAGE_TOKEN_PREFIX}${Buffer.from(JSON.stringify({ kind: 'single', page: 2, token: 'x', seen: ['short'] }), 'utf8').toString('base64url')}`,
    ];
    for (const token of bad) {
      expectInvalidToken(token);
    }
  });

  it('rejects a token that does not match the query plan', () => {
    expect(() =>
      assertPageTokenMatchesPlan(splitPlan, {
        kind: 'single',
        page: 2,
        token: 'vertex',
        seen: [],
      }),
    ).toThrow(RequestException);
    expect(() =>
      assertPageTokenMatchesPlan(singlePlan, {
        kind: 'split',
        page: 2,
        local: 'L1',
        seen: [],
      }),
    ).toThrow(RequestException);
    expect(() =>
      assertPageTokenMatchesPlan(splitPlan, {
        kind: 'split',
        page: 2,
        local: 'L1',
        seen: [],
      }),
    ).not.toThrow();
    expect(() =>
      assertPageTokenMatchesPlan(singlePlan, {
        kind: 'single',
        page: 2,
        token: 'vertex',
        seen: [],
      }),
    ).not.toThrow();
  });
});

describe('seen candidate keys', () => {
  it('hashes a slug stably to an 8-char base36 value', () => {
    const hashed = hashCandidateKey('jongan69');
    expect(hashed).toHaveLength(SEEN_KEY_LENGTH);
    expect(hashed).toMatch(/^[0-9a-z]+$/);
    expect(hashCandidateKey('jongan69')).toBe(hashed);
    expect(hashCandidateKey('ann')).not.toBe(hashCandidateKey('bob'));
  });

  it('drops already-seen candidates and counts the skips', () => {
    const seen = appendSeenKeys([], ['ann', 'cat']);
    const { unique, skippedDuplicates } = dropSeen(
      [{ key: 'ann' }, { key: 'deb' }, { key: 'cat' }],
      seen,
    );
    expect(unique).toEqual([{ key: 'deb' }]);
    expect(skippedDuplicates).toBe(2);
    expect(dropSeen([{ key: 'ann' }], []).skippedDuplicates).toBe(0);
  });

  it('keeps the most recent hashed keys within the cap', () => {
    const keys = Array.from(
      { length: MAX_SEEN_KEYS + 5 },
      (_, i) => `slug-${i}`,
    );
    const seen = appendSeenKeys([], keys);
    expect(seen).toHaveLength(MAX_SEEN_KEYS);
    expect(seen[0]).toBe(hashCandidateKey('slug-5'));
    expect(seen[seen.length - 1]).toBe(hashCandidateKey('slug-504'));
    expect(seen).not.toContain(hashCandidateKey('slug-0'));
  });
});
