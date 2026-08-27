import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import {
  SECURITY_KEYS,
  DEFAULT_SECURITY_LIMITS,
  THROTTLE_META_KEYS,
  ThrottleErrorPayload,
  ThrottleLimitType,
} from './security.constants';
import {
  ThrottlerStorageRedisService,
  RateLimitCheckResult,
} from './throttler-storage-redis.service';
import { CustomThrottleOptions } from './security.decorators';

@Injectable()
export class SecurityThrottlerGuard implements CanActivate {
  private readonly logger = new Logger(SecurityThrottlerGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly storage: ThrottlerStorageRedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Kiểm tra decorator @SkipThrottle()
    const isSkipped = this.reflector.getAllAndOverride<boolean>(
      THROTTLE_META_KEYS.SKIP,
      [context.getHandler(), context.getClass()],
    );

    if (isSkipped) {
      return true;
    }

    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest<Request>();
    const res = httpContext.getResponse<Response>();

    // 2. Trích xuất Client IP & User ID
    const clientIp = this.getClientIp(req);
    const userId = (req.headers['x-user-id'] as string) || req.body?.userId;

    // Đọc custom throttle nếu có cấu hình riêng cho handler
    const customOptions =
      this.reflector.getAllAndOverride<CustomThrottleOptions>(
        THROTTLE_META_KEYS.CUSTOM,
        [context.getHandler(), context.getClass()],
      );

    // ──────────────────────────────────────────────────────────────────────────
    // TẦNG 1: KIỂM TRA IP BURST SHIELD (Chống flood bot/DDoS)
    // ──────────────────────────────────────────────────────────────────────────
    const ipKey = `${SECURITY_KEYS.IP_BURST}:${clientIp}`;
    const ipLimit = DEFAULT_SECURITY_LIMITS.IP_BURST_LIMIT;
    const ipTtl = DEFAULT_SECURITY_LIMITS.IP_BURST_TTL;

    const ipResult = await this.storage.checkAndIncrement(
      ipKey,
      ipLimit,
      ipTtl,
    );

    if (ipResult.isBlocked) {
      this.handleBlockedRequest(res, ipResult, 'IP_BURST', clientIp);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // TẦNG 2 & 3: KIỂM TRA USER LIMITS (NẾU CÓ USER ID)
    // ──────────────────────────────────────────────────────────────────────────
    if (userId) {
      // A. Short-term User Burst (Mặc định: 3 lượt / 60 giây)
      const userShortKey = `${SECURITY_KEYS.USER_SHORT_TERM}:${userId}`;
      const userShortLimit =
        customOptions?.limit || DEFAULT_SECURITY_LIMITS.USER_SHORT_TERM_LIMIT;
      const userShortTtl =
        customOptions?.ttl || DEFAULT_SECURITY_LIMITS.USER_SHORT_TERM_TTL;

      const userShortResult = await this.storage.checkAndIncrement(
        userShortKey,
        userShortLimit,
        userShortTtl,
      );

      if (userShortResult.isBlocked) {
        this.handleBlockedRequest(
          res,
          userShortResult,
          'SHORT_TERM',
          userId,
        );
      }

      // B. Daily User Quota (Mặc định: 30 lượt / 24 giờ)
      const userDailyKey = `${SECURITY_KEYS.USER_DAILY_QUOTA}:${userId}`;
      const userDailyLimit = DEFAULT_SECURITY_LIMITS.USER_DAILY_QUOTA_LIMIT;
      const userDailyTtl = DEFAULT_SECURITY_LIMITS.USER_DAILY_QUOTA_TTL;

      const userDailyResult = await this.storage.checkAndIncrement(
        userDailyKey,
        userDailyLimit,
        userDailyTtl,
      );

      if (userDailyResult.isBlocked) {
        this.handleBlockedRequest(
          res,
          userDailyResult,
          'DAILY_QUOTA',
          userId,
        );
      }

      // Gắn thông tin Rate Limit headers cho client
      this.attachRateLimitHeaders(res, userShortResult);
    } else {
      // Nếu không có userId (request từ public), dùng thông tin của IP
      this.attachRateLimitHeaders(res, ipResult);
    }

    return true;
  }

  /**
   * Xử lý và ném Exception khi bị chạm ngưỡng Rate Limit
   */
  private handleBlockedRequest(
    res: Response,
    result: RateLimitCheckResult,
    limitType: ThrottleLimitType,
    identifier: string,
  ): never {
    const retryAfter = Math.max(1, result.ttlRemaining);

    // Gán response headers chuẩn RFC
    res.setHeader('Retry-After', retryAfter);
    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader(
      'X-RateLimit-Reset',
      Math.floor(Date.now() / 1000) + retryAfter,
    );

    let userMessage = 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.';
    if (limitType === 'SHORT_TERM') {
      userMessage = `Hệ thống đang xử lý yêu cầu trước của bạn. Vui lòng chờ ${retryAfter} giây để tiếp tục.`;
    } else if (limitType === 'DAILY_QUOTA') {
      userMessage = `Bạn đã sử dụng hết hạn mức chẩn đoán trong ngày (${result.limit} lượt/ngày). Vui lòng quay lại vào ngày mai.`;
    } else if (limitType === 'IP_BURST') {
      userMessage = `Địa chỉ IP của bạn đang gửi yêu cầu quá nhanh. Vui lòng chờ ${retryAfter} giây.`;
    }

    this.logger.warn(
      `[RateLimit Blocked] Type: ${limitType}, Identifier: ${identifier}, Current: ${result.current}/${result.limit}, RetryAfter: ${retryAfter}s`,
    );

    const errorPayload: ThrottleErrorPayload = {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'Too Many Requests',
      message: userMessage,
      limitType,
      retryAfter,
      limit: result.limit,
      current: result.current,
    };

    throw new HttpException(errorPayload, HttpStatus.TOO_MANY_REQUESTS);
  }

  /**
   * Gắn các HTTP Headers RateLimit vào response hợp lệ
   */
  private attachRateLimitHeaders(
    res: Response,
    result: RateLimitCheckResult,
  ): void {
    const remaining = Math.max(0, result.limit - result.current);
    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader(
      'X-RateLimit-Reset',
      Math.floor(Date.now() / 1000) + result.ttlRemaining,
    );
  }

  /**
   * Lấy chính xác địa chỉ IP của Client kể cả khi đi qua proxy / reverse-proxy (Vercel, Cloudflare)
   */
  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const forwardedIps = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded.split(',')[0];
      return forwardedIps.trim();
    }
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
  }
}
