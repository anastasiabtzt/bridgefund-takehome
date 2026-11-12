import 'reflect-metadata';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { APP_CONFIG, loadConfig } from '../src/config.js';
import { configureHttp } from '../src/http.js';
import { CheckOutController } from '../src/parking/check-out.controller.js';
import { canonicalCheckOut, sameCheckoutPayload } from '../src/parking/check-out.rules.js';
import { CheckOutService, CheckOutUnavailable, ClockInconsistency } from '../src/parking/check-out.service.js';
import { GateAuthGuard } from '../src/parking/gate-auth.guard.js';

const secret = 'exit-test-secret-01234567890123456789';
const entrance = 'entrance-test-secret-01234567890123456789';
const id = 'ABCDEFAB-1234-1234-1234-123456789ABC';
const key = '12345678-1234-1234-1234-123456789ABC';
const body = { parkingSessionId: id, isResident: false };
@Module({})
class TestModule {}

test('checkout strict canonical payload and comparison', () => {
  const canonical = canonicalCheckOut(body);
  assert.equal(canonical.parkingSessionId, id.toLowerCase());
  assert.equal(sameCheckoutPayload(canonical, canonical), true);
  assert.equal(sameCheckoutPayload({ ...canonical, isResident: true }, canonical), false);
  assert.equal(sameCheckoutPayload(null, canonical), false);
  for (const value of [null, [], {}, { ...body, extra: 1 }, { ...body, isResident: 'false' },
    { ...body, parkingSessionId: 'invalid' }, { parkingSessionId: id }]) assert.throws(() => canonicalCheckOut(value));
});

test('checkout HTTP enforces EXIT, strict input, explicit 200 and safe failures', async () => {
  const config = loadConfig({ DATABASE_URL: 'postgresql://local:local@localhost/db', GATE_CREDENTIALS: JSON.stringify([
    { id: 'exit-1', buildingId: 'PB-AMS-9X4T', role: 'EXIT', secret },
    { id: 'entrance-1', buildingId: 'PB-AMS-9X4T', role: 'ENTRANCE', secret: entrance },
  ]) });
  let calls = 0;
  let failure: unknown;
  let outcome = { status: 200, body: { parkingSpaceId: 51, sessionLengthInMinutes: 70, amountDue: { value: 1000, currency: 'EUR' } } as unknown };
  const app = await NestFactory.create<NestExpressApplication>({ module: TestModule, controllers: [CheckOutController], providers: [
    GateAuthGuard, { provide: APP_CONFIG, useValue: config }, { provide: CheckOutService, useValue: {
      execute: async (building: string, requestId: string, payload: unknown) => {
        calls++; assert.equal(building, 'PB-AMS-9X4T'); assert.equal(requestId, key.toLowerCase());
        assert.deepEqual(payload, canonicalCheckOut(body));
        if (failure) throw failure;
        return outcome;
      },
    } },
  ] }, { logger: false });
  configureHttp(app);
  try {
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/check-out`;
    const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'x-request-id': key };
    const send = (content = JSON.stringify(body), overrides: Record<string, string> = {}) => fetch(url, {
      method: 'POST', headers: { ...headers, ...overrides }, body: content,
    });
    const ok = await send(); assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), outcome.body);
    for (const [content, overrides, status, code] of [
      [JSON.stringify(body), { authorization: '' }, 401, 'UNAUTHENTICATED'],
      [JSON.stringify(body), { authorization: 'Bearer wrong' }, 401, 'UNAUTHENTICATED'],
      [JSON.stringify(body), { authorization: `Bearer ${entrance}` }, 403, 'GATE_NOT_AUTHORIZED'],
      [JSON.stringify(body), { 'x-request-id': '' }, 400, 'INVALID_REQUEST'],
      [JSON.stringify(body), { 'x-request-id': 'invalid' }, 400, 'INVALID_REQUEST'],
      [JSON.stringify({ ...body, extra: true }), {}, 400, 'INVALID_REQUEST'],
      [JSON.stringify({ ...body, isResident: 'false' }), {}, 400, 'INVALID_REQUEST'],
      [JSON.stringify(body), { 'content-type': 'text/plain' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
      ['{', { authorization: '' }, 400, 'INVALID_REQUEST'],
      ['x'.repeat(4097), { authorization: '' }, 413, 'PAYLOAD_TOO_LARGE'],
    ] as [string, Record<string, string>, number, string][]) {
      const response = await send(content, overrides); assert.equal(response.status, status);
      assert.equal((await response.json()).error.code, code);
    }
    const missing = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(missing.status, 400); assert.equal((await missing.json()).error.code, 'INVALID_REQUEST');
    const duplicate = await new Promise<number>((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: ['Authorization', `Bearer ${secret}`, 'Content-Type', 'application/json',
        'X-Request-Id', key, 'X-Request-Id', key] }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      req.on('error', reject); req.end(JSON.stringify(body));
    });
    assert.equal(duplicate, 400); assert.equal(calls, 1);
    for (const [status, code] of [[404, 'SESSION_NOT_FOUND'], [409, 'RESIDENT_STATUS_MISMATCH'], [409, 'IDEMPOTENCY_KEY_REUSED']] as const) {
      outcome = { status, body: { error: { code, message: 'Safe rejection.' } } };
      const response = await send(); assert.equal(response.status, status); assert.equal((await response.json()).error.code, code);
    }
    for (const [error, status, code] of [
      [new ClockInconsistency(), 500, 'CLOCK_INCONSISTENCY'],
      [new CheckOutUnavailable(), 503, 'CHECK_OUT_TEMPORARILY_UNAVAILABLE'],
      [new Error('private SQL', { cause: { code: '57014' } }), 503, 'CHECK_OUT_TEMPORARILY_UNAVAILABLE'],
      [new Error('private SQL', { cause: { code: '23505' } }), 500, 'INTERNAL_ERROR'],
      [new Error('private SQL'), 500, 'INTERNAL_ERROR'],
    ] as const) {
      failure = error; const response = await send(); assert.equal(response.status, status);
      const result = await response.json(); assert.equal(result.error.code, code);
      assert.doesNotMatch(JSON.stringify(result), /private|SQL|secret/);
    }
  } finally { await app.close(); }
});
