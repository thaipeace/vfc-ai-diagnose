import { RedisOptions } from 'bullmq';

export const getRedisConnectionOptions = (): RedisOptions => {
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    const isTls = url.protocol === 'rediss:';

    return {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      username: url.username || undefined,
      password: url.password || undefined,
      tls: isTls
        ? {
            rejectUnauthorized: false,
          }
        : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      keepAlive: 10000,
      connectTimeout: 30000,
      family: 4,
      retryStrategy: (times) => Math.min(times * 500, 3000),
    };
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 500, 3000),
  };
};
