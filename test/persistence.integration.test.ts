import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import { openTestDatabase } from './support/test-database.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { seedPilot } from '../src/database/seed.js';
import { settlementConcurrencyTests } from './settlement-concurrency.js';

const building = 'PB-AMS-9X4T';
async function session(client: PoolClient, plate = 'AB123C', space = 51, buildingId = building, resident = false): Promise<string> {
  const id = randomUUID();
  await client.query(`insert into parking_sessions
    (id, building_id, space_id, normalized_plate, vehicle_type, is_resident, check_in_at)
    values ($1, $2, $3, $4, 'CAR', $5, '2026-11-12T08:00:00Z')`, [id, buildingId, space, plate, resident]);
  return id;
}
const pgError = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

test('fresh PostgreSQL migrations, repeatable seed and persistence invariants', async (t) => {
  const database = await openTestDatabase();
  try {
    // Only the guarded, live-verified test identity may reach this reset.
    await database.pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public');
    await migrateDatabase(database);
    await seedPilot(database);

    async function rollbackCase(action: (client: PoolClient) => Promise<void>): Promise<void> {
      const client = await database.pool.connect();
      try { await client.query('begin'); await action(client); }
      finally { await client.query('rollback'); client.release(); }
    }

    await t.test('fresh migration and seed define exactly five domain tables and 150 eligible spaces', async () => {
      const tables = await database.pool.query("select tablename from pg_tables where schemaname = 'public' order by tablename");
      assert.deepEqual(tables.rows.map((row) => row.tablename), ['buildings', 'gate_request_outcomes', 'parking_sessions', 'payment_events', 'spaces']);
      const result = await database.pool.query('select id, floor, category from spaces where building_id = $1 order by id', [building]);
      assert.equal(result.rowCount, 150);
      result.rows.forEach((row, index) => {
        const id = index + 1;
        assert.deepEqual(row, { id, floor: id <= 75 ? 1 : 2, category: id <= 50 ? 'RESIDENT' : id <= 130 ? 'CAR' : 'MOTOR' });
      });
    });

    await t.test('migrations and seed rerun preserve sessions, outcomes, payments and existing configuration', async () => {
      const client = await database.pool.connect();
      const key = randomUUID();
      let id: string;
      try {
        id = await session(client, 'SEEDKEEP1', 130);
        await client.query(`update parking_sessions set state='AWAITING_PAYMENT', checkout_at='2026-11-12T09:10:00Z', duration_minutes=70, charge_cents=1000 where id=$1`, [id]);
        await client.query(`insert into gate_request_outcomes values
          ($1, 'CHECK_IN', $2, '{"vehicleType":"CAR","isResident":false,"normalizedLicensePlate":"SEEDKEEP1"}',
          $3, 201, $4)`, [building, key, id, JSON.stringify({ parkingSessionId: id, parkingSpaceId: 130 })]);
        await client.query("insert into payment_events values ('pilot', 'seed-failure', $1, $2, 1, 'USD', 'FAILED', 'FAILED')", [building, id]);
      } finally { client.release(); }
      await migrateDatabase(database);
      await seedPilot(database);
      assert.equal((await database.pool.query('select count(*)::int as n from parking_sessions where id = $1', [id])).rows[0].n, 1);
      assert.equal((await database.pool.query('select response_status from gate_request_outcomes where request_id=$1', [key])).rows[0].response_status, 201);
      assert.deepEqual((await database.pool.query("select amount_cents::text, currency, status from payment_events where payment_id='seed-failure'")).rows[0],
        { amount_cents: '1', currency: 'USD', status: 'FAILED' });
      assert.equal((await database.pool.query('select timezone from buildings where id = $1', [building])).rows[0].timezone, 'Europe/Amsterdam');
      assert.equal((await database.pool.query('select count(*)::int as n from spaces')).rows[0].n, 150);
    });

    async function snapshot() {
      const result: Record<string, unknown> = {};
      for (const table of ['buildings', 'spaces', 'parking_sessions', 'gate_request_outcomes', 'payment_events']) {
        result[table] = (await database.pool.query(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`)).rows;
      }
      return result;
    }

    for (const [name, mutation, restore] of [
      ['incorrect timezone', "update buildings set timezone='UTC' where id='PB-AMS-9X4T'", "update buildings set timezone='Europe/Amsterdam' where id='PB-AMS-9X4T'"],
      ['incorrect eligibility', "update spaces set category='RESIDENT' where building_id='PB-AMS-9X4T' and id=51", "update spaces set category='CAR' where building_id='PB-AMS-9X4T' and id=51"],
      ['incorrect vehicle type', "update spaces set category='MOTOR' where building_id='PB-AMS-9X4T' and id=51", "update spaces set category='CAR' where building_id='PB-AMS-9X4T' and id=51"],
      ['incorrect floor', "update spaces set floor=2 where building_id='PB-AMS-9X4T' and id=1", "update spaces set floor=1 where building_id='PB-AMS-9X4T' and id=1"],
      ['unexpected extra space', "insert into spaces values ('PB-AMS-9X4T', 151, 2, 'CAR')", "delete from spaces where building_id='PB-AMS-9X4T' and id=151"],
    ]) {
      await t.test(`seed rejects ${name} without changing any database records`, async () => {
        await database.pool.query(mutation);
        // Seed will try to restore this missing space before detecting the drift.
        // Its insertion must roll back along with the whole failed seed transaction.
        await database.pool.query('delete from spaces where building_id=$1 and id=150', [building]);
        try {
          const before = await snapshot();
          await assert.rejects(seedPilot(database), /Pilot seed validation failed:/);
          assert.deepEqual(await snapshot(), before);
        } finally {
          await database.pool.query(restore);
          await seedPilot(database);
        }
      });
    }

    await t.test('composite foreign keys reject a space from another building', () => rollbackCase(async (client) => {
      await client.query("insert into buildings values ('OTHER', 'Europe/Amsterdam')");
      await assert.rejects(session(client, 'CROSS1', 51, 'OTHER'), pgError('23503'));
    }));

    await t.test('plate and allocation uniqueness are scoped to a building', () => rollbackCase(async (client) => {
      await client.query("insert into buildings values ('OTHER', 'Europe/Amsterdam')");
      await client.query("insert into spaces values ('OTHER', 51, 1, 'CAR')");
      await session(client);
      await session(client, 'AB123C', 51, 'OTHER');
      await client.query('set constraints all immediate');
    }));

    await t.test('active plate uniqueness spans resident flags and eligibility ranges', () => rollbackCase(async (client) => {
      await session(client);
      await assert.rejects(client.query(`insert into parking_sessions
        (building_id, space_id, normalized_plate, vehicle_type, is_resident, check_in_at)
        values ($1, 1, 'AB123C', 'MOTOR', true, now())`, [building]), pgError('23505'));
    }));

    await t.test('active space uniqueness also covers AWAITING_PAYMENT', () => rollbackCase(async (client) => {
      const id = await session(client);
      await client.query(`update parking_sessions set state='AWAITING_PAYMENT', checkout_at='2026-11-12T09:10:00Z',
        duration_minutes=70, charge_cents=1000 where id=$1`, [id]);
      await assert.rejects(session(client, 'OTHER1'), pgError('23505'));
    }));

    for (const [name, update] of [
      ['missing frozen data', "state='AWAITING_PAYMENT'"],
      ['backwards checkout', "state='COMPLETED', checkout_at='2026-11-12T07:59:00Z', duration_minutes=0, charge_cents=0, completed_at=now()"],
      ['incorrect duration', "state='AWAITING_PAYMENT', checkout_at='2026-11-12T09:10:00Z', duration_minutes=69, charge_cents=1000"],
      ['negative money', "state='AWAITING_PAYMENT', checkout_at='2026-11-12T09:10:00Z', duration_minutes=70, charge_cents=-1"],
    ]) {
      await t.test(`lifecycle rejects ${name}`, () => rollbackCase(async (client) => {
        const id = await session(client);
        await assert.rejects(client.query(`update parking_sessions set ${update} where id=$1`, [id]), pgError('23514'));
      }));
    }

    await t.test('plates must be normalized', () => rollbackCase(async (client) => {
      await assert.rejects(session(client, 'ab-123-c'), pgError('23514'));
    }));
    await t.test('resident checkout cannot carry a positive charge', () => rollbackCase(async (client) => {
      const id = await session(client, 'RESIDENT1', 1, building, true);
      await assert.rejects(client.query(`update parking_sessions set state='AWAITING_PAYMENT',
        checkout_at='2026-11-12T09:10:00Z', duration_minutes=70, charge_cents=1000 where id=$1`, [id]), pgError('23514'));
    }));

    await t.test('gate outcomes cannot persist transient failures', () => rollbackCase(async (client) => {
      await assert.rejects(client.query(`insert into gate_request_outcomes
        (building_id, operation, request_id, canonical_payload, response_status, response_body)
        values ($1, 'CHECK_IN', $2, '{}', 503, '{}')`, [building, randomUUID()]), pgError('23514'));
    }));
    await t.test('gate responses cannot reference sessions in another building', () => rollbackCase(async (client) => {
      const id = await session(client);
      await client.query("insert into buildings values ('OTHER', 'UTC')");
      await assert.rejects(client.query(`insert into gate_request_outcomes
        (building_id, operation, request_id, canonical_payload, session_id, response_status, response_body)
        values ('OTHER', 'CHECK_IN', $1, '{}', $2, 201, '{}')`, [randomUUID(), id]), pgError('23503'));
    }));

    await t.test('committed gate outcomes and payment bindings cannot be rewritten or deleted', async () => {
      await rollbackCase(async (client) => {
        const key = randomUUID();
        await client.query(`insert into gate_request_outcomes values
          ($1, 'CHECK_IN', $2, '{"isResident":false}', null, 409, '{"error":{"code":"PARKING_FULL"}}')`, [building, key]);
        await assert.rejects(client.query('update gate_request_outcomes set canonical_payload=$1 where request_id=$2', ['{}', key]), pgError('23514'));
      });
      await rollbackCase(async (client) => {
        const id = await session(client);
        await client.query(`update parking_sessions set state='AWAITING_PAYMENT', checkout_at='2026-11-12T09:10:00Z', duration_minutes=70, charge_cents=1000 where id=$1`, [id]);
        await client.query("insert into payment_events values ('pilot', 'fail-1', $1, $2, 1, 'USD', 'FAILED', 'FAILED')", [building, id]);
        await client.query('set constraints all immediate');
        await assert.rejects(client.query("delete from payment_events where payment_id='fail-1'"), pgError('23514'));
      });
    });

    await t.test('frozen checkout fields cannot change and completed sessions cannot reactivate', () => rollbackCase(async (client) => {
      const id = await session(client);
      await client.query(`update parking_sessions set state='COMPLETED', checkout_at=check_in_at, duration_minutes=0, charge_cents=0, completed_at=check_in_at where id=$1`, [id]);
      await client.query('set constraints all immediate');
      await session(client); // completed allocation and plate are reusable
      await assert.rejects(client.query("update parking_sessions set state='PARKED', checkout_at=null, duration_minutes=null, charge_cents=null, completed_at=null where id=$1", [id]), pgError('23514'));
    }));

    await t.test('payment FK enforces building identity', () => rollbackCase(async (client) => {
      const id = await session(client);
      await client.query("insert into buildings values ('OTHER', 'UTC')");
      await assert.rejects(client.query("insert into payment_events values ('pilot', 'cross', 'OTHER', $1, 1000, 'EUR', 'PAID', 'SETTLED')", [id]), pgError('23503'));
    }));

    await t.test('gate request identity cannot be rebound to another payload', () => rollbackCase(async (client) => {
      const key = randomUUID();
      await client.query(`insert into gate_request_outcomes values
        ($1, 'CHECK_IN', $2, '{}', null, 409, '{"error":{"code":"PARKING_FULL"}}')`, [building, key]);
      await assert.rejects(client.query(`insert into gate_request_outcomes values
        ($1, 'CHECK_IN', $2, '{"isResident":true}', null, 409, '{"error":{"code":"PARKING_FULL"}}')`, [building, key]), pgError('23505'));
    }));

    await t.test('accepted payment identity cannot be reused', () => rollbackCase(async (client) => {
      const id = await session(client);
      await client.query(`update parking_sessions set state='AWAITING_PAYMENT', checkout_at='2026-11-12T09:10:00Z', duration_minutes=70, charge_cents=1000 where id=$1`, [id]);
      await client.query("insert into payment_events values ('pilot', 'unique-1', $1, $2, 1, 'USD', 'FAILED', 'FAILED')", [building, id]);
      await assert.rejects(client.query("insert into payment_events values ('pilot', 'unique-1', $1, $2, 1000, 'EUR', 'FAILED', 'FAILED')", [building, id]), pgError('23505'));
    }));

    await t.test('payment cents must fit the safe nonnegative integer contract', () => rollbackCase(async (client) => {
      const id = await session(client);
      await assert.rejects(client.query("insert into payment_events values ('pilot', 'huge', $1, $2, 9007199254740992, 'EUR', 'FAILED', 'FAILED')", [building, id]), pgError('23514'));
    }));

    await t.test('payment cannot be accepted before checkout', () => rollbackCase(async (client) => {
      const id = await session(client);
      await client.query("insert into payment_events values ('pilot', 'early', $1, $2, 1, 'USD', 'FAILED', 'FAILED')", [building, id]);
      await assert.rejects(client.query('set constraints all immediate'), pgError('23514'));
    }));

    await t.test('frozen charge cannot be rewritten', () => rollbackCase(async (client) => {
      const id = await session(client);
      await client.query(`update parking_sessions set state='AWAITING_PAYMENT', checkout_at='2026-11-12T09:10:00Z', duration_minutes=70, charge_cents=1000 where id=$1`, [id]);
      await assert.rejects(client.query('update parking_sessions set charge_cents=500 where id=$1', [id]), pgError('23514'));
    }));

    await t.test('unique index coordinates separate PostgreSQL connections', async () => {
      const first = await database.pool.connect();
      const second = await database.pool.connect();
      let id: string | undefined;
      try {
        assert.notEqual((await first.query('select pg_backend_pid() as id')).rows[0].id,
          (await second.query('select pg_backend_pid() as id')).rows[0].id);
        await first.query('begin');
        id = await session(first, 'RACE1', 51);
        await second.query('begin');
        await second.query("set local lock_timeout = '100ms'");
        // The uncommitted unique entry must block another connection, not permit
        // a second allocation. A bounded timeout provides deterministic evidence.
        await assert.rejects(session(second, 'RACE1', 52), pgError('55P03'));
        await second.query('rollback');
        await first.query('commit');
        await assert.rejects(session(second, 'RACE1', 52), pgError('23505'));
        await assert.rejects(session(second, 'RACE2', 51), pgError('23505'));
      } finally {
        await first.query('rollback');
        await second.query('rollback');
        if (id) await first.query('delete from parking_sessions where id=$1', [id]);
        first.release(); second.release();
      }
    });

    await t.test('paid completion requires matching settlement in the same transaction', () => rollbackCase(async (client) => {
      const id = await session(client);
      await client.query(`update parking_sessions set state='COMPLETED', checkout_at='2026-11-12T09:10:00Z', duration_minutes=70, charge_cents=1000, completed_at='2026-11-12T09:11:00Z' where id=$1`, [id]);
      await assert.rejects(client.query('set constraints all immediate'), pgError('23514'));
    }));

    await t.test('matching settlement, mismatched FAILED and reconciliation coexist without extra settlement', () => rollbackCase(async (client) => {
      const id = await session(client);
      await client.query(`update parking_sessions set state='COMPLETED', checkout_at='2026-11-12T09:10:00Z', duration_minutes=70, charge_cents=1000, completed_at='2026-11-12T09:11:00Z' where id=$1`, [id]);
      await client.query("insert into payment_events values ('pilot', 'paid-1', $1, $2, 1000, 'EUR', 'PAID', 'SETTLED')", [building, id]);
      await client.query("insert into payment_events values ('pilot', 'failed-1', $1, $2, 1, 'USD', 'FAILED', 'FAILED')", [building, id]);
      await client.query("insert into payment_events values ('pilot', 'extra-1', $1, $2, 17, 'USD', 'PAID', 'RECONCILIATION_REQUIRED')", [building, id]);
      await client.query('set constraints all immediate');
      await assert.rejects(client.query("insert into payment_events values ('pilot', 'paid-2', $1, $2, 1000, 'EUR', 'PAID', 'SETTLED')", [building, id]), pgError('23505'));
    }));
    await settlementConcurrencyTests(t, database);
  } finally { await database.onModuleDestroy(); }
});
