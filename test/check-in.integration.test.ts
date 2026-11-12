import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config.js';
import { configureHttp } from '../src/http.js';
import { DatabaseService } from '../src/database/database.service.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { seedPilot } from '../src/database/seed.js';
import { gateRequestKey, GATE_REQUEST_NAMESPACE } from '../src/parking/gate-request-key.js';
import { openTestDatabase, testDatabaseUrl } from './support/test-database.js';

const building = 'PB-AMS-9X4T';
const secret = 'integration-gate-secret-01234567890123456789';
const payload = (plate: string, resident = false, vehicleType = 'CAR') => ({ licensePlate: plate, isResident: resident, vehicleType });
type ResponseBody = { parkingSpaceId?: number; parkingSessionId?: string; error?: { code: string } };

test('PB-03 committed HTTP allocations, durable replay, rollback and controlled concurrency', async (t) => {
  const database = await openTestDatabase();
  const apps: NestExpressApplication[] = [];
  const urls: string[] = [];
  const config = loadConfig({ ...process.env, DATABASE_URL: testDatabaseUrl(),
    GATE_CREDENTIALS: JSON.stringify([{ id: 'entrance-1', buildingId: building, role: 'ENTRANCE', secret }]),
    // Test-local headroom for observing controlled lock waits, not production defaults.
    DB_LOCK_TIMEOUT_MS: '2000', DB_STATEMENT_TIMEOUT_MS: '4000', DB_IDLE_TRANSACTION_TIMEOUT_MS: '5000' });
  try {
    await database.pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public');
    await migrateDatabase(database); await seedPilot(database);
    for (let i = 0; i < 2; i++) {
      const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), { logger: false });
      apps.push(app); configureHttp(app); await app.listen(0, '127.0.0.1'); urls.push(`${await app.getUrl()}/check-in`);
    }
    async function send(body: unknown, key: string = randomUUID(), instance = 0) {
      const response = await fetch(urls[instance], { method: 'POST', headers: {
        'content-type': 'application/json', authorization: `Bearer ${secret}`, 'x-request-id': key,
      }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as ResponseBody };
    }
    async function clear() { await database.pool.query('truncate payment_events, gate_request_outcomes, parking_sessions'); }
    async function complete(id: string) {
      await database.pool.query(`update parking_sessions set state='COMPLETED', checkout_at=check_in_at,
        duration_minutes=0, charge_cents=0, completed_at=check_in_at where id=$1`, [id]);
    }
    async function fill(low: number, high: number) {
      await database.pool.query(`insert into parking_sessions
        (building_id, space_id, normalized_plate, vehicle_type, is_resident, check_in_at)
        select $1, n, 'FILL' || n, case when n>=131 then 'MOTOR'::vehicle_type else 'CAR'::vehicle_type end,
          n<=50, now() from generate_series($2::int,$3::int) n`, [building, low, high]);
    }
    async function overlap(first: () => ReturnType<typeof send>, second: () => ReturnType<typeof send>) {
      const holder = await database.pool.connect();
      let pending: ReturnType<typeof send>[] = [];
      try {
        await holder.query('begin');
        await holder.query("select id from buildings where id=$1 for update", [building]);
        pending = [first(), second()];
        // Establish both requests are actually waiting in PostgreSQL before release.
        const deadline = Date.now() + 1500;
        let waiting = 0;
        while (Date.now() < deadline) {
          const result = await database.pool.query<{ n: number }>(`select count(*)::int n from pg_stat_activity
            where application_name='parkingbusiness' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0`);
          waiting = result.rows[0].n;
          if (waiting >= 2) break;
        }
        assert.ok(waiting >= 2, 'two distinct application connections must overlap under database locks');
        await holder.query('commit');
        return await Promise.all(pending);
      } finally {
        await holder.query('rollback'); holder.release();
        await Promise.allSettled(pending);
      }
    }

    await t.test('eligibility, lowest IDs and gaps; check-in appears in public occupancy', async () => {
      await clear();
      for (const [plate, resident, type, space] of [
        ['R1', true, 'CAR', 1], ['R2', true, 'MOTOR', 2], ['C1', false, 'CAR', 51], ['M1', false, 'MOTOR', 131],
      ] as const) {
        const result = await send(payload(plate, resident, type));
        assert.equal(result.status, 201); assert.equal(result.body.parkingSpaceId, space);
      }
      const occupied = await fetch(urls[0].replace('check-in', 'occupancy')).then((r) => r.json());
      assert.equal(occupied[50].isOccupied, true);
      await database.pool.query("update parking_sessions set state='COMPLETED', checkout_at=check_in_at, duration_minutes=0, charge_cents=0, completed_at=check_in_at where space_id=1");
      assert.equal((await send(payload('R3', true))).body.parkingSpaceId, 1);
    });
    await t.test('committed canonical and historical replay, payload conflicts and terminal plate rejection', async () => {
      await clear();
      const key = randomUUID();
      const original = await send(payload('ab-123 c'), key);
      assert.equal(original.status, 201);
      assert.deepEqual(await send({ isResident: false, licensePlate: 'AB123C', vehicleType: 'CAR' }, key.toUpperCase(), 1), original);
      assert.equal((await send(payload('OTHER'), key)).body.error?.code, 'IDEMPOTENCY_KEY_REUSED');
      const rejectedKey = randomUUID();
      const duplicate = await send(payload('AB123C', true), rejectedKey);
      assert.equal(duplicate.body.error?.code, 'VEHICLE_ALREADY_CHECKED_IN');
      await complete(original.body.parkingSessionId!);
      assert.deepEqual(await send(payload('AB123C'), key), original);
      assert.deepEqual(await send(payload('AB123C', true), rejectedKey), duplicate);
      assert.equal((await send(payload('AB123C', true))).status, 201);
      assert.equal((await database.pool.query('select count(*)::int n from parking_sessions')).rows[0].n, 2);
    });
    await t.test('full ranges do not overflow; terminal full replay survives release and payload conflicts', async () => {
      await clear();
      for (const [low, high, resident, type] of [[1, 50, true, 'CAR'], [51, 130, false, 'CAR'], [131, 150, false, 'MOTOR']] as const) {
        await clear(); await fill(low, high);
        const key = randomUUID(); const body = payload('FULLNEW', resident, type);
        const full = await send(body, key); assert.equal(full.body.error?.code, 'PARKING_FULL');
        assert.equal((await send({ ...body, licensePlate: 'DIFFERENT' }, key)).body.error?.code, 'IDEMPOTENCY_KEY_REUSED');
        const session = await database.pool.query('select id from parking_sessions where space_id=$1', [low]);
        await complete(session.rows[0].id);
        assert.deepEqual(await send(body, key), full);
        assert.equal((await send(body)).body.parkingSpaceId, low);
      }
    });
    await t.test('concurrent same-key requests across application instances replay one committed allocation', async () => {
      await clear(); const key = randomUUID();
      const [a, b] = await overlap(() => send(payload('SAME'), key), () => send(payload('same'), key, 1));
      assert.equal(a.status, 201); assert.deepEqual(b, a);
      assert.equal((await database.pool.query('select count(*)::int n from parking_sessions')).rows[0].n, 1);
      assert.equal((await database.pool.query('select count(*)::int n from gate_request_outcomes')).rows[0].n, 1);
    });
    await t.test('concurrent conflicting payloads bind only one outcome', async () => {
      await clear(); const key = randomUUID();
      const results = await overlap(() => send(payload('ONE'), key), () => send(payload('TWO'), key, 1));
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal(results.find((r) => r.status === 409)?.body.error?.code, 'IDEMPOTENCY_KEY_REUSED');
    });
    await t.test('distinct vehicles serialize lowest allocation and last-space fullness', async () => {
      await clear();
      const results = await overlap(() => send(payload('FIRST')), () => send(payload('SECOND'), randomUUID(), 1));
      assert.deepEqual(results.map((r) => r.body.parkingSpaceId).sort(), [51, 52]);
      await clear(); await fill(51, 129);
      const last = await overlap(() => send(payload('LAST1')), () => send(payload('LAST2'), randomUUID(), 1));
      assert.deepEqual(last.map((r) => r.status).sort(), [201, 409]);
      assert.equal(last.find((r) => r.status === 201)?.body.parkingSpaceId, 130);
      assert.equal(last.find((r) => r.status === 409)?.body.error?.code, 'PARKING_FULL');
    });
    await t.test('duplicate-plate races across resident flags allocate only once', async () => {
      await clear();
      const results = await overlap(() => send(payload('a-b 1')), () => send(payload('AB1', true), randomUUID(), 1));
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal(results.find((r) => r.status === 409)?.body.error?.code, 'VEHICLE_ALREADY_CHECKED_IN');
      assert.equal((await database.pool.query('select count(*)::int n from parking_sessions')).rows[0].n, 1);
    });
    await t.test('rollback of outcome insertion removes allocation and permits same-key execution', async () => {
      for (const scenario of ['success', 'full', 'duplicate']) {
        await clear(); const key = randomUUID();
        if (scenario === 'full') await fill(1, 50);
        if (scenario === 'duplicate') await send(payload('ROLLBACK', true));
        const before = (await database.pool.query('select count(*)::int n from parking_sessions')).rows[0].n;
        const outcomes = (await database.pool.query('select count(*)::int n from gate_request_outcomes')).rows[0].n;
        await database.pool.query(`create function fail_test_outcome() returns trigger language plpgsql as $$
          begin raise exception 'Test injected failure'; end; $$;
          create trigger test_outcome_failure before insert on gate_request_outcomes for each row execute function fail_test_outcome()`);
        try {
          assert.equal((await send(payload('ROLLBACK', true), key)).status, 500);
          assert.equal((await database.pool.query('select count(*)::int n from parking_sessions')).rows[0].n, before);
          assert.equal((await database.pool.query('select count(*)::int n from gate_request_outcomes')).rows[0].n, outcomes);
        } finally { await database.pool.query('drop trigger test_outcome_failure on gate_request_outcomes; drop function fail_test_outcome()'); }
        const result = await send(payload('ROLLBACK', true), key);
        assert.equal(result.status, scenario === 'success' ? 201 : 409);
      }
    });
    await t.test('concurrent terminal full and duplicate-plate outcomes replay identically', async () => {
      for (const full of [true, false]) {
        await clear();
        if (full) await fill(1, 50);
        else await send(payload('EXISTING', true));
        const key = randomUUID(); const body = payload(full ? 'FULLRACE' : 'EXISTING', true);
        const [a, b] = await overlap(() => send(body, key), () => send(body, key, 1));
        assert.equal(a.body.error?.code, full ? 'PARKING_FULL' : 'VEHICLE_ALREADY_CHECKED_IN');
        assert.deepEqual(b, a);
      }
    });
    await t.test('plate-only conflict handling survives a writer bypassing building coordination', async () => {
      await clear();
      const holder = await database.pool.connect();
      const key = randomUUID();
      let pending: ReturnType<typeof send> | undefined;
      await database.pool.query(`create function pause_test_insert() returns trigger language plpgsql as $$
        begin if NEW.normalized_plate = 'CANDIDATE' and NEW.space_id = 51 then perform pg_advisory_xact_lock(987, 1); end if; return NEW; end; $$;
        create trigger test_insert_pause before insert on parking_sessions for each row execute function pause_test_insert()`);
      try {
        await holder.query('begin'); await holder.query('select pg_advisory_xact_lock(987,1)');
        pending = send(payload('CANDIDATE'), key);
        const deadline = Date.now() + 1500;
        let blocked = false;
        while (Date.now() < deadline) {
          const result = await database.pool.query<{ n: number }>(`select count(*)::int n from pg_stat_activity
            where application_name='parkingbusiness' and wait_event_type='Lock' and query like 'insert into "parking_sessions"%'`);
          if (result.rows[0].n > 0) { blocked = true; break; }
        }
        assert.equal(blocked, true);
        await database.pool.query(`insert into parking_sessions
          (building_id,space_id,normalized_plate,vehicle_type,is_resident,check_in_at)
          values ('PB-AMS-9X4T',52,'CANDIDATE','CAR',false,now())`);
        await holder.query('commit');
        const result = await pending;
        assert.equal(result.body.error?.code, 'VEHICLE_ALREADY_CHECKED_IN');
        assert.deepEqual(await send(payload('CANDIDATE'), key), result);
        assert.equal((await database.pool.query('select count(*)::int n from parking_sessions')).rows[0].n, 1);
      } finally {
        await holder.query('rollback'); holder.release();
        if (pending) await Promise.allSettled([pending]);
        await database.pool.query('drop trigger test_insert_pause on parking_sessions; drop function pause_test_insert()');
      }
    });
    await t.test('request-lock timeout is 503 without a binding; retry succeeds after release', async () => {
      await clear();
      const key = randomUUID(); const holder = await database.pool.connect();
      // Use a third app with the actual default 250 ms lock timeout.
      const app = await NestFactory.create<NestExpressApplication>(AppModule.register({ ...config, lockTimeoutMs: 250 }), { logger: false });
      apps.push(app); configureHttp(app); await app.listen(0, '127.0.0.1'); urls.push(`${await app.getUrl()}/check-in`);
      try {
        await holder.query('begin');
        await holder.query('select pg_advisory_xact_lock($1::int,$2::int)', [GATE_REQUEST_NAMESPACE, gateRequestKey(building, 'CHECK_IN', key)]);
        const result = await send(payload('TIMEOUT'), key, 2);
        assert.equal(result.status, 503); assert.equal(result.body.error?.code, 'CHECK_IN_TEMPORARILY_UNAVAILABLE');
        assert.equal((await database.pool.query('select count(*)::int n from gate_request_outcomes')).rows[0].n, 0);
      } finally { await holder.query('rollback'); holder.release(); }
      assert.equal((await send(payload('TIMEOUT'), key, 2)).status, 201);
    });
    await t.test('exhausted pool returns sanitized 503 without binding and recovers after release', async () => {
      await clear();
      const instance = urls.length;
      const app = await NestFactory.create<NestExpressApplication>(AppModule.register({ ...config, poolMax: 1, connectionTimeoutMs: 250 }), { logger: false });
      apps.push(app); configureHttp(app); await app.listen(0, '127.0.0.1'); urls.push(`${await app.getUrl()}/check-in`);
      const pool = app.get(DatabaseService).pool;
      const held = await pool.connect();
      const key = randomUUID();
      try {
        assert.equal(pool.totalCount, 1);
        assert.equal(pool.idleCount, 0, 'the sole application connection is checked out');
        const result = await send(payload('POOLTIMEOUT'), key, instance);
        assert.deepEqual(result, { status: 503, body: { error: {
          code: 'CHECK_IN_TEMPORARILY_UNAVAILABLE',
          message: 'Check-in is temporarily unavailable. Retry with the same request ID.',
        } } });
        assert.equal(pool.waitingCount, 0, 'timed-out acquisition leaves no queued waiter');
        assert.equal((await database.pool.query('select count(*)::int n from gate_request_outcomes')).rows[0].n, 0);
        assert.equal((await database.pool.query('select count(*)::int n from parking_sessions')).rows[0].n, 0);
      } finally { held.release(); }
      const recovered = await send(payload('POOLTIMEOUT'), key, instance);
      assert.equal(recovered.status, 201);
      assert.deepEqual(await send(payload('POOLTIMEOUT'), key, instance), recovered);
      assert.equal((await pool.query('select 1 as usable')).rows[0].usable, 1);
      assert.equal(pool.totalCount, 1);
    });
    await t.test('statement timeout after session insertion rolls back session and outcome, then recovers', async () => {
      await clear();
      const instance = urls.length;
      const app = await NestFactory.create<NestExpressApplication>(AppModule.register({
        ...config, statementTimeoutMs: 150, lockTimeoutMs: 50,
      }), { logger: false });
      apps.push(app); configureHttp(app); await app.listen(0, '127.0.0.1'); urls.push(`${await app.getUrl()}/check-in`);
      const key = randomUUID();
      // BEFORE outcome persistence, verify the session is already visible within
      // this transaction, then execute SQL until PostgreSQL cancels the statement.
      // Test-local trigger only: no sleeps or production hooks/migration changes.
      await database.pool.query(`create function timeout_test_outcome() returns trigger language plpgsql as $$
        begin
          if NEW.session_id is null or not exists (select 1 from parking_sessions where id=NEW.session_id) then
            raise exception 'Test requires an inserted session';
          end if;
          loop perform 1; end loop;
        end; $$;
        create trigger test_outcome_timeout before insert on gate_request_outcomes for each row execute function timeout_test_outcome()`);
      try {
        const result = await send(payload('STATEMENTTIMEOUT'), key, instance);
        assert.deepEqual(result, { status: 503, body: { error: {
          code: 'CHECK_IN_TEMPORARILY_UNAVAILABLE',
          message: 'Check-in is temporarily unavailable. Retry with the same request ID.',
        } } });
        assert.equal((await database.pool.query('select count(*)::int n from parking_sessions')).rows[0].n, 0);
        assert.equal((await database.pool.query('select count(*)::int n from gate_request_outcomes')).rows[0].n, 0);
      } finally {
        await database.pool.query('drop trigger test_outcome_timeout on gate_request_outcomes; drop function timeout_test_outcome()');
      }
      const recovered = await send(payload('STATEMENTTIMEOUT'), key, instance);
      assert.equal(recovered.status, 201);
      assert.deepEqual(await send(payload('STATEMENTTIMEOUT'), key, instance), recovered);
      assert.equal((await database.pool.query('select count(*)::int n from parking_sessions')).rows[0].n, 1);
      assert.equal((await database.pool.query('select count(*)::int n from gate_request_outcomes')).rows[0].n, 1);
    });
  } finally {
    for (const app of apps) await app.close();
    await database.onModuleDestroy();
  }
});
