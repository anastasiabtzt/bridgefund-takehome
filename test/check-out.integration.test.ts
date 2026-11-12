import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { DynamicModule } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { Clock } from '../src/clock.js';
import { loadConfig } from '../src/config.js';
import { configureHttp } from '../src/http.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { seedPilot } from '../src/database/seed.js';
import { gateRequestKey, GATE_REQUEST_NAMESPACE } from '../src/parking/gate-request-key.js';
import { openTestDatabase, testDatabaseUrl } from './support/test-database.js';

const building = 'PB-AMS-9X4T';
const exit = 'exit-integration-secret-01234567890123456789';
const entrance = 'entrance-integration-secret-01234567890123456789';
type Result = { status: number; body: { parkingSpaceId?: number; parkingSessionId?: string; sessionLengthInMinutes?: number;
  amountDue?: { value: number; currency: string }; error?: { code: string } } };

class TestClock extends Clock {
  samples = 0;
  instant = '2026-11-12T09:10:00Z';
  now(): Date { this.samples++; return new Date(this.instant); }
}

test('PB-04 transactional checkout, Clock, frozen replay and allocation compatibility', async (t) => {
  const database = await openTestDatabase();
  const apps: NestExpressApplication[] = [];
  const urls: string[] = [];
  const clock = new TestClock();
  const config = loadConfig({ ...process.env, DATABASE_URL: testDatabaseUrl(),
    GATE_CREDENTIALS: JSON.stringify([
      { id: 'exit-1', buildingId: building, role: 'EXIT', secret: exit },
      { id: 'entrance-1', buildingId: building, role: 'ENTRANCE', secret: entrance },
    ]), DB_LOCK_TIMEOUT_MS: '2000', DB_STATEMENT_TIMEOUT_MS: '4000', DB_IDLE_TRANSACTION_TIMEOUT_MS: '5000' });
  async function start(lockTimeoutMs = 2000, statementTimeoutMs = 4000): Promise<number> {
    const root = AppModule.register({ ...config, lockTimeoutMs, statementTimeoutMs });
    const parking = root.imports![0] as DynamicModule;
    const runtime = parking.imports![0] as DynamicModule;
    runtime.providers = runtime.providers!.filter((p) => !(typeof p === 'object' && 'provide' in p && p.provide === Clock));
    runtime.providers.push({ provide: Clock, useValue: clock });
    const app = await NestFactory.create<NestExpressApplication>(root, { logger: false });
    apps.push(app); configureHttp(app); await app.listen(0, '127.0.0.1'); urls.push(await app.getUrl());
    return urls.length - 1;
  }
  async function checkout(id: string, resident = false, key: string = randomUUID(), instance = 0): Promise<Result> {
    const response = await fetch(`${urls[instance]}/check-out`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${exit}`, 'x-request-id': key,
    }, body: JSON.stringify({ parkingSessionId: id, isResident: resident }) });
    return { status: response.status, body: await response.json() as Result['body'] };
  }
  async function checkin(plate: string, resident: boolean): Promise<Result> {
    const response = await fetch(`${urls[0]}/check-in`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${entrance}`, 'x-request-id': randomUUID(),
    }, body: JSON.stringify({ vehicleType: 'CAR', licensePlate: plate, isResident: resident }) });
    return { status: response.status, body: await response.json() as Result['body'] };
  }
  async function clear() {
    await database.pool.query('truncate payment_events, gate_request_outcomes, parking_sessions');
    clock.samples = 0; clock.instant = '2026-11-12T09:10:00Z';
  }
  async function session(resident = false, plate = 'CAR1', space = resident ? 1 : 51, buildingId = building, vehicle = 'CAR'): Promise<string> {
    const id = randomUUID();
    await database.pool.query(`insert into parking_sessions
      (id,building_id,space_id,normalized_plate,vehicle_type,is_resident,check_in_at)
      values ($1,$2,$3,$4,$5,$6,'2026-11-12T08:00:00Z')`, [id, buildingId, space, plate, vehicle, resident]);
    return id;
  }
  async function row(id: string) { return (await database.pool.query('select * from parking_sessions where id=$1', [id])).rows[0]; }
  async function outcomes() { return (await database.pool.query("select count(*)::int n from gate_request_outcomes where operation='CHECK_OUT'")).rows[0].n; }
  async function occupancy(space: number): Promise<boolean> {
    const response = await fetch(`${urls[0]}/occupancy`); assert.equal(response.status, 200);
    const spaces = await response.json(); return spaces[space - 1].isOccupied;
  }
  async function overlap(first: () => Promise<Result>, second: () => Promise<Result>, afterWaiting?: () => Promise<void>) {
    const holder = await database.pool.connect();
    let pending: Promise<Result>[] = [];
    try {
      await holder.query('begin'); await holder.query('select id from buildings where id=$1 for update', [building]);
      pending = [first(), second()];
      const deadline = Date.now() + 1500;
      let waiting = 0;
      while (Date.now() < deadline) {
        waiting = (await database.pool.query<{ n: number }>(`select count(*)::int n from pg_stat_activity
          where application_name='parkingbusiness' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0`)).rows[0].n;
        if (waiting >= 2) break;
      }
      assert.ok(waiting >= 2, 'two app connections overlap under PostgreSQL locks');
      assert.equal(clock.samples, 0, 'Clock must not be sampled before building/session coordination');
      if (afterWaiting) await afterWaiting();
      await holder.query('commit'); return await Promise.all(pending);
    } finally { await holder.query('rollback'); holder.release(); await Promise.allSettled(pending); }
  }
  try {
    await database.pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public');
    await migrateDatabase(database); await seedPilot(database); await start(); await start();

    await t.test('positive charge freezes exact time, whole minutes and amount; repeats bind independently without Clock', async () => {
      await clear(); const id = await session(); const key = randomUUID();
      clock.instant = '2026-11-12T09:10:59.999Z';
      const original = await checkout(id, false, key);
      assert.deepEqual(original, { status: 200, body: { parkingSpaceId: 51, sessionLengthInMinutes: 70, amountDue: { value: 1000, currency: 'EUR' } } });
      const frozen = await row(id); assert.equal(frozen.state, 'AWAITING_PAYMENT');
      assert.equal(frozen.checkout_at.toISOString(), new Date(clock.instant).toISOString());
      assert.equal(clock.samples, 1);
      assert.equal(frozen.completed_at, null);
      const sampled = clock.samples;
      clock.instant = '2026-11-15T12:00:00Z';
      assert.deepEqual(await checkout(id.toUpperCase(), false, key.toUpperCase(), 1), original);
      assert.deepEqual(await checkout(id, false), original);
      assert.equal(clock.samples, sampled); assert.equal(await outcomes(), 2);
      assert.deepEqual(await row(id), frozen);
      assert.equal(await occupancy(51), true);
      assert.equal((await checkin('CAR1', false)).body.error?.code, 'VEHICLE_ALREADY_CHECKED_IN');
      assert.equal((await checkin('CAR2', false)).body.parkingSpaceId, 52);
    });
    await t.test('unknown/inaccessible sessions have no binding; existing bindings precede changed-session lookup', async () => {
      await clear(); const id = await session(); const key = randomUUID();
      assert.equal((await checkout(randomUUID())).status, 404); assert.equal(await outcomes(), 0);
      await database.pool.query("insert into buildings values ('OTHER','UTC'); insert into spaces values ('OTHER',1,1,'RESIDENT')");
      const other = await session(true, 'OTHER1', 1, 'OTHER');
      assert.equal((await checkout(other, true)).status, 404); assert.equal(await outcomes(), 0);
      const success = await checkout(id, false, key);
      assert.equal((await checkout(randomUUID(), false, key)).body.error?.code, 'IDEMPOTENCY_KEY_REUSED');
      assert.deepEqual(await checkout(id, false, key), success);
      assert.equal(await outcomes(), 1);
    });
    await t.test('resident mismatch is terminal, including frozen sessions, with no Clock or session mutation', async () => {
      await clear(); const id = await session(true); const key = randomUUID();
      const before = await row(id);
      const mismatch = await checkout(id, false, key);
      assert.equal(mismatch.body.error?.code, 'RESIDENT_STATUS_MISMATCH'); assert.equal(clock.samples, 0);
      assert.deepEqual(await row(id), before);
      assert.equal((await checkout(id, true, key)).body.error?.code, 'IDEMPOTENCY_KEY_REUSED');
      assert.equal((await checkout(id, true)).status, 200);
      const frozen = await row(id); const samples = clock.samples;
      assert.deepEqual(await checkout(id, false, key), mismatch);
      assert.equal((await checkout(id, false)).body.error?.code, 'RESIDENT_STATUS_MISMATCH');
      assert.deepEqual(await row(id), frozen); assert.equal(clock.samples, samples);
      assert.equal(await outcomes(), 3);
    });
    await t.test('Clock inconsistency rolls back without binding and same key can recover', async () => {
      await clear(); const id = await session(); const key = randomUUID(); const before = await row(id);
      clock.instant = '2026-11-12T07:59:59.999Z';
      const result = await checkout(id, false, key); assert.equal(result.status, 500); assert.equal(result.body.error?.code, 'CLOCK_INCONSISTENCY');
      assert.deepEqual(await row(id), before); assert.equal(await outcomes(), 0);
      clock.instant = '2026-11-12T09:00:00Z'; assert.equal((await checkout(id, false, key)).status, 200);
    });
    for (const sameKey of [true, false]) {
      await t.test(`concurrent ${sameKey ? 'same' : 'different'} keys freeze one Clock sample and durable outcomes`, async () => {
        await clear(); const id = await session(); const first = randomUUID(); const second = sameKey ? first : randomUUID();
        const [a, b] = await overlap(() => checkout(id, false, first), () => checkout(id, false, second, 1), async () => {
          clock.instant = '2026-11-12T09:00:00.001Z';
        });
        assert.equal(a.status, 200); assert.deepEqual(b, a); assert.equal(a.body.amountDue?.value, 1000);
        assert.equal(clock.samples, 1); assert.equal(await outcomes(), sameKey ? 1 : 2);
        assert.equal((await row(id)).checkout_at.toISOString(), '2026-11-12T09:00:00.001Z');
      });
    }
    await t.test('Clock is sampled after the session row lock, not just after the building lock', async () => {
      await clear(); const id = await session(); const holder = await database.pool.connect();
      let pending: Promise<Result> | undefined;
      try {
        await holder.query('begin'); await holder.query('select id from parking_sessions where id=$1 for update', [id]);
        const pid = (await holder.query('select pg_backend_pid() as pid')).rows[0].pid;
        pending = checkout(id);
        const deadline = Date.now() + 1500;
        let blocked = false;
        while (Date.now() < deadline) {
          const result = await database.pool.query<{ n: number }>(`select count(*)::int n from pg_stat_activity
            where application_name='parkingbusiness' and $1::int=any(pg_blocking_pids(pid))`, [pid]);
          if (result.rows[0].n > 0) { blocked = true; break; }
        }
        assert.equal(blocked, true); assert.equal(clock.samples, 0);
        clock.instant = '2026-11-12T09:00:00.001Z';
        await holder.query('commit');
        const result = await pending;
        assert.equal(result.status, 200); assert.equal(result.body.amountDue?.value, 1000);
        assert.equal(clock.samples, 1);
        assert.equal((await row(id)).checkout_at.toISOString(), '2026-11-12T09:00:00.001Z');
      } finally { await holder.query('rollback'); holder.release(); if (pending) await Promise.allSettled([pending]); }
    });
    await t.test('free completion releases once; old-session new-key checkout cannot affect a new occupant', async () => {
      await clear(); const a = await session(true, 'RESIDENTA');
      const original = await checkout(a, true); assert.equal(original.status, 200); assert.equal(original.body.amountDue?.value, 0);
      const completed = await row(a); assert.equal(completed.state, 'COMPLETED');
      assert.equal(completed.completed_at.toISOString(), completed.checkout_at.toISOString());
      assert.equal(await occupancy(1), false);
      const next = await checkin('RESIDENTA', true); assert.equal(next.status, 201); assert.equal(next.body.parkingSpaceId, 1);
      const b = await row(next.body.parkingSessionId!);
      assert.equal(await occupancy(1), true);
      const samples = clock.samples;
      assert.deepEqual(await checkout(a, true), original);
      assert.deepEqual(await row(a), completed); assert.deepEqual(await row(b.id), b);
      assert.equal(clock.samples, samples); assert.equal(await outcomes(), 2); assert.equal(await occupancy(1), true);
    });
    await t.test('zero-duration visitor completes free without creating payment events', async () => {
      await clear(); const id = await session(); clock.instant = '2026-11-12T08:00:00Z';
      const result = await checkout(id); assert.equal(result.body.amountDue?.value, 0); assert.equal(result.body.sessionLengthInMinutes, 0);
      assert.equal((await row(id)).state, 'COMPLETED'); assert.equal(await occupancy(51), false);
      assert.equal((await database.pool.query('select count(*)::int n from payment_events')).rows[0].n, 0);
    });
    await t.test('outcome insertion failure rolls back positive and zero-charge state mutations', async () => {
      for (const resident of [false, true]) {
        await clear(); const id = await session(resident); const before = await row(id); const key = randomUUID();
        await database.pool.query(`create function fail_checkout_outcome() returns trigger language plpgsql as $$
          begin if NEW.operation='CHECK_OUT' then raise exception 'Test injected failure'; end if; return NEW; end; $$;
          create trigger test_checkout_failure before insert on gate_request_outcomes for each row execute function fail_checkout_outcome()`);
        try {
          assert.equal((await checkout(id, resident, key)).status, 500);
          assert.deepEqual(await row(id), before); assert.equal(await outcomes(), 0); assert.equal(await occupancy(before.space_id), true);
        } finally { await database.pool.query('drop trigger test_checkout_failure on gate_request_outcomes; drop function fail_checkout_outcome()'); }
        assert.equal((await checkout(id, resident, key)).status, 200);
      }
    });
    await t.test('bounded lock timeout is nonterminal and same-key retry recovers without an early Clock sample', async () => {
      await clear(); const id = await session(); const key = randomUUID(); const instance = await start(150, 1000);
      const holder = await database.pool.connect();
      try {
        await holder.query('begin'); await holder.query('select pg_advisory_xact_lock($1::int,$2::int)',
          [GATE_REQUEST_NAMESPACE, gateRequestKey(building, 'CHECK_OUT', key)]);
        const result = await checkout(id, false, key, instance);
        assert.equal(result.status, 503); assert.equal(result.body.error?.code, 'CHECK_OUT_TEMPORARILY_UNAVAILABLE');
        assert.equal(clock.samples, 0); assert.equal(await outcomes(), 0); assert.equal((await row(id)).state, 'PARKED');
      } finally { await holder.query('rollback'); holder.release(); }
      assert.equal((await checkout(id, false, key, instance)).status, 200);
    });
    await t.test('statement timeout after session mutation rolls back state and permits same-key recovery', async () => {
      await clear(); const id = await session(true); const before = await row(id); const key = randomUUID(); const instance = await start(50, 150);
      await database.pool.query(`create function timeout_checkout_outcome() returns trigger language plpgsql as $$
        begin
          if NEW.operation='CHECK_OUT' then
            if not exists(select 1 from parking_sessions where id=NEW.session_id and state='COMPLETED') then
              raise exception 'Expected completed mutation';
            end if;
            loop perform 1; end loop;
          end if;
          return NEW;
        end; $$;
        create trigger test_checkout_timeout before insert on gate_request_outcomes for each row execute function timeout_checkout_outcome()`);
      try {
        const result = await checkout(id, true, key, instance);
        assert.equal(result.status, 503); assert.equal(result.body.error?.code, 'CHECK_OUT_TEMPORARILY_UNAVAILABLE');
        assert.deepEqual(await row(id), before); assert.equal(await outcomes(), 0); assert.equal(await occupancy(1), true);
      } finally { await database.pool.query('drop trigger test_checkout_timeout on gate_request_outcomes; drop function timeout_checkout_outcome()'); }
      assert.equal((await checkout(id, true, key, instance)).status, 200); assert.equal(await occupancy(1), false);
    });
  } finally { for (const app of apps) await app.close(); await database.onModuleDestroy(); }
});
