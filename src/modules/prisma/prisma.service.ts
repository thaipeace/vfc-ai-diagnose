import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({
      connectionString,
      ssl: connectionString?.includes('neon.tech')
        ? { rejectUnauthorized: false }
        : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Handle idle connection drops from Neon PgBouncer pooler gracefully
    pool.on('error', (err: any) => {
      if (
        err?.code === 'ECONNRESET' ||
        err?.message?.includes('ECONNRESET') ||
        err?.syscall === 'read'
      ) {
        // Benign: Neon closed an idle pool connection; pool auto-reconnects on next query
        return;
      }
      this.logger.error('Unexpected database pool error', err);
    });

    const adapter = new PrismaPg(pool as any);

    super({
      adapter,
      log:
        process.env.NODE_ENV === 'development'
          ? ['error', 'warn']
          : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
