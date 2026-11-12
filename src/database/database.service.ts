import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;
  readonly db: ReturnType<typeof drizzle>;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.poolMax,
      connectionTimeoutMillis: config.connectionTimeoutMs,
      idleTimeoutMillis: config.poolIdleTimeoutMs,
      statement_timeout: config.statementTimeoutMs,
      lock_timeout: config.lockTimeoutMs,
      idle_in_transaction_session_timeout: config.idleTransactionTimeoutMs,
      application_name: 'parkingbusiness',
    });
    this.pool.on('error', () => this.logger.error('An idle PostgreSQL connection failed.'));
    this.db = drizzle(this.pool);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new Error('Database startup check failed: PostgreSQL is unavailable or rejected the connection. Check DATABASE_URL and the local database.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
