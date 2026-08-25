import { RedisOptions } from 'bullmq';

export const getRedisConnectionOptions = (): RedisOptions => {
  let redisUrlStr = process.env.REDIS_URL;

  // Fallback: If user entered UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
  if (
    !redisUrlStr &&
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    const host = process.env.UPSTASH_REDIS_REST_URL.replace(/^https?:\/\//, '');
    redisUrlStr = `rediss://default:${process.env.UPSTASH_REDIS_REST_TOKEN}@${host}:6379`;
  }

  if (redisUrlStr) {
    try {
      const url = new URL(redisUrlStr);
      const isTls = url.protocol === 'rediss:';

      return {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        username: url.username || 'default',
        password: url.password || undefined,
        tls: isTls
          ? {
              rejectUnauthorized: false,
              servername: url.hostname,
            }
          : undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        keepAlive: 10000,
        connectTimeout: 10000,
        retryStrategy: (times) => Math.min(times * 200, 2000),
      };
    } catch (e) {
      console.error('[Redis Config] Failed to parse REDIS_URL:', e);
    }
  }

  const host = process.env.REDIS_HOST || 'localhost';
  const isTls = host.includes('upstash.io') || process.env.REDIS_TLS === 'true';

  return {
    host,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    tls: isTls
      ? {
          rejectUnauthorized: false,
          servername: host,
        }
      : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10000,
    connectTimeout: 10000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  };
};
