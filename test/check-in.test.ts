import 'reflect-metadata';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { canonicalCheckIn, canonicalRequestId, eligibleRange } from '../src/parking/check-in.rules.js';
import { gateRequestKey } from '../src/parking/gate-request-key.js';
import { loadConfig, APP_CONFIG } from '../src/config.js';
import { CheckInController } from '../src/parking/check-in.controller.js';
import { CheckInService } from '../src/parking/check-in.service.js';
import { GateAuthGuard } from '../src/parking/gate-auth.guard.js';
import { configureHttp } from '../src/http.js';

const secret = 'test-entrance-secret-01234567890123456789';
const exitSecret = 'test-exit-secret-01234567890123456789';
const gates = [{ id: 'entrance-1', buildingId: 'PB-AMS-9X4T', role: 'ENTRANCE', secret },
  { id: 'exit-1', buildingId: 'PB-AMS-9X4T', role: 'EXIT', secret: exitSecret }];
const uuid = 'ABCDEFAB-1234-1234-1234-123456789ABC';
const body = { vehicleType: 'CAR', isResident: false, licensePlate: 'ab-123 c' };

@Module({})
class TestModule {}

test('check-in canonicalization, strict validation, eligible ranges and identity encoding', () => {
  const payload = canonicalCheckIn(body);
  assert.deepEqual(payload, { vehicleType: 'CAR', isResident: false, normalizedLicensePlate: 'AB123C' });
  assert.deepEqual(eligibleRange(payload), [51, 130]);
  assert.deepEqual(eligibleRange({ ...payload, vehicleType: 'MOTOR' }), [131, 150]);
  for (const vehicleType of ['CAR', 'MOTOR'] as const) assert.deepEqual(eligibleRange({ ...payload, vehicleType, isResident: true }), [1, 50]);
  for (const invalid of [null, [], {}, { ...body, extra: true }, { ...body, isResident: 'false' },
    { ...body, vehicleType: 'car' }, { ...body, licensePlate: ' - ' }, { ...body, licensePlate: 'é1' },
    { ...body, licensePlate: 'A'.repeat(17) }, { ...body, licensePlate: 'A'.padEnd(33, ' ') }]) {
    assert.throws(() => canonicalCheckIn(invalid));
  }
  assert.equal(canonicalCheckIn({ ...body, licensePlate: 'A'.repeat(16).padEnd(32, ' ') }).normalizedLicensePlate.length, 16);
  assert.equal(canonicalRequestId(uuid), uuid.toLowerCase());
  assert.throws(() => canonicalRequestId('invalid'));
  assert.equal(gateRequestKey('a', 'CHECK_IN', uuid), gateRequestKey('a', 'CHECK_IN', uuid.toLowerCase()));
  assert.notEqual(gateRequestKey('a', 'CHECK_IN', uuid), gateRequestKey('a', 'CHECK_OUT', uuid));
});

test('gate configuration fails closed and never includes credentials in errors', () => {
  const env = { DATABASE_URL: 'postgresql://local:local@localhost/db' };
  assert.deepEqual(loadConfig(env).gates, []);
  assert.equal(loadConfig({ ...env, GATE_CREDENTIALS: JSON.stringify(gates) }).gates.length, 2);
  for (const raw of ['invalid', '{}', JSON.stringify([...gates, gates[0]]), JSON.stringify([{ ...gates[0], secret: 'short' }])]) {
    assert.throws(() => loadConfig({ ...env, GATE_CREDENTIALS: raw }), (error: Error) => !error.message.includes(secret));
  }
});

test('check-in HTTP validates gate permissions, raw headers, JSON and safe failure envelopes', async () => {
  const config = loadConfig({ DATABASE_URL: 'postgresql://local:local@localhost/db', GATE_CREDENTIALS: JSON.stringify(gates) });
  let calls = 0;
  let failure: unknown;
  let terminal = false;
  const success = { parkingSessionId: '550e8400-e29b-41d4-a716-446655440000', parkingSpaceId: 51 };
  const app = await NestFactory.create<NestExpressApplication>({
    module: TestModule, controllers: [CheckInController],
    providers: [GateAuthGuard, { provide: APP_CONFIG, useValue: config }, { provide: CheckInService, useValue: {
      execute: async (building: string, id: string, payload: unknown) => {
        calls++;
        assert.equal(building, 'PB-AMS-9X4T'); assert.equal(id, uuid.toLowerCase());
        assert.deepEqual(payload, canonicalCheckIn(body));
        if (failure) throw failure;
        return terminal ? { status: 409, body: { error: { code: 'PARKING_FULL', message: 'No eligible space is available.' } } }
          : { status: 201, body: success };
      },
    } }],
  }, { logger: false });
  configureHttp(app);
  try {
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/check-in`;
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${secret}`, 'x-request-id': uuid };
    const send = (content: string, overrides: Record<string, string> = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...overrides }, body: content });
    const ok = await send(JSON.stringify(body));
    assert.equal(ok.status, 201); assert.deepEqual(await ok.json(), success);
    for (const [content, overrides, status, code] of [
      [JSON.stringify(body), { authorization: '' }, 401, 'UNAUTHENTICATED'],
      [JSON.stringify(body), { authorization: 'Bearer wrong' }, 401, 'UNAUTHENTICATED'],
      [JSON.stringify(body), { authorization: `Bearer ${exitSecret}` }, 403, 'GATE_NOT_AUTHORIZED'],
      [JSON.stringify(body), { 'content-type': 'text/plain' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
      [JSON.stringify(body), { 'content-type': 'application/json; charset=unsupported' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
      ['{', {}, 400, 'INVALID_REQUEST'],
      ['x'.repeat(4097), {}, 413, 'PAYLOAD_TOO_LARGE'],
      [JSON.stringify({ ...body, extra: 1 }), {}, 400, 'INVALID_REQUEST'],
      [JSON.stringify(body), { 'x-request-id': '' }, 400, 'INVALID_REQUEST'],
    ] as [string, Record<string, string>, number, string][]) {
      const response = await send(content, overrides);
      assert.equal(response.status, status);
      const result = await response.json();
      assert.equal(result.error.code, code);
      assert.doesNotMatch(JSON.stringify(result), /ab-123|secret|password/i);
    }
    // Raw HTTP preserves duplicate field lines; fetch merges them.
    const duplicateStatus = await new Promise<number>((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: ['Content-Type', 'application/json', 'Authorization', `Bearer ${secret}`,
        'X-Request-Id', uuid, 'X-Request-Id', uuid] }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      req.on('error', reject); req.end(JSON.stringify(body));
    });
    assert.equal(duplicateStatus, 400);
    assert.equal(calls, 1);
    terminal = true;
    const full = await send(JSON.stringify(body)); assert.equal(full.status, 409); assert.equal((await full.json()).error.code, 'PARKING_FULL');
    for (const [error, status, code] of [
      [new Error('private query', { cause: { code: '55P03' } }), 503, 'CHECK_IN_TEMPORARILY_UNAVAILABLE'],
      [new Error('private query', { cause: { code: '23505', constraint: 'one_active_allocation_per_space' } }), 503, 'CHECK_IN_TEMPORARILY_UNAVAILABLE'],
      [new Error('private query', { cause: { code: '23505', constraint: 'other_index' } }), 500, 'INTERNAL_ERROR'],
      [new Error('private query', { cause: { code: '42P01' } }), 500, 'INTERNAL_ERROR'],
    ] as const) {
      failure = error;
      const response = await send(JSON.stringify(body)); assert.equal(response.status, status);
      assert.equal((await response.json()).error.code, code);
    }
  } finally { await app.close(); }
});
