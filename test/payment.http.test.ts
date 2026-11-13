import 'reflect-metadata';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import { test } from 'node:test';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { APP_CONFIG, loadConfig } from '../src/config.js';
import { configureHttp } from '../src/http.js';
import { CheckInController } from '../src/parking/check-in.controller.js';
import { CheckInService } from '../src/parking/check-in.service.js';
import { GateAuthGuard } from '../src/parking/gate-auth.guard.js';
import { PaymentController } from '../src/payments/payment.controller.js';
import { PaymentSignatureGuard } from '../src/payments/payment-signature.guard.js';
import { PaymentService, PaymentUnavailable } from '../src/payments/payment.service.js';
import { canonicalPayment } from '../src/payments/payment.rules.js';

const secret = 'http-provider-secret-01234567890123456789';
const payload = { paymentId: 'http-1', parkingSessionId: 'ABCDEFAB-1234-1234-1234-123456789ABC',
  amount: { value: 1000, currency: 'EUR' }, status: 'PAID' };
const sign = (raw: string) => createHmac('sha256', secret).update(raw).digest('hex');
@Module({})
class TestModule {}

test('payment HTTP verifies raw signatures and emits one sanitized diagnostic for unexpected failures', async (t) => {
  const diagnostics: unknown[][] = [];
  t.mock.method(Logger.prototype, 'error', (...args: unknown[]) => { diagnostics.push(args); });
  let calls = 0;
  let failure: unknown;
  let result: { status: number; body?: { error: { code: string; message: string } } } = { status: 204 };
  const app = await NestFactory.create<NestExpressApplication>({ module: TestModule, controllers: [PaymentController], providers: [
    PaymentSignatureGuard, { provide: APP_CONFIG, useValue: loadConfig({ DATABASE_URL: 'postgresql://local:local@localhost/db', WEBHOOK_SECRET: secret }) },
    { provide: PaymentService, useValue: { execute: async (incoming: unknown) => { calls++; assert.deepEqual(incoming, canonicalPayment(payload)); if (failure) throw failure; return result; } } },
  ] }, { logger: false, rawBody: true });
  configureHttp(app);
  try {
    await app.listen(0, '127.0.0.1'); const url = `${await app.getUrl()}/webhooks/payments`;
    const raw = JSON.stringify(payload, null, 2) + '\n';
    const send = (body = raw, signature = sign(body), extra: Record<string, string> = {}) => fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': signature, ...extra }, body,
    });
    const ok = await send(); assert.equal(ok.status, 204); assert.equal(await ok.text(), '');
    for (const [body, signature, extra, status, code] of [
      [raw, '', {}, 401, 'INVALID_SIGNATURE'], [raw, '', { 'x-legacy-exit': '1' }, 401, 'INVALID_SIGNATURE'],
      [raw, 'bad', {}, 401, 'INVALID_SIGNATURE'], [raw, sign(raw).toUpperCase(), {}, 401, 'INVALID_SIGNATURE'],
      [raw, '0'.repeat(64), {}, 401, 'INVALID_SIGNATURE'],
      [raw.replace('1000', '1001'), sign(raw), {}, 401, 'INVALID_SIGNATURE'],
      [JSON.stringify(payload), sign(raw), {}, 401, 'INVALID_SIGNATURE'],
      [raw, sign(raw), { 'content-type': 'text/plain' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
      ['{', sign('{'), {}, 400, 'INVALID_REQUEST'],
      ['x'.repeat(4097), sign('x'.repeat(4097)), {}, 413, 'PAYLOAD_TOO_LARGE'],
      [JSON.stringify({ ...payload, extra: true }), sign(JSON.stringify({ ...payload, extra: true })), {}, 400, 'INVALID_REQUEST'],
      [JSON.stringify({ ...payload, amount: { value: '1000', currency: 'EUR' } }),
        sign(JSON.stringify({ ...payload, amount: { value: '1000', currency: 'EUR' } })), {}, 400, 'INVALID_REQUEST'],
    ] as [string, string, Record<string, string>, number, string][]) {
      const response = await send(body, signature, extra); assert.equal(response.status, status);
      const data = await response.json(); assert.equal(data.error.code, code);
      assert.doesNotMatch(JSON.stringify(data), /http-1|http-provider|ABCDEFAB|private/);
    }
    const missing = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-legacy-exit': '1' }, body: raw });
    assert.equal(missing.status, 401);
    const duplicate = await new Promise<number>((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: ['Host', new URL(url).host, 'Content-Length', String(Buffer.byteLength(raw)), 'Content-Type', 'application/json', 'X-Signature', sign(raw), 'X-Signature', sign(raw)] },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      req.on('error', reject); req.end(raw);
    });
    assert.equal(duplicate, 401); assert.equal(calls, 1); assert.equal(diagnostics.length, 0);
    for (const [status, code] of [[404, 'SESSION_NOT_FOUND'], [409, 'PAYMENT_ID_REUSED'], [409, 'PAYMENT_MISMATCH'], [409, 'CHECKOUT_REQUIRED']] as const) {
      result = { status, body: { error: { code, message: 'Safe rejection.' } } };
      const response = await send(); assert.equal(response.status, status); assert.equal((await response.json()).error.code, code);
    }
    assert.equal(diagnostics.length, 0, 'business rejections do not emit unexpected-failure diagnostics');
    for (const [error, status, code] of [
      [new PaymentUnavailable(), 503, 'PAYMENT_TEMPORARILY_UNAVAILABLE'],
      [new Error('private SQL', { cause: { code: '57014' } }), 503, 'PAYMENT_TEMPORARILY_UNAVAILABLE'],
      [new Error('private SQL', { cause: { code: '42P01' } }), 500, 'INTERNAL_ERROR'],
      [new Error('private SQL', { cause: { code: '23505' } }), 500, 'INTERNAL_ERROR'],
      [Object.assign(new Error(`private ${secret} ${payload.paymentId} ${payload.parkingSessionId}`), {
        code: 'HELLO', query: 'private SQL', params: [payload, secret], signature: sign(JSON.stringify(payload)),
      }), 500, 'INTERNAL_ERROR'],
    ] as const) {
      const before: number = diagnostics.length;
      failure = error; const response = await send(); assert.equal(response.status, status);
      const data = await response.json(); assert.equal(data.error.code, code); assert.doesNotMatch(JSON.stringify(data), /private|SQL/);
      assert.equal(diagnostics.length - before, status === 500 ? 1 : 0, 'one diagnostic only for unexpected failures');
      if (status === 500) {
        assert.equal(diagnostics.at(-1)!.length, 1, 'never pass an error/stack as extra logger arguments');
        const record = JSON.parse(diagnostics.at(-1)![0] as string);
        assert.equal(record.operation, 'payment_confirmation');
        assert.match(record.correlationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        const driverCode = error.cause && (error.cause as { code?: string }).code;
        assert.equal(record.classification, driverCode ? 'database_error' : 'application_error');
        assert.deepEqual(Object.keys(record).sort(), driverCode ? ['classification', 'correlationId', 'operation', 'sqlState'] : ['classification', 'correlationId', 'operation']);
        if (driverCode) assert.equal(record.sqlState, driverCode);
        const emitted = JSON.stringify(record);
        for (const sensitive of [secret, payload.paymentId, payload.parkingSessionId, 'private', 'SQL', 'params', sign(JSON.stringify(payload))]) {
          assert.ok(!emitted.includes(sensitive), 'diagnostic excludes sensitive data');
        }
      }
    }
    assert.equal(new Set(diagnostics.map((args) => JSON.parse(args[0] as string).correlationId)).size, diagnostics.length);
  } finally { await app.close(); }
});

test('provider authentication fails closed without configured secret or raw-body capture', async () => {
  for (const [webhookSecret, rawBody] of [[undefined, true], [secret, false]] as const) {
    const app = await NestFactory.create<NestExpressApplication>({ module: TestModule, controllers: [PaymentController], providers: [
      PaymentSignatureGuard, { provide: APP_CONFIG, useValue: loadConfig({ DATABASE_URL: 'postgresql://local:local@localhost/db', WEBHOOK_SECRET: webhookSecret }) },
      { provide: PaymentService, useValue: { execute: () => assert.fail('Unauthenticated event reached processing') } },
    ] }, { logger: false, rawBody });
    configureHttp(app);
    try {
      await app.listen(0, '127.0.0.1'); const raw = JSON.stringify(payload);
      const response = await fetch(`${await app.getUrl()}/webhooks/payments`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signature': sign(raw) }, body: raw });
      assert.equal(response.status, 401);
    } finally { await app.close(); }
  }
});

test('compressed payment requests are rejected before inflation without changing check-in parsing', async () => {
  let paymentCalls = 0;
  let checkInCalls = 0;
  const config = loadConfig({ DATABASE_URL: 'postgresql://local:local@localhost/db', WEBHOOK_SECRET: secret,
    GATE_CREDENTIALS: JSON.stringify([{ id: 'entrance-1', buildingId: 'PB-AMS-9X4T', role: 'ENTRANCE', secret }]) });
  const app = await NestFactory.create<NestExpressApplication>({ module: TestModule,
    controllers: [PaymentController, CheckInController], providers: [PaymentSignatureGuard, GateAuthGuard,
      { provide: APP_CONFIG, useValue: config },
      { provide: PaymentService, useValue: { execute: async () => { paymentCalls++; return { status: 204 }; } } },
      { provide: CheckInService, useValue: { execute: async () => { checkInCalls++; return { status: 201, body: { parkingSpaceId: 51 } }; } } },
    ] }, { logger: false, rawBody: true });
  configureHttp(app);
  try {
    await app.listen(0, '127.0.0.1'); const base = await app.getUrl(); const raw = JSON.stringify(payload);
    const compressed = gzipSync(raw);
    for (const [bytes, signature] of [
      [compressed, createHmac('sha256', secret).update(compressed).digest('hex')],
      [compressed, sign(raw)],
      [Buffer.from('not a gzip stream'), sign(raw)],
      [gzipSync('x'.repeat(100000)), sign(raw)],
    ] as const) {
      const response = await fetch(`${base}/webhooks/payments`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'x-signature': signature }, body: bytes });
      assert.equal(response.status, 415); assert.equal((await response.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE');
    }
    assert.equal(paymentCalls, 0);
    const identity = await fetch(`${base}/webhooks/payments`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'identity', 'x-signature': sign(raw) }, body: raw });
    assert.equal(identity.status, 204);
    const huge = 'x'.repeat(4097);
    const limit = await fetch(`${base}/webhooks/payments`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': sign(huge) }, body: huge });
    assert.equal(limit.status, 413);
    const checkin = await fetch(`${base}/check-in`, { method: 'POST', headers: { 'content-type': 'application/json',
      'content-encoding': 'gzip', authorization: `Bearer ${secret}`, 'x-request-id': '550e8400-e29b-41d4-a716-446655440000' },
      body: gzipSync(JSON.stringify({ vehicleType: 'CAR', isResident: false, licensePlate: 'AB123C' })) });
    assert.equal(checkin.status, 201); assert.equal(checkInCalls, 1); assert.equal(paymentCalls, 1);
  } finally { await app.close(); }
});
