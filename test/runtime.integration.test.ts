import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Inject, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, AppConfig, loadConfig } from '../src/config.js';
import { Clock, SystemClock } from '../src/clock.js';
import { DatabaseService } from '../src/database/database.service.js';
import { OccupancyService } from '../src/parking/occupancy.service.js';
import { RuntimeModule } from '../src/runtime.module.js';
import { openTestDatabase, testDatabaseUrl } from './support/test-database.js';
import type { DynamicModule } from '@nestjs/common';

@Injectable()
class ParkingProbe {
  constructor(
    @Inject(Clock) readonly clock: Clock,
    @Inject(SystemClock) readonly systemClock: SystemClock,
    @Inject(DatabaseService) readonly database: DatabaseService,
    @Inject(APP_CONFIG) readonly config: AppConfig,
  ) {}
}
@Injectable()
class SiblingProbe extends ParkingProbe {}
@Module({})
class SiblingModule {}

test('configured runtime is shared across feature modules and Clock is visible inside Parking', async () => {
  // Guard and verify the disposable database before initializing the Nest pool.
  const guard = await openTestDatabase();
  await guard.onModuleDestroy();
  const config = loadConfig({ ...process.env, DATABASE_URL: testDatabaseUrl() });
  const root = AppModule.register(config);
  const parking = root.imports![0] as DynamicModule;
  const runtime = parking.imports![0] as DynamicModule;
  assert.equal(runtime.module, RuntimeModule);
  // Test-only consumers in the actual Parking scope and a sibling feature scope.
  parking.providers = [...parking.providers!, ParkingProbe];
  const sibling = { module: SiblingModule, imports: [runtime], providers: [SiblingProbe] };
  root.imports!.push(sibling);
  const app = await NestFactory.createApplicationContext(root, { logger: false });
  let database: DatabaseService | undefined;
  try {
    const parkingScope = app.select(parking);
    const siblingScope = app.select(sibling);
    const first = parkingScope.get(ParkingProbe, { strict: true });
    const second = siblingScope.get(SiblingProbe, { strict: true });
    database = first.database;
    assert.ok(parkingScope.get(OccupancyService, { strict: true }));
    assert.equal(first.config, config);
    assert.equal(second.config, config);
    assert.equal(first.database, second.database);
    assert.equal(first.database.pool, second.database.pool);
    assert.equal(first.clock, second.clock);
    assert.equal(first.clock, first.systemClock);
    assert.ok(first.clock.now() instanceof Date);
    assert.equal((await first.database.pool.query('select 1 as connected')).rows[0].connected, 1);
    const providers = app.get(DatabaseService, { each: true });
    assert.equal(providers.length, 1, 'only one DatabaseService registration exists');
    assert.equal(providers[0], first.database);
  } finally { await app.close(); }
  assert.equal(database?.pool.ended, true, 'application shutdown closes the shared pool');
});
