import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { loadConfig } from '../src/config.js';
import { DatabaseService } from '../src/database/database.service.js';

test('connects to real PostgreSQL through the application pg/Drizzle connection', async () => {
  assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required; this test never silently skips.');
  const config = loadConfig({ ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL });
  const database = new DatabaseService(config);
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
    assert.equal(Number(settings.rows[0].setting), config.statementTimeoutMs);
  } finally {
    await database.onModuleDestroy();
  }
});
