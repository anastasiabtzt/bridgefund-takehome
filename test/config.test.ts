import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';

const databaseUrl = 'postgresql://local:local@127.0.0.1:5432/parkingbusiness';

test('rejects absent and invalid database configuration without exposing credentials', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL is required/);
  const secretUrl = 'https://user:private-password@localhost/database';
  assert.throws(() => loadConfig({ DATABASE_URL: secretUrl }), (error: Error) => {
    assert.match(error.message, /DATABASE_URL must be a PostgreSQL URL/);
    assert.ok(!error.message.includes('private-password'));
    return true;
  });
});

test('rejects invalid numeric settings and ineffective lock timeout ordering', () => {
  for (const value of ['0', '-1', '1.5', '', '65536', '3000abc']) {
    assert.throws(() => loadConfig({ DATABASE_URL: databaseUrl, PORT: value }), /PORT/);
  }
  assert.throws(() => loadConfig({ DATABASE_URL: databaseUrl, DB_LOCK_TIMEOUT_MS: '1000' }), /must be less/);
});

test('accepts explicit pool settings and keeps bounded defaults', () => {
  const config = loadConfig({ DATABASE_URL: databaseUrl, DB_POOL_MAX: '3' });
  assert.equal(config.poolMax, 3);
  assert.equal(config.connectionTimeoutMs, 250);
  assert.equal(config.statementTimeoutMs, 1000);
});
