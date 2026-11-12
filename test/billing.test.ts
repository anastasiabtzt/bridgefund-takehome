import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateCharge } from '../src/billing/calculate-charge.js';

const cases: [string, string, string, 'CAR' | 'MOTOR', boolean, number][] = [
  ['resident CAR', '2026-11-12T08:00:00Z', '2026-11-15T08:00:00Z', 'CAR', true, 0],
  ['resident MOTOR', '2026-11-12T08:00:00Z', '2026-11-15T08:00:00Z', 'MOTOR', true, 0],
  ['zero interval', '2026-11-12T08:00:00Z', '2026-11-12T08:00:00Z', 'CAR', false, 0],
  ['CAR exact hour', '2026-11-12T08:00:00Z', '2026-11-12T09:00:00Z', 'CAR', false, 500],
  ['CAR hour plus millisecond', '2026-11-12T08:00:00Z', '2026-11-12T09:00:00.001Z', 'CAR', false, 1000],
  ['70-minute CAR', '2026-11-12T08:00:00Z', '2026-11-12T09:10:00Z', 'CAR', false, 1000],
  ['MOTOR exact hour', '2026-11-12T08:00:00Z', '2026-11-12T09:00:00Z', 'MOTOR', false, 300],
  ['MOTOR started hour', '2026-11-12T08:00:00Z', '2026-11-12T09:00:00.001Z', 'MOTOR', false, 600],
  ['CAR daily cap', '2026-11-12T00:00:00Z', '2026-11-12T22:00:00Z', 'CAR', false, 3000],
  ['MOTOR daily cap', '2026-11-12T00:00:00Z', '2026-11-12T22:00:00Z', 'MOTOR', false, 1800],
  ['local midnight crossing', '2026-11-12T22:30:00Z', '2026-11-12T23:30:00Z', 'CAR', false, 1000],
  ['checkout at midnight', '2026-11-12T22:30:00Z', '2026-11-12T23:00:00Z', 'CAR', false, 500],
  ['summer midnight crossing', '2026-07-12T21:30:00Z', '2026-07-12T22:30:00Z', 'CAR', false, 1000],
  ['three local days and independent caps', '2026-11-12T22:30:00Z', '2026-11-14T00:30:00Z', 'CAR', false, 4500],
  ['spring-forward elapsed hour', '2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', 'CAR', false, 500],
  ['fall-back elapsed hour', '2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', 'CAR', false, 500],
  ['spring midnight to midnight', '2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z', 'CAR', false, 3000],
  ['fall midnight to midnight', '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z', 'MOTOR', false, 1800],
];
for (const [name, start, end, vehicle, resident, cents] of cases) {
  test(`billing: ${name}`, () => assert.equal(calculateCharge(new Date(start), new Date(end), vehicle, resident), cents));
}

test('billing rejects invalid or backwards instants rather than producing money', () => {
  assert.throws(() => calculateCharge(new Date('invalid'), new Date(), 'CAR', false));
  assert.throws(() => calculateCharge(new Date('2026-11-12T09:00Z'), new Date('2026-11-12T08:00Z'), 'CAR', false));
});
