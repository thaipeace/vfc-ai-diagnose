import { Module, Global } from '@nestjs/common';
import { ThrottlerStorageRedisService } from './throttler-storage-redis.service';
import { SecurityThrottlerGuard } from './security-throttler.guard';

@Global()
@Module({
  providers: [ThrottlerStorageRedisService, SecurityThrottlerGuard],
  exports: [ThrottlerStorageRedisService, SecurityThrottlerGuard],
})
export class SecurityModule {}
