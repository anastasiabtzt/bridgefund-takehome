import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { DynamicModule } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { Clock } from '../src/clock.js';
import { DatabaseService } from '../src/database/database.service.js';
import { loadConfig } from '../src/config.js';
import { configureHttp } from '../src/http.js';
import { migrateDatabase } from '../src/database/migrate.js';
import { seedPilot } from '../src/database/seed.js';
import { paymentEventKey, PAYMENT_EVENT_NAMESPACE, PILOT_PROVIDER_ID } from '../src/payments/payment-event-key.js';
import { GATE_REQUEST_NAMESPACE } from '../src/parking/gate-request-key.js';
import { openTestDatabase, testDatabaseUrl } from './support/test-database.js';

const building = 'PB-AMS-9X4T';
const secret = 'integration-provider-secret-01234567890123456789';
const entrance = 'integration-entrance-secret-01234567890123456789';
const exit = 'integration-exit-secret-01234567890123456789';
type Event = { paymentId: string; parkingSessionId: string; amount: { value: number; currency: string }; status: 'PAID' | 'FAILED' };
type Result = { status: number; text: string; code?: string };
const event = (id: string, status: 'PAID' | 'FAILED' = 'PAID', value = 1000, currency = 'EUR', paymentId: string = randomUUID()): Event =>
  ({ paymentId, parkingSessionId: id, amount: { value, currency }, status });
class TestClock extends Clock {
  samples = 0;
  instant = '2026-11-13T10:00:00Z';
  now(): Date { this.samples++; return new Date(this.instant); }
}

test('PB-05 durable HTTP payment processing, concurrency, Clock and atomic release', async (t) => {
  const database = await openTestDatabase();
  const apps: NestExpressApplication[] = [];
  const urls: string[] = [];
  const clock = new TestClock();
  const config = loadConfig({ ...process.env, DATABASE_URL: testDatabaseUrl(), WEBHOOK_SECRET: secret,
    GATE_CREDENTIALS: JSON.stringify([{ id: 'entrance-1', buildingId: building, role: 'ENTRANCE', secret: entrance },
      { id: 'exit-1', buildingId: building, role: 'EXIT', secret: exit }]),
    DB_LOCK_TIMEOUT_MS: '2000', DB_STATEMENT_TIMEOUT_MS: '4000', DB_IDLE_TRANSACTION_TIMEOUT_MS: '5000' });
  async function start(options: Partial<typeof config> = {}): Promise<number> {
    const root = AppModule.register({ ...config, ...options });
    const parking = root.imports![0] as DynamicModule;
    const runtime = parking.imports![0] as DynamicModule;
    runtime.providers = runtime.providers!.filter((p) => !(typeof p === 'object' && 'provide' in p && p.provide === Clock));
    runtime.providers.push({ provide: Clock, useValue: clock });
    const app = await NestFactory.create<NestExpressApplication>(root, { logger: false, rawBody: true });
    apps.push(app); configureHttp(app); await app.listen(0, '127.0.0.1'); urls.push(await app.getUrl());
    assert.equal(app.get(DatabaseService, { each: true }).length, 1);
    return urls.length - 1;
  }
  async function send(payload: Event, instance = 0, raw = JSON.stringify(payload, null, 2) + '\n'): Promise<Result> {
    const response = await fetch(`${urls[instance]}/webhooks/payments`, { method: 'POST', headers: {
      'content-type': 'application/json', 'x-signature': createHmac('sha256', secret).update(raw).digest('hex'),
    }, body: raw });
    const text = await response.text();
    return { status: response.status, text, code: text ? JSON.parse(text).error?.code : undefined };
  }
  async function clear() {
    await database.pool.query('truncate payment_events,gate_request_outcomes,parking_sessions'); clock.samples = 0; clock.instant = '2026-11-13T10:00:00Z';
  }
  async function session(state = 'AWAITING_PAYMENT', resident = false, space = resident ? 1 : 51, plate = 'PAYCAR'): Promise<string> {
    const id = randomUUID();
    await database.pool.query(`insert into parking_sessions
      (id,building_id,space_id,normalized_plate,vehicle_type,is_resident,state,check_in_at,checkout_at,duration_minutes,charge_cents,completed_at)
      values ($1,$2,$3,$4,'CAR',$5,$6::session_state,'2026-11-13T08:00:00Z',
        case when $6::session_state='PARKED' then null else '2026-11-13T09:10:00Z'::timestamptz end,
        case when $6::session_state='PARKED' then null else 70 end,
        case when $6::session_state='PARKED' then null when $5 then 0 else 1000 end,
        case when $6::session_state='COMPLETED' then '2026-11-13T09:10:00Z'::timestamptz else null end)`, [id, building, space, plate, resident, state]);
    return id;
  }
  async function row(id: string) { return (await database.pool.query('select * from parking_sessions where id=$1', [id])).rows[0]; }
  async function events(id?: string) { return (await database.pool.query(`select * from payment_events ${id ? 'where session_id=$1' : ''} order by payment_id`, id ? [id] : [])).rows; }
  async function occupied(space: number): Promise<boolean> {
    const response = await fetch(`${urls[0]}/occupancy`); assert.equal(response.status, 200); return (await response.json())[space - 1].isOccupied;
  }
  async function checkout(id: string, instance = 0): Promise<Result> {
    const response = await fetch(`${urls[instance]}/check-out`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${exit}`, 'x-request-id': randomUUID(),
    }, body: JSON.stringify({ parkingSessionId: id, isResident: false }) });
    const text = await response.text(); return { status: response.status, text, code: text ? JSON.parse(text).error?.code : undefined };
  }
  async function reserveParticipants() {
    // Hold every other pool connection so each real HTTP request must use the
    // identified backend. No production hooks or application_name guessing.
    const held = [];
    const pids: number[] = [];
    try {
      for (const app of apps.slice(0, 2)) {
        const pool = app.get(DatabaseService).pool;
        for (let i = 0; i < config.poolMax - 1; i++) held.push(await pool.connect());
        const participant = await pool.connect();
        try { pids.push((await participant.query('select pg_backend_pid() pid')).rows[0].pid); }
        finally { participant.release(); }
      }
      assert.equal(new Set(pids).size, 2);
      return { held, pids };
    } catch (error) { held.forEach((client) => client.release()); throw error; }
  }
  async function waitForBlock(waiter: number, blockers: number[]) {
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const current = (await database.pool.query<{ blockers: number[] }>('select pg_blocking_pids($1::int) blockers', [waiter])).rows[0].blockers;
      if (current.some((pid) => blockers.includes(pid))) return;
    }
    assert.fail(`Expected identified backend ${waiter} to block on participating connections`);
  }
  async function overlap(first: () => Promise<Result>, second: () => Promise<Result>) {
    const participants = await reserveParticipants();
    const holder = await database.pool.connect(); let pending: Promise<Result>[] = [];
    try {
      const holderPid = (await holder.query('select pg_backend_pid() pid')).rows[0].pid as number;
      await holder.query('begin'); await holder.query('select id from buildings where id=$1 for update', [building]);
      pending = [first(), second()];
      await waitForBlock(participants.pids[0], [holderPid, participants.pids[1]]);
      await waitForBlock(participants.pids[1], [holderPid, participants.pids[0]]);
      assert.equal(clock.samples, 0);
      await holder.query('commit'); return await Promise.all(pending);
    } finally {
      await holder.query('rollback'); holder.release(); await Promise.allSettled(pending);
      participants.held.forEach((client) => client.release());
    }
  }
  try {
    await database.pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public');
    await migrateDatabase(database); await seedPilot(database); await start(); await start();

    await t.test('invalid Unicode IDs are rejected before pool acquisition; valid Unicode locks, persists and replays exactly', async () => {
      await clear(); const id = await session(); const pool = apps[0].get(DatabaseService).pool; let acquisitions = 0;
      const count = () => { acquisitions++; }; pool.on('acquire', count);
      try {
        for (const paymentId of ['bad-\ud800', 'bad-\udc00', 'bad-\u0000']) {
          const result = await send(event(id, 'FAILED', 1, 'USD', paymentId));
          assert.equal(result.status, 400); assert.equal(result.code, 'INVALID_REQUEST');
        }
        assert.equal(acquisitions, 0); assert.equal((await events()).length, 0); assert.equal(clock.samples, 0);
      } finally { pool.off('acquire', count); }
      for (const paymentId of ['receipt-🚗-é', 'receipt-🚗-e\u0301', '🚗'.repeat(128)]) {
        const failed = event(id, 'FAILED', 1, 'USD', paymentId);
        const holder = await database.pool.connect(); let pending: Promise<Result> | undefined;
        try {
          await holder.query('begin'); await holder.query('select pg_advisory_xact_lock($1::int,$2::int)',
            [PAYMENT_EVENT_NAMESPACE, paymentEventKey(PILOT_PROVIDER_ID, paymentId)]);
          const holderPid = (await holder.query('select pg_backend_pid() pid')).rows[0].pid as number;
          pending = send(failed);
          const deadline = Date.now() + 1500; let blocked = false;
          while (Date.now() < deadline) {
            const waiters = await database.pool.query<{ n: number }>(`select count(*)::int n from pg_stat_activity
              where $1::int=any(pg_blocking_pids(pid))`, [holderPid]);
            if (waiters.rows[0].n > 0) { blocked = true; break; }
          }
          assert.equal(blocked, true, 'same exact Unicode identity acquires the same advisory lock');
          await holder.query('commit'); assert.equal((await pending).status, 204);
        } finally { await holder.query('rollback'); holder.release(); if (pending) await Promise.allSettled([pending]); }
        assert.equal((await send(failed, 1)).status, 204);
        const stored = (await events(id)).filter((record) => record.payment_id === paymentId);
        assert.equal(stored.length, 1); assert.equal(Buffer.from(stored[0].payment_id).toString('hex'), Buffer.from(paymentId).toString('hex'));
      }
      assert.equal((await events(id)).length, 3, 'canonically equivalent spellings remain distinct IDs');
      assert.equal(clock.samples, 0);
    });
    await t.test('FAILED mismatch records immutable original values; distinct exact PAID settles once; late FAILED does not undo', async () => {
      await clear(); const id = await session(); const before = await row(id);
      const failed = event(id, 'FAILED', 7, 'USD'); assert.equal((await send(failed)).status, 204);
      assert.equal(clock.samples, 0); assert.deepEqual(await row(id), before); assert.equal(await occupied(51), true);
      const stored = (await events(id))[0]; assert.equal(stored.amount_cents, '7'); assert.equal(stored.currency, 'USD'); assert.equal(stored.status, 'FAILED');
      assert.equal((await send({ ...failed, status: 'PAID' })).code, 'PAYMENT_ID_REUSED');
      const paid = event(id); const accepted = await send(paid); assert.equal(accepted.status, 204); assert.equal(accepted.text, '');
      const completed = await row(id); assert.equal(completed.state, 'COMPLETED'); assert.equal(completed.completed_at.toISOString(), new Date(clock.instant).toISOString());
      assert.equal(completed.checkout_at.toISOString(), before.checkout_at.toISOString()); assert.equal(completed.charge_cents, '1000'); assert.equal(clock.samples, 1);
      assert.equal(await occupied(51), false);
      assert.equal((await send(failed, 1)).status, 204); assert.deepEqual(await row(id), completed); assert.equal(clock.samples, 1);
      const late = event(id, 'FAILED', 1, 'GBP'); assert.equal((await send(late)).status, 204);
      assert.equal(clock.samples, 1); assert.deepEqual(await row(id), completed);
      assert.equal((await events(id)).filter((e) => e.disposition === 'SETTLED').length, 1);
    });
    await t.test('accepted identity precedes session lookup; canonical duplicates replay and every payload field is immutable', async () => {
      await clear(); const id = await session(); const paid = event(id); assert.equal((await send(paid)).status, 204);
      const completed = await row(id); const count = clock.samples;
      const unauthenticated = await fetch(`${urls[0]}/webhooks/payments`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signature': '0'.repeat(64) }, body: JSON.stringify(paid) });
      assert.equal(unauthenticated.status, 401);
      const duplicate = { ...paid, parkingSessionId: id.toUpperCase() };
      assert.equal((await send(duplicate, 1, JSON.stringify(duplicate))).status, 204);
      for (const change of [{ parkingSessionId: randomUUID() }, { status: 'FAILED' as const },
        { amount: { value: 999, currency: 'EUR' } }, { amount: { value: 1000, currency: 'USD' } }]) {
        assert.equal((await send({ ...paid, ...change })).code, 'PAYMENT_ID_REUSED');
      }
      assert.deepEqual(await row(id), completed); assert.equal(clock.samples, count); assert.equal((await events()).length, 1);
    });
    await t.test('unknown session and pre-checkout events are unbound; unchanged early PAID redelivers after checkout', async () => {
      await clear(); assert.equal((await send(event(randomUUID()))).status, 404); assert.equal((await events()).length, 0);
      const id = await session('PARKED'); const paid = event(id, 'PAID', 1000); const failed = event(id, 'FAILED');
      assert.equal((await send(paid)).code, 'CHECKOUT_REQUIRED'); assert.equal((await send(failed)).code, 'CHECKOUT_REQUIRED');
      assert.equal(clock.samples, 0); assert.equal((await events()).length, 0); assert.equal(await occupied(51), true);
      clock.instant = '2026-11-13T09:10:00Z'; assert.equal((await checkout(id)).status, 200);
      clock.samples = 0; clock.instant = '2026-11-13T10:00:00Z';
      assert.equal((await send(paid)).status, 204); assert.equal(clock.samples, 1); assert.equal((await row(id)).state, 'COMPLETED');
    });
    await t.test('mismatched PAID is unbound and does not sample Clock or release allocation', async () => {
      await clear(); const id = await session(); const before = await row(id);
      for (const paid of [event(id, 'PAID', 999), event(id, 'PAID', 1000, 'USD'), event(id, 'PAID', 0)]) {
        assert.equal((await send(paid)).code, 'PAYMENT_MISMATCH');
      }
      assert.equal((await events()).length, 0); assert.equal(clock.samples, 0); assert.deepEqual(await row(id), before); assert.equal(await occupied(51), true);
    });
    await t.test('new PAID after paid/free completion is reconciled without touching a later occupant', async () => {
      for (const free of [false, true]) {
        await clear(); const id = await session(free ? 'COMPLETED' : 'AWAITING_PAYMENT', free);
        if (!free) assert.equal((await send(event(id))).status, 204);
        const completed = await row(id); const samples = clock.samples;
        const space = free ? 1 : 51;
        const next = await session('PARKED', free, space, 'NEWOCCUPANT'); const nextBefore = await row(next);
        const unexpected = event(id, 'PAID', 17, 'USD'); assert.equal((await send(unexpected)).status, 204);
        assert.equal((await send(unexpected, 1)).status, 204);
        assert.equal((await events(id)).filter((e) => e.payment_id === unexpected.paymentId && e.disposition === 'RECONCILIATION_REQUIRED').length, 1);
        assert.equal((await send({ ...unexpected, amount: { value: 18, currency: 'USD' } })).code, 'PAYMENT_ID_REUSED');
        const failed = event(id, 'FAILED', 2, 'USD'); assert.equal((await send(failed)).status, 204);
        assert.deepEqual(await row(id), completed); assert.deepEqual(await row(next), nextBefore); assert.equal(clock.samples, samples);
        assert.equal(await occupied(space), true);
      }
    });
    for (const kind of ['duplicate', 'distinct PAID', 'late FAILED'] as const) {
      await t.test(`controlled concurrent settlement and ${kind} across app instances`, async () => {
        await clear(); const id = await session(); const paid = event(id);
        const second = kind === 'duplicate' ? paid : event(id, kind === 'late FAILED' ? 'FAILED' : 'PAID', kind === 'late FAILED' ? 3 : 1000, kind === 'late FAILED' ? 'USD' : 'EUR');
        const results = await overlap(() => send(paid), () => send(second, 1));
        assert.deepEqual(results.map((r) => r.status), [204, 204]); assert.equal(clock.samples, 1);
        const stored = await events(id); assert.equal(stored.length, kind === 'duplicate' ? 1 : 2);
        assert.equal(stored.filter((e) => e.disposition === 'SETTLED').length, 1);
        if (kind === 'distinct PAID') assert.equal(stored.filter((e) => e.disposition === 'RECONCILIATION_REQUIRED').length, 1);
        assert.equal((await row(id)).state, 'COMPLETED'); assert.equal(await occupied(51), false);
      });
    }
    await t.test('concurrent reconciliation events commit independently and identical redeliveries deduplicate', async () => {
      for (const duplicate of [false, true]) {
        await clear(); const id = await session('COMPLETED', true); const before = await row(id);
        const first = event(id, 'PAID', 9, 'USD'); const second = duplicate ? first : event(id, 'PAID', 11, 'GBP');
        const results = await overlap(() => send(first), () => send(second, 1));
        assert.deepEqual(results.map((r) => r.status), [204, 204]);
        const stored = await events(id); assert.equal(stored.length, duplicate ? 1 : 2);
        assert.ok(stored.every((e) => e.disposition === 'RECONCILIATION_REQUIRED'));
        assert.deepEqual(await row(id), before); assert.equal(clock.samples, 0);
      }
    });
    await t.test('concurrent conflicting identity binds exactly one immutable event', async () => {
      await clear(); const id = await session(); const paid = event(id);
      const results = await overlap(() => send(paid), () => send({ ...paid, status: 'FAILED' }, 1));
      assert.deepEqual(results.map((r) => r.status).sort(), [204, 409]); assert.equal(results.find((r) => r.status === 409)?.code, 'PAYMENT_ID_REUSED');
      assert.equal((await events()).length, 1);
    });
    for (const checkoutFirst of [true, false]) {
      await t.test(`identified checkout/payment race: ${checkoutFirst ? 'checkout' : 'payment'} obtains building lock first`, async () => {
        await clear(); const id = await session('PARKED'); const paid = event(id); clock.instant = '2026-11-13T09:10:00Z';
        const participants = await reserveParticipants(); const holder = await database.pool.connect();
        let checking: Promise<Result> | undefined; let paying: Promise<Result> | undefined;
        try {
          await holder.query('begin'); await holder.query('select id from buildings where id=$1 for update', [building]);
          const holderPid = (await holder.query('select pg_backend_pid() pid')).rows[0].pid as number;
          const [checkoutPid, paymentPid] = participants.pids;
          if (checkoutFirst) checking = checkout(id, 0);
          else paying = send(paid, 1);
          const firstPid = checkoutFirst ? checkoutPid : paymentPid;
          const secondPid = checkoutFirst ? paymentPid : checkoutPid;
          await waitForBlock(firstPid, [holderPid]);
          if (checkoutFirst) paying = send(paid, 1);
          else checking = checkout(id, 0);
          // The second identified backend queues behind the first tuple-lock waiter.
          await waitForBlock(secondPid, [firstPid]);
          assert.equal(clock.samples, 0);
          await holder.query('commit');
          const checked = await checking!; const payment = await paying!;
          assert.equal(checked.status, 200);
          if (checkoutFirst) {
            assert.equal(payment.status, 204); assert.equal((await row(id)).state, 'COMPLETED');
          } else {
            assert.equal(payment.status, 409); assert.equal(payment.code, 'CHECKOUT_REQUIRED');
            assert.equal((await events()).length, 0); assert.equal((await row(id)).state, 'AWAITING_PAYMENT');
            assert.equal(clock.samples, 1);
            assert.equal((await send(paid, 1)).status, 204);
          }
          assert.equal((await row(id)).state, 'COMPLETED'); assert.equal((await events()).length, 1);
          assert.equal(await occupied(51), false); assert.equal(clock.samples, 2);
        } finally {
          await holder.query('rollback'); holder.release();
          await Promise.allSettled([checking, paying].filter((request): request is Promise<Result> => request !== undefined));
          participants.held.forEach((client) => client.release());
        }
      });
    }
    await t.test('outcome insertion failure rolls back both settlement and reconciliation and allows retry', async () => {
      for (const reconciliation of [false, true]) {
        await clear(); const id = await session(reconciliation ? 'COMPLETED' : 'AWAITING_PAYMENT', reconciliation);
        const before = await row(id); const paid = event(id);
        await database.pool.query(`create function fail_test_payment() returns trigger language plpgsql as $$ begin raise exception 'Injected payment persistence failure'; end; $$;
          create trigger test_payment_failure before insert on payment_events for each row execute function fail_test_payment()`);
        try {
          assert.equal((await send(paid)).status, 500); assert.deepEqual(await row(id), before); assert.equal((await events()).length, 0);
          if (reconciliation) assert.equal(clock.samples, 0);
        } finally { await database.pool.query('drop trigger test_payment_failure on payment_events; drop function fail_test_payment()'); }
        assert.equal((await send(paid)).status, 204); assert.equal((await events()).length, 1);
      }
    });
    await t.test('bounded request lock timeout does not bind and same event recovers', async () => {
      await clear(); const id = await session(); const paid = event(id); const instance = await start({ lockTimeoutMs: 150, statementTimeoutMs: 1000 });
      const holder = await database.pool.connect();
      try {
        await holder.query('begin'); await holder.query('select pg_advisory_xact_lock($1::int,$2::int)', [PAYMENT_EVENT_NAMESPACE, paymentEventKey(PILOT_PROVIDER_ID, paid.paymentId)]);
        const result = await send(paid, instance); assert.equal(result.status, 503); assert.equal(result.code, 'PAYMENT_TEMPORARILY_UNAVAILABLE');
        assert.equal(clock.samples, 0); assert.equal((await events()).length, 0); assert.equal((await row(id)).state, 'AWAITING_PAYMENT');
      } finally { await holder.query('rollback'); holder.release(); }
      assert.equal((await send(paid, instance)).status, 204);
    });
    await t.test('Clock is sampled after the session lock immediately before settlement', async () => {
      await clear(); const id = await session(); const paid = event(id); const holder = await database.pool.connect(); let pending: Promise<Result> | undefined;
      try {
        await holder.query('begin'); await holder.query('select id from parking_sessions where id=$1 for update', [id]);
        const pid = (await holder.query('select pg_backend_pid() pid')).rows[0].pid;
        pending = send(paid); const deadline = Date.now() + 1500; let blocked = false;
        while (Date.now() < deadline) {
          if ((await database.pool.query<{ blocked: boolean }>('select exists(select 1 from pg_stat_activity where $1::int=any(pg_blocking_pids(pid))) blocked', [pid])).rows[0].blocked) { blocked = true; break; }
        }
        assert.equal(blocked, true); assert.equal(clock.samples, 0); clock.instant = '2026-11-13T10:01:00Z';
        await holder.query('commit'); assert.equal((await pending).status, 204); assert.equal(clock.samples, 1);
        assert.equal((await row(id)).completed_at.toISOString(), new Date(clock.instant).toISOString());
      } finally { await holder.query('rollback'); holder.release(); if (pending) await Promise.allSettled([pending]); }
    });
    await t.test('statement timeout after completion mutation rolls back settlement and permits exact-event recovery', async () => {
      await clear(); const id = await session(); const before = await row(id); const paid = event(id);
      const instance = await start({ lockTimeoutMs: 50, statementTimeoutMs: 150 });
      await database.pool.query(`create function timeout_test_payment() returns trigger language plpgsql as $$
        begin
          if not exists (select 1 from parking_sessions where id=NEW.session_id and state='COMPLETED') then
            raise exception 'Test expects completed mutation';
          end if;
          loop perform 1; end loop;
        end; $$;
        create trigger test_payment_timeout before insert on payment_events for each row execute function timeout_test_payment()`);
      try {
        const result = await send(paid, instance); assert.equal(result.status, 503); assert.equal(result.code, 'PAYMENT_TEMPORARILY_UNAVAILABLE');
        assert.deepEqual(await row(id), before); assert.equal((await events()).length, 0); assert.equal(await occupied(51), true);
      } finally { await database.pool.query('drop trigger test_payment_timeout on payment_events; drop function timeout_test_payment()'); }
      assert.equal((await send(paid, instance)).status, 204); assert.equal((await events()).length, 1); assert.equal(await occupied(51), false);
    });
    await t.test('real PB-03 reuses paid space and plate; old-session replay/reconciliation cannot touch its new occupant', async () => {
      await clear(); const id = await session(); const paid = event(id);
      assert.equal((await send(paid)).status, 204); const completed = await row(id); assert.equal(await occupied(51), false);
      const response = await fetch(`${urls[0]}/check-in`, { method: 'POST', headers: { 'content-type': 'application/json',
        authorization: `Bearer ${entrance}`, 'x-request-id': randomUUID() },
        body: JSON.stringify({ vehicleType: 'CAR', isResident: false, licensePlate: completed.normalized_plate }) });
      assert.equal(response.status, 201); const admission = await response.json(); assert.equal(admission.parkingSpaceId, 51);
      assert.notEqual(admission.parkingSessionId, id); const next = await row(admission.parkingSessionId); const samples = clock.samples;
      assert.equal((await send(paid, 1)).status, 204);
      assert.equal((await send(event(id, 'PAID', 1, 'USD'))).status, 204);
      assert.equal((await checkout(id)).status, 200);
      assert.deepEqual(await row(id), completed); assert.deepEqual(await row(admission.parkingSessionId), next);
      assert.equal(next.state, 'PARKED'); assert.equal(await occupied(51), true); assert.equal(clock.samples, samples);
    });
    await t.test('actual simulator signs bytes accepted by the backend while unsigned legacy is rejected', async () => {
      await clear(); const id = await session();
      const args = [resolve('simulator/send-webhook.mjs'), '--url', `${urls[0]}/webhooks/payments`, '--session', id, '--amount', '1000'];
      const signed = await promisify(execFile)(process.execPath, args, { env: { ...process.env, WEBHOOK_SECRET: secret }, timeout: 5000 });
      assert.match(signed.stdout, /HTTP 204/); assert.equal((await row(id)).state, 'COMPLETED');
      const legacy = await promisify(execFile)(process.execPath, [...args, '--legacy-terminal'], { env: { ...process.env, WEBHOOK_SECRET: secret }, timeout: 5000 });
      assert.match(legacy.stdout, /HTTP 401/); assert.equal((await events()).length, 1); assert.equal(clock.samples, 1);
    });
    await t.test('payment and gate namespaces are distinct; pool remains single and usable', async () => {
      assert.notEqual(PAYMENT_EVENT_NAMESPACE, GATE_REQUEST_NAMESPACE);
      assert.equal(paymentEventKey('pilot', 'id'), paymentEventKey('pilot', 'id'));
      assert.notEqual(paymentEventKey('pilot', 'id'), paymentEventKey('other', 'id'));
      assert.equal((await apps[0].get(DatabaseService).pool.query('select 1 n')).rows[0].n, 1);
    });
  } finally { for (const app of apps) await app.close(); await database.onModuleDestroy(); }
});
