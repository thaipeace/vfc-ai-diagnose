import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import IORedis, { Redis } from 'ioredis';
import { getRedisConnectionOptions } from '../../config/redis.config';

export interface RateLimitCheckResult {
  isBlocked: boolean;
  current: number;
  limit: number;
  ttlRemaining: number;
}

@Injectable()
export class ThrottlerStorageRedisService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ThrottlerStorageRedisService.name);
  private redis: Redis;

  // Lua script atomic increment & TTL
  // Trả về: [count, ttl_remaining]
  private readonly INCR_WITH_TTL_SCRIPT = `
    local current = redis.call('INCR', KEYS[1])
    if current == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    local ttl = redis.call('TTL', KEYS[1])
    return {current, ttl}
  `;

  onModuleInit() {
    const opts = getRedisConnectionOptions();
    this.redis = new IORedis(opts);

    this.redis.on('connect', () => {
      this.logger.log('Throttler Redis client connected successfully');
    });

    this.redis.on('error', (err) => {
      this.logger.warn(`Throttler Redis connection error: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  /**
   * Tăng bộ đếm và kiểm tra giới hạn (Atomic)
   * @param key Redis Key
   * @param limit Số lượt tối đa cho phép
   * @param ttlSeconds Thời gian sống của key (giây)
   */
  async checkAndIncrement(
    key: string,
    limit: number,
    ttlSeconds: number,
  ): Promise<RateLimitCheckResult> {
    try {
      // Thực thi atomic qua Lua script
      const res = (await this.redis.eval(
        this.INCR_WITH_TTL_SCRIPT,
        1,
        key,
        ttlSeconds,
      )) as [number, number];

      const current = Number(res[0]);
      let ttlRemaining = Number(res[1]);

      // Nếu key không có TTL hoặc bị âm, fallback về ttlSeconds
      if (ttlRemaining <= 0) {
        ttlRemaining = ttlSeconds;
      }

      return {
        isBlocked: current > limit,
        current,
        limit,
        ttlRemaining,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to check rate limit in Redis for key ${key}: ${err.message}`,
      );
      // Fallback: nếu Redis gặp sự cố, không chặn người dùng bình thường (Fail-open)
      return {
        isBlocked: false,
        current: 1,
        limit,
        ttlRemaining: ttlSeconds,
      };
    }
  }

  /**
   * Lấy thời gian còn lại của key mà không tăng bộ đếm
   */
  async getTtl(key: string): Promise<number> {
    try {
      const ttl = await this.redis.ttl(key);
      return ttl > 0 ? ttl : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Xóa key (dùng để reset quota trong unit test hoặc admin tool)
   */
  async reset(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err: any) {
      this.logger.warn(`Failed to reset key ${key}: ${err.message}`);
    }
  }
}
