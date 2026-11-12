import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mapSpace } from '../src/parking/occupancy.service.js';
import { OccupancyService } from '../src/parking/occupancy.service.js';
import { OccupancyController, isTransientDatabaseFailure } from '../src/parking/occupancy.controller.js';

@Module({})
class TestModule {}

test('occupancy mapping exposes only the four approved fields and eligibility', () => {
  for (const [category, eligibleFor, vehicleTypes] of [
    ['RESIDENT', 'RESIDENT', ['CAR', 'MOTOR']], ['CAR', 'VISITOR', ['CAR']], ['MOTOR', 'VISITOR', ['MOTOR']],
  ] as const) {
    assert.deepEqual(mapSpace({ id: 1, category, occupied: true }), {
      parkingSpaceId: 1, eligibleFor, vehicleTypes, isOccupied: true,
    });
  }
  assert.throws(() => mapSpace({ id: 1, category: 'UNKNOWN', occupied: false }));
});

test('transient classification recognizes driver codes through causes, not arbitrary errors', () => {
  for (const code of ['08006', '53300', '57P01', '57014', '55P03', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT']) {
    assert.equal(isTransientDatabaseFailure(new Error('wrapped', { cause: { code } })), true);
  }
  for (const error of [{ code: '42P01' }, { code: '28P01' }, { code: '23514' }, new Error('timeout'), new TypeError('mapping')]) {
    assert.equal(isTransientDatabaseFailure(error), false);
  }
});

test('HTTP public contract, query validation and sanitized error responses', async () => {
  let error: unknown;
  let reads = 0;
  const value = Array.from({ length: 150 }, (_, i) => mapSpace({
    id: i + 1, category: i < 50 ? 'RESIDENT' : i < 130 ? 'CAR' : 'MOTOR', occupied: false,
  }));
  const app = await NestFactory.create({
    module: TestModule,
    controllers: [OccupancyController],
    providers: [{ provide: OccupancyService, useValue: { read: async () => {
      reads++;
      if (error) throw error;
      return value;
    } } }],
  }, { logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/occupancy`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await response.json(), value);
    for (const query of ['?building=other', '?x=1&x=2', '?x[y]=1', '?__proto__=x']) {
      const result = await fetch(url + query);
      assert.equal(result.status, 400);
      assert.equal((await result.json()).error.code, 'INVALID_REQUEST');
    }
    assert.equal(reads, 1, 'invalid queries never reach the database');
    for (const [failure, status, code] of [
      [new Error('SQL secret plate', { cause: { code: 'ECONNRESET' } }), 503, 'OCCUPANCY_TEMPORARILY_UNAVAILABLE'],
      [{ code: '42P01', message: 'private SQL' }, 500, 'INTERNAL_ERROR'],
      [new TypeError('private mapping data'), 500, 'INTERNAL_ERROR'],
    ] as const) {
      error = failure;
      const result = await fetch(url);
      assert.equal(result.status, status);
      const body = await result.json();
      assert.deepEqual(Object.keys(body), ['error']);
      assert.equal(body.error.code, code);
      assert.doesNotMatch(JSON.stringify(body), /SQL|secret|private|plate/);
    }
  } finally { await app.close(); }
});
