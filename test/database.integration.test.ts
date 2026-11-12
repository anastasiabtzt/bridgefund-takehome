import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { openTestDatabase } from './support/test-database.js';

test('connects to real PostgreSQL through the application pg/Drizzle connection', async () => {
  const database = await openTestDatabase();
  try {
    await database.onModuleInit();
    const result = await database.db.execute<{ connected: number; version: string }>(
      sql`select 1::integer as connected, version() as version`,
    );
    assert.equal(result.rows[0].connected, 1);
    assert.match(result.rows[0].version, /^PostgreSQL /);
    const settings = await database.pool.query<{ setting: string }>(
      "select setting from pg_settings where name = 'statement_timeout'",
    );
    assert.equal(Number(settings.rows[0].setting), Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 1000));
  } finally {
    await database.onModuleDestroy();
  }
});
