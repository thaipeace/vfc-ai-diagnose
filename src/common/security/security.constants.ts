/**
 * Security & Rate Limiting Constants
 */

export const SECURITY_KEYS = {
  USER_SHORT_TERM: 'throttle:user:short',
  USER_DAILY_QUOTA: 'throttle:user:daily',
  IP_BURST: 'throttle:ip:burst',
  PENALTY_BLOCK: 'throttle:penalty:block',
} as const;

export const DEFAULT_SECURITY_LIMITS = {
  // Tầng 1: Tối đa 3 request trong 60 giây cho mỗi User
  USER_SHORT_TERM_LIMIT: 3,
  USER_SHORT_TERM_TTL: 60, // 60 giây

  // Tầng 2: Tối đa 30 request trong 24 giờ cho mỗi User (Hạn mức ngày)
  USER_DAILY_QUOTA_LIMIT: 30,
  USER_DAILY_QUOTA_TTL: 86400, // 24 giờ (86400s)

  // Tầng 3: Tối đa 10 request trong 60 giây cho mỗi IP (Chống botnet flood)
  IP_BURST_LIMIT: 10,
  IP_BURST_TTL: 60, // 60 giây
} as const;

export const THROTTLE_META_KEYS = {
  SKIP: 'security:skip_throttle',
  CUSTOM: 'security:custom_throttle',
} as const;

export type ThrottleLimitType = 'SHORT_TERM' | 'DAILY_QUOTA' | 'IP_BURST';

export interface ThrottleErrorPayload {
  statusCode: number;
  error: string;
  message: string;
  limitType: ThrottleLimitType;
  retryAfter: number;
  limit: number;
  current: number;
}
