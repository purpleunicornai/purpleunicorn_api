import { createHash } from 'crypto';
import { HttpStatus } from '@nestjs/common';
import { RequestException } from '../../common/exception/core/ExceptionBase';
import { SearchQueryPlan } from './build-search-query';

export const SEARCH_PAGE_TOKEN_PREFIX = 's1.';
// 8-char base36 SHA-1 (~41 bits) plus a 500-key cap keeps the token to a
// few KB after deep pagination, with a negligible chance of a collision.
export const SEEN_KEY_LENGTH = 8;
export const MAX_SEEN_KEYS = 500;
const SEEN_KEY_PATTERN = /^[0-9a-z]{8}$/;

export type SinglePageToken = {
  kind: 'single';
  page: number;
  token: string;
  seen: string[];
};
export type SplitPageToken = {
  kind: 'split';
  page: number;
  local?: string;
  remote?: string;
  seen: string[];
};
export type SearchPageToken = SinglePageToken | SplitPageToken;

export type SearchPageTokenInput = {
  kind: 'single' | 'split';
  page: number;
  token?: string;
  local?: string;
  remote?: string;
  seen?: string[];
};

export function hashCandidateKey(key: string): string {
  const digest = createHash('sha1').update(key, 'utf8').digest();
  let n = 0n;
  for (let i = 0; i < 6; i++) {
    n = (n << 8n) + BigInt(digest[i]);
  }
  return n.toString(36).padStart(SEEN_KEY_LENGTH, '0').slice(-SEEN_KEY_LENGTH);
}

export function appendSeenKeys(previous: string[], keys: string[]): string[] {
  const next = previous.slice();
  for (const key of keys) {
    const hashed = hashCandidateKey(key);
    if (!next.includes(hashed)) next.push(hashed);
  }
  return next.length > MAX_SEEN_KEYS ? next.slice(-MAX_SEEN_KEYS) : next;
}

export function dropSeen<T extends { key: string }>(
  candidates: T[],
  seen: readonly string[],
): { unique: T[]; skippedDuplicates: number } {
  if (seen.length === 0) return { unique: candidates, skippedDuplicates: 0 };
  const seenSet = new Set(seen);
  const unique: T[] = [];
  let skippedDuplicates = 0;
  for (const candidate of candidates) {
    if (seenSet.has(hashCandidateKey(candidate.key))) {
      skippedDuplicates += 1;
      continue;
    }
    unique.push(candidate);
  }
  return { unique, skippedDuplicates };
}

export function encodeSearchPageToken(
  parts: SearchPageTokenInput,
): string | undefined {
  const payload: Record<string, unknown> = {
    kind: parts.kind,
    page: parts.page,
  };
  if (parts.kind === 'single') {
    if (!parts.token) return undefined;
    payload.token = parts.token;
  } else if (parts.local || parts.remote) {
    if (parts.local) payload.local = parts.local;
    if (parts.remote) payload.remote = parts.remote;
  } else {
    return undefined;
  }
  if (parts.seen?.length) payload.seen = parts.seen;
  return (
    SEARCH_PAGE_TOKEN_PREFIX +
    Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  );
}

// Parses the opaque pageToken from the request. Every paginated search,
// single-stream or split, uses the same s1. token. Anything else, including
// a raw Vertex token, is rejected at the boundary.
export function parseSearchPageToken(
  raw?: string,
): SearchPageToken | undefined {
  const token = raw?.trim();
  if (!token) return undefined;
  if (!token.startsWith(SEARCH_PAGE_TOKEN_PREFIX)) {
    throw invalidPageToken();
  }
  return decodePayload(token);
}

export function assertPageTokenMatchesPlan(
  plan: SearchQueryPlan,
  token?: SearchPageToken,
): void {
  if (!token) return;
  if (plan.kind !== token.kind) throw invalidPageToken();
}

function decodePayload(token: string): SearchPageToken {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(
        token.slice(SEARCH_PAGE_TOKEN_PREFIX.length),
        'base64url',
      ).toString('utf8'),
    );
  } catch {
    throw invalidPageToken();
  }
  if (!isPageTokenPayload(parsed)) throw invalidPageToken();
  const seen = parsed.seen ?? [];
  if (parsed.kind === 'single') {
    return { kind: 'single', page: parsed.page, token: parsed.token, seen };
  }
  return {
    kind: 'split',
    page: parsed.page,
    ...(parsed.local ? { local: parsed.local } : {}),
    ...(parsed.remote ? { remote: parsed.remote } : {}),
    seen,
  };
}

type PageTokenPayload =
  | {
      kind: 'single';
      page: number;
      token: string;
      seen?: string[];
    }
  | {
      kind: 'split';
      page: number;
      local?: string;
      remote?: string;
      seen?: string[];
    };

function isPageTokenPayload(value: unknown): value is PageTokenPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const allowed = new Set(['kind', 'page', 'token', 'local', 'remote', 'seen']);
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some((key) => !allowed.has(key))) return false;
  if (obj.kind !== 'single' && obj.kind !== 'split') return false;
  if (
    typeof obj.page !== 'number' ||
    !Number.isInteger(obj.page) ||
    obj.page < 1
  ) {
    return false;
  }
  if (obj.seen !== undefined && !isSeenList(obj.seen)) return false;
  if (obj.kind === 'single') {
    return (
      typeof obj.token === 'string' &&
      obj.token.length > 0 &&
      obj.local == null &&
      obj.remote == null
    );
  }
  const hasLocal = typeof obj.local === 'string' && obj.local.length > 0;
  const hasRemote = typeof obj.remote === 'string' && obj.remote.length > 0;
  return (
    obj.token == null &&
    (hasLocal || hasRemote) &&
    (obj.local == null || hasLocal) &&
    (obj.remote == null || hasRemote)
  );
}

function isSeenList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_SEEN_KEYS &&
    value.every(
      (entry) => typeof entry === 'string' && SEEN_KEY_PATTERN.test(entry),
    )
  );
}

function invalidPageToken(): RequestException {
  return new RequestException(
    'Invalid pageToken',
    HttpStatus.BAD_REQUEST,
    'INVALID_PAGE_TOKEN',
  );
}
