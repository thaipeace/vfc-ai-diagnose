import { SetMetadata } from '@nestjs/common';
import { THROTTLE_META_KEYS } from './security.constants';

/**
 * Decorator bỏ qua kiểm tra Rate Limit (dùng cho health check, swagger, internal route)
 */
export const SkipThrottle = () => SetMetadata(THROTTLE_META_KEYS.SKIP, true);

/**
 * Decorator tùy biến giới hạn riêng cho từng endpoint
 */
export interface CustomThrottleOptions {
  limit: number;
  ttl: number; // in seconds
}

export const CustomThrottle = (options: CustomThrottleOptions) =>
  SetMetadata(THROTTLE_META_KEYS.CUSTOM, options);
