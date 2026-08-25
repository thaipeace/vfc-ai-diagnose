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
            servername: url.hostname,
          }
        : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      keepAlive: 10000,
      connectTimeout: 20000,
      retryStrategy: (times) => Math.min(times * 200, 2000),
      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
        return targetErrors.some((e) => err.message.includes(e));
      },
    };
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  };
};
