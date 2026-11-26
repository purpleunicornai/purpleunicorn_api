import {
  REDIS_CONNECT_TIMEOUT_MS,
  REDIS_RETRY_CAP_MS,
  REDIS_RETRY_LIMIT,
  redisConnection,
  redisRetryStrategy,
} from './redis.connection';

describe('redisRetryStrategy', () => {
  it('backs off, caps, then stops so reconnects cannot storm DNS', () => {
    expect(redisRetryStrategy(1)).toBe(200);
    expect(redisRetryStrategy(5)).toBe(1_000);
    expect(redisRetryStrategy(REDIS_RETRY_LIMIT)).toBe(
      Math.min(REDIS_RETRY_LIMIT * 200, REDIS_RETRY_CAP_MS),
    );
    expect(redisRetryStrategy(REDIS_RETRY_LIMIT + 1)).toBeNull();
  });
});

describe('redisConnection', () => {
  const original = process.env.REDIS_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
  });

  it('throws when no URL is configured', () => {
    delete process.env.REDIS_URL;
    expect(() => redisConnection()).toThrow('REDIS_URL is not set');
  });

  it('uses the given URL and the serverless-safe defaults', () => {
    const connection = redisConnection('rediss://example.db.redis.io:6379');
    expect(connection).toMatchObject({
      url: 'rediss://example.db.redis.io:6379',
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      family: 4,
    });
    expect(connection.retryStrategy).toBe(redisRetryStrategy);
  });

  it('reads REDIS_URL when none is passed', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(redisConnection().url).toBe('redis://localhost:6379');
  });
});
