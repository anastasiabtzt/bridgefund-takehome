import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { seedPilot } from '../src/database/seed.js';
import type { OccupancySpace } from '../src/parking/occupancy.service.js';
import { openTestDatabase, testDatabaseUrl } from './support/test-database.js';

test('public occupancy reads committed PostgreSQL snapshots without allocation locks', async () => {
  const database = await openTestDatabase();
  const app = await NestFactory.create(AppModule.register(loadConfig({ ...process.env, DATABASE_URL: testDatabaseUrl() })), { logger: false });
  let writer: PoolClient | undefined;
  try {
    await database.pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public');
    await migrateDatabase(database);
    await seedPilot(database);
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/occupancy`;
    async function read(): Promise<OccupancySpace[]> {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return response.json() as Promise<OccupancySpace[]>;
    }
    // An occupied space with the same ID in another building must not leak in.
    await database.pool.query("insert into buildings values ('OTHER', 'UTC'); insert into spaces values ('OTHER', 1, 1, 'RESIDENT')");
    await database.pool.query(`insert into parking_sessions
      (building_id, space_id, normalized_plate, vehicle_type, is_resident, check_in_at)
      values ('OTHER', 1, 'OTHERPRIVATE', 'CAR', true, now())`);
    const empty = await read();
    assert.equal(empty.length, 150);
    empty.forEach((space, i) => assert.deepEqual(space, {
      parkingSpaceId: i + 1, eligibleFor: i < 50 ? 'RESIDENT' : 'VISITOR',
      vehicleTypes: i < 50 ? ['CAR', 'MOTOR'] : i < 130 ? ['CAR'] : ['MOTOR'], isOccupied: false,
    }));
    writer = await database.pool.connect();
    await writer.query('begin');
    // Holding the actual building row lock must not block public reads.
    await writer.query("select id from buildings where id='PB-AMS-9X4T' for update");
    const id = randomUUID();
    await writer.query(`insert into parking_sessions
      (id, building_id, space_id, normalized_plate, vehicle_type, is_resident, check_in_at)
      values ($1, 'PB-AMS-9X4T', 1, 'PRIVATEPLATE', 'CAR', true, '2026-11-12T08:00:00Z')`, [id]);
    assert.deepEqual(await read(), empty, 'uncommitted allocation is invisible on the HTTP reader connection');
    await writer.query('commit');
    assert.equal((await read())[0].isOccupied, true);
    await writer.query('begin');
    await writer.query(`update parking_sessions set state='COMPLETED', checkout_at='2026-11-12T09:00:00Z',
      duration_minutes=60, charge_cents=0, completed_at='2026-11-12T09:00:00Z' where id=$1`, [id]);
    assert.equal((await read())[0].isOccupied, true, 'uncommitted completion stays occupied');
    await writer.query('rollback');
    assert.equal((await read())[0].isOccupied, true, 'rolled-back completion has no effect');
    await writer.query('begin');
    await writer.query(`update parking_sessions set state='COMPLETED', checkout_at='2026-11-12T09:00:00Z',
      duration_minutes=60, charge_cents=0, completed_at='2026-11-12T09:00:00Z' where id=$1`, [id]);
    // A second allocation in the same transaction makes partial visibility detectable.
    await writer.query(`insert into parking_sessions
      (building_id, space_id, normalized_plate, vehicle_type, is_resident, state, check_in_at, checkout_at, duration_minutes, charge_cents)
      values ('PB-AMS-9X4T', 51, 'VISITORPRIVATE', 'CAR', false, 'AWAITING_PAYMENT',
      '2026-11-12T08:00:00Z', '2026-11-12T09:00:00Z', 60, 500)`);
    const before = await read();
    assert.equal(before[0].isOccupied, true);
    assert.equal(before[50].isOccupied, false);
    await writer.query('commit');
    const after = await read();
    assert.equal(after[0].isOccupied, false);
    assert.equal(after[50].isOccupied, true, 'awaiting payment retains allocation');
    await writer.query('begin');
    await writer.query(`insert into parking_sessions
      (building_id, space_id, normalized_plate, vehicle_type, is_resident, check_in_at)
      values ('PB-AMS-9X4T', 131, 'ROLLBACKPRIVATE', 'MOTOR', false, now())`);
    assert.equal((await read())[130].isOccupied, false);
    await writer.query('rollback');
    assert.equal((await read())[130].isOccupied, false, 'rolled-back allocation stays invisible');
    assert.doesNotMatch(JSON.stringify(after), /PRIVATE|building|session|payment|plate|floor/i);
  } finally {
    if (writer) { await writer.query('rollback'); writer.release(); }
    await app.close();
    await database.onModuleDestroy();
  }
});
