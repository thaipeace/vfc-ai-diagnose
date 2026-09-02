import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class GeoBlockGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Chỉ kích hoạt trên môi trường Production
    if (process.env.NODE_ENV !== 'production') {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const path = req.url || '';
    const userAgent = (req.headers['user-agent'] as string) || '';

    // 1. Whitelist UptimeRobot, Health Check, Root, Swagger Docs
    if (
      path === '/' ||
      path === '/health' ||
      path.includes('/health') ||
      path.includes('/api/docs') ||
      userAgent.toLowerCase().includes('uptimerobot')
    ) {
      return true;
    }

    // 2. Lấy mã quốc gia từ Cloudflare, Vercel, Render CDN headers
    const country =
      (req.headers['cf-ipcountry'] as string) ||
      (req.headers['x-vercel-ip-country'] as string) ||
      (req.headers['x-country'] as string) ||
      (req.headers['x-render-ip-country'] as string);

    // Chặn nếu có thông tin quốc gia và không phải Việt Nam (VN)
    if (country && country.toUpperCase() !== 'VN') {
      throw new HttpException(
        {
          error: 'GEO_RESTRICTED',
          message: 'VFC service is restricted to Vietnam territory only.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }
}
