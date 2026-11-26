import type { RedisOptions } from 'ioredis';

export const REDIS_CONNECT_TIMEOUT_MS = 10_000;
export const REDIS_RETRY_CAP_MS = 2_000;
export const REDIS_RETRY_LIMIT = 8;

// Bounded backoff for reconnects. Returning null stops retrying so a
// frozen or failing isolate doesn't keep calling getaddrinfo.
export function redisRetryStrategy(times: number): number | null {
  if (times > REDIS_RETRY_LIMIT) return null;
  return Math.min(times * 200, REDIS_RETRY_CAP_MS);
}

// Shared ioredis options for BullMQ (the queue and the worker each open
// their own clients from this). maxRetriesPerRequest must be null for a
// BullMQ worker. family 4 avoids a second IPv6 DNS lookup, which on
// Vercel has been a common source of getaddrinfo EBUSY. A rediss:// URL
// still enables TLS on its own.
export function redisConnection(
  url = process.env.REDIS_URL,
): RedisOptions & { url: string } {
  if (!url) throw new Error('REDIS_URL is not set');
  return {
    url,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    retryStrategy: redisRetryStrategy,
    family: 4,
  };
}
