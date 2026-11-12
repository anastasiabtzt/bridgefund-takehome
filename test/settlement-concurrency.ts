import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { PoolClient } from 'pg';
import type { DatabaseService } from '../src/database/database.service.js';

const building = 'PB-AMS-9X4T';
const pgError = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

async function begin(client: PoolClient): Promise<void> {
  // Allow the test to observe blockers before releasing them. Production settings
  // remain unchanged; real synchronization is observed, not inferred from timing.
  await client.query(`begin; set local lock_timeout='5s'; set local statement_timeout='10s';
    set local idle_in_transaction_session_timeout='10s'`);
}

async function lockBuilding(client: PoolClient): Promise<void> {
  await client.query('select id from buildings where id=$1 for update', [building]);
}

async function awaitingSession(client: PoolClient, space: number): Promise<string> {
  const id = randomUUID();
  await client.query(`insert into parking_sessions
    (id, building_id, space_id, normalized_plate, vehicle_type, is_resident, state,
     check_in_at, checkout_at, duration_minutes, charge_cents)
    values ($1, $2, $3, $4, 'CAR', false, 'AWAITING_PAYMENT',
     '2026-11-12T08:00:00Z', '2026-11-12T09:10:00Z', 70, 1000)`,
  [id, building, space, `SETTLE${space}`]);
  return id;
}

async function event(client: PoolClient, sessionId: string, status: 'PAID' | 'FAILED',
  disposition: 'SETTLED' | 'FAILED' | 'RECONCILIATION_REQUIRED', amount = 1000, currency = 'EUR'): Promise<void> {
  await client.query('insert into payment_events values ($1,$2,$3,$4,$5,$6,$7,$8)',
    ['pilot', randomUUID(), building, sessionId, amount, currency, status, disposition]);
}

async function complete(client: PoolClient, id: string): Promise<void> {
  await client.query("update parking_sessions set state='COMPLETED', completed_at='2026-11-12T09:11:00Z' where id=$1", [id]);
}

async function observeBlock(observer: PoolClient, waiter: number, blocker: number): Promise<void> {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    const result = await observer.query<{ blocked: boolean }>(
      'select $1::int = any(pg_blocking_pids($2::int)) as blocked', [blocker, waiter]);
    if (result.rows[0].blocked) return;
  }
  assert.fail('Expected PostgreSQL blocker was never observed; overlap was not established.');
}

async function committedState(observer: PoolClient, id: string) {
  const session = (await observer.query(`select state, charge_cents::text, duration_minutes::text,
    checkout_at, completed_at, (state in ('PARKED','AWAITING_PAYMENT')) as allocated
    from parking_sessions where id=$1`, [id])).rows[0];
  const events = (await observer.query(`select status, disposition, amount_cents::text, currency
    from payment_events where session_id=$1 order by disposition`, [id])).rows;
  assert.equal(session.charge_cents, '1000');
  assert.equal(session.duration_minutes, '70');
  assert.equal(session.checkout_at.toISOString(), '2026-11-12T09:10:00.000Z');
  return { session, events };
}

export async function settlementConcurrencyTests(t: TestContext, database: DatabaseService): Promise<void> {
  let nextSpace = 101;
  async function connections(action: (first: PoolClient, second: PoolClient, observer: PoolClient,
    pids: number[]) => Promise<void>): Promise<void> {
    const first = await database.pool.connect();
    const second = await database.pool.connect();
    const observer = await database.pool.connect();
    try {
      const pids = [];
      for (const client of [first, second, observer]) {
        pids.push((await client.query('select pg_backend_pid() as pid')).rows[0].pid as number);
      }
      assert.equal(new Set(pids).size, 3);
      await action(first, second, observer, pids);
    } finally {
      await first.query('rollback'); await second.query('rollback');
      first.release(); second.release(); observer.release();
    }
  }

  // All three are permitted overlaps. The second transaction waits on the same
  // building/session lock order and acts on the latest committed session state.
  for (const kind of ['second PAID attempt', 'late FAILED', 'new reconciliation event'] as const) {
    await t.test(`completion concurrent with ${kind}: both transactions commit safely`, () => connections(async (first, second, observer, pids) => {
      const id = await awaitingSession(first, nextSpace++);
      await begin(first); await lockBuilding(first);
      await first.query('select id from parking_sessions where id=$1 for update', [id]);
      await complete(first, id); await event(first, id, 'PAID', 'SETTLED');
      await begin(second);
      const waiting = lockBuilding(second);
      // Attach a rejection handler immediately, while the observer proves overlap.
      const lockResult = waiting.then(() => undefined, (error: unknown) => error);
      await observeBlock(observer, pids[1], pids[0]);
      assert.equal((await committedState(observer, id)).session.state, 'AWAITING_PAYMENT');
      await first.query('commit');
      assert.equal(await lockResult, undefined);
      const latest = await second.query('select state from parking_sessions where id=$1 for update', [id]);
      assert.equal(latest.rows[0].state, 'COMPLETED');
      if (kind === 'late FAILED') {
        await event(second, id, 'FAILED', 'FAILED', 1, 'USD');
      } else {
        // A distinct PAID after completion is accepted for investigation, not
        // applied as a second settlement. No duplicate charge is inferred.
        await event(second, id, 'PAID', 'RECONCILIATION_REQUIRED', 17, 'USD');
      }
      await second.query('commit');
      const result = await committedState(observer, id);
      assert.equal(result.session.state, 'COMPLETED');
      assert.equal(result.session.allocated, false);
      assert.equal(result.session.completed_at.toISOString(), '2026-11-12T09:11:00.000Z');
      assert.equal(result.events.length, 2);
      assert.equal(result.events.filter((item) => item.disposition === 'SETTLED').length, 1);
      assert.ok(result.events.some((item) => item.currency === 'USD'
        && item.amount_cents === (kind === 'late FAILED' ? '1' : '17')
        && item.disposition === (kind === 'late FAILED' ? 'FAILED' : 'RECONCILIATION_REQUIRED')));
    }));
  }

  await t.test('concurrent second applied settlement is prohibited, not every overlapping event', () => connections(async (first, second, observer, pids) => {
    const id = await awaitingSession(first, nextSpace++);
    await begin(first); await lockBuilding(first);
    await first.query('select id from parking_sessions where id=$1 for update', [id]);
    await complete(first, id); await event(first, id, 'PAID', 'SETTLED');
    await begin(second);
    // Deliberately bypass orchestration to test the constraint backstop. The
    // pending unique entry waits for the first commit, then rejects this write.
    const illegal = event(second, id, 'PAID', 'SETTLED').then(() => undefined, (error: unknown) => error);
    await observeBlock(observer, pids[1], pids[0]);
    await first.query('commit');
    assert.ok(pgError('23505')(await illegal));
    await second.query('rollback');
    const result = await committedState(observer, id);
    assert.equal(result.session.state, 'COMPLETED');
    assert.equal(result.session.allocated, false);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].disposition, 'SETTLED');
  }));

  for (const valid of [true, false]) {
    await t.test(`${valid ? 'valid' : 'invalid'} settlement is validated by actual COMMIT`, () => connections(async (first, _second, observer) => {
      const id = await awaitingSession(first, nextSpace++);
      await begin(first); await lockBuilding(first);
      await first.query('select id from parking_sessions where id=$1 for update', [id]);
      await complete(first, id);
      await event(first, id, 'PAID', 'SETTLED', valid ? 1000 : 999);
      const beforeCommit = await committedState(observer, id);
      assert.equal(beforeCommit.session.state, 'AWAITING_PAYMENT');
      assert.equal(beforeCommit.events.length, 0);
      // No SET CONSTRAINTS IMMEDIATE: deferred validation runs at COMMIT itself.
      if (valid) await first.query('commit');
      else await assert.rejects(first.query('commit'), pgError('23514'));
      const result = await committedState(observer, id);
      assert.equal(result.session.state, valid ? 'COMPLETED' : 'AWAITING_PAYMENT');
      assert.equal(result.session.allocated, !valid);
      assert.equal(result.events.length, valid ? 1 : 0);
      if (valid) assert.equal(result.events[0].amount_cents, '1000');
      else assert.equal(result.session.completed_at, null);
    }));
  }
}
