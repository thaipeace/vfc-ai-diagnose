import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { getRedisConnectionOptions } from '../../config/redis.config';
import { SkipThrottle } from '../../common/security/security.decorators';
import IORedis from 'ioredis';

@ApiTags('health')
@Controller('health')
@SkipThrottle() // 👈 Miễn kiểm tra Rate Limit cho toàn bộ endpoint trong HealthController
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  async check() {
    let dbStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err: any) {
      dbStatus = `error: ${err.message}`;
    }

    let redisStatus = 'ok';
    let redisHost = 'unknown';
    try {
      const opts = getRedisConnectionOptions() as any;
      redisHost = opts.host || 'unknown';
      const client = new IORedis(opts);
      const pingRes = await Promise.race([
        client.ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis ping timeout 3s')), 3000),
        ),
      ]);
      await client.quit();
      redisStatus = `ok (${pingRes} to ${redisHost})`;
    } catch (err: any) {
      redisStatus = `error: ${err.message} (target: ${redisHost})`;
    }

    const isHealthy = dbStatus === 'ok' && redisStatus.startsWith('ok');

    return {
      status: isHealthy ? 'ok' : 'degraded',
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
