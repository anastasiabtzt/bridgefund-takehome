import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testDatabaseUrl } from './support/test-database.js';

const valid = 'postgresql://parkingbusiness_test:local-test-only@127.0.0.1:5433/parkingbusiness_test';
test('test reset configuration fails closed before any connection', () => {
  assert.equal(testDatabaseUrl({ TEST_DATABASE_URL: valid }), valid);
  for (const value of [undefined, valid.replace(':5433/parkingbusiness_test', ':5433/parkingbusiness'),
    valid.replace('parkingbusiness_test:', 'parkingbusiness:'), `${valid}?dbname=parkingbusiness`,
    `${valid}#fragment`]) {
    assert.throws(() => testDatabaseUrl({ TEST_DATABASE_URL: value }));
  }
  assert.throws(() => testDatabaseUrl({ TEST_DATABASE_URL: valid, DATABASE_URL: valid }), /development/);
});
