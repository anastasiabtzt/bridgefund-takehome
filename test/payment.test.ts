import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { canonicalPayment, samePayment } from '../src/payments/payment.rules.js';
import { validPaymentSignature } from '../src/payments/payment-signature.guard.js';

const secret = 'test-provider-secret-01234567890123456789';
const id = 'ABCDEFAB-1234-1234-1234-123456789ABC';
const payload = { paymentId: 'pay-1', parkingSessionId: id, amount: { value: 1000, currency: 'EUR' }, status: 'PAID' };

test('payment HMAC binds exact bytes, whitespace and trailing newline and fails closed', () => {
  const raw = Buffer.from(JSON.stringify(payload, null, 2) + '\n');
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(validPaymentSignature(secret, raw, [signature]), true);
  for (const [configured, body, signatures] of [
    [undefined, raw, [signature]], ['', raw, [signature]], [secret, undefined, [signature]],
    [secret, raw.toString(), [signature]], [secret, raw, []], [secret, raw, [signature, signature]],
    [secret, raw, [signature.toUpperCase()]], [secret, raw, ['bad']], [secret, raw, ['0'.repeat(64)]],
    [secret, Buffer.from(JSON.stringify(payload)), [signature]], [secret, Buffer.from(raw.toString().replace('1000', '1001')), [signature]],
  ] as const) assert.equal(validPaymentSignature(configured, body, [...signatures]), false);
});

test('payment validation is strict, canonical and preserves the complete accepted binding', () => {
  const canonical = canonicalPayment(payload);
  assert.deepEqual(canonical, { ...payload, parkingSessionId: id.toLowerCase() });
  const stored = { sessionId: canonical.parkingSessionId, amountCents: 1000, currency: 'EUR', status: 'PAID' };
  assert.equal(samePayment(stored, canonical), true);
  for (const delta of [{ sessionId: 'other' }, { amountCents: 999 }, { currency: 'USD' }, { status: 'FAILED' }]) {
    assert.equal(samePayment({ ...stored, ...delta }, canonical), false);
  }
  for (const invalid of [null, [], {}, { ...payload, extra: 1 }, { ...payload, paymentId: '' },
    { ...payload, paymentId: 'x'.repeat(129) }, { ...payload, parkingSessionId: 'bad' },
    { ...payload, status: 'paid' }, { ...payload, amount: { value: -1, currency: 'EUR' } },
    { ...payload, amount: { value: 1.5, currency: 'EUR' } }, { ...payload, amount: { value: '1000', currency: 'EUR' } },
    { ...payload, amount: { value: Number.MAX_SAFE_INTEGER + 1, currency: 'EUR' } },
    { ...payload, amount: { value: 1000, currency: 'eur' } }, { ...payload, amount: { value: 1000, currency: 'EURO' } },
    { ...payload, amount: { value: 1000, currency: 'EUR', extra: true } }]) assert.throws(() => canonicalPayment(invalid));
  assert.equal(canonicalPayment({ ...payload, status: 'FAILED', amount: { value: 0, currency: 'USD' } }).amount.currency, 'USD');
});

test('payment identifiers reject malformed Unicode/NUL and preserve valid supplementary characters', () => {
  for (const paymentId of ['pay-\ud800', 'pay-\udc00', 'pay-\ud800X', 'pay-X\udc00', 'pay-\u0000']) {
    assert.throws(() => canonicalPayment({ ...payload, paymentId }));
  }
  for (const paymentId of ['pay-🚗-é', 'pay-e\u0301', '🚗'.repeat(128)]) {
    assert.equal(canonicalPayment({ ...payload, paymentId }).paymentId, paymentId);
  }
  assert.throws(() => canonicalPayment({ ...payload, paymentId: '🚗'.repeat(129) }));
});
