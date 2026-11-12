import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, foreignKey, integer, jsonb, pgEnum, pgTable,
  primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core';

export const vehicleType = pgEnum('vehicle_type', ['CAR', 'MOTOR']);
export const spaceCategory = pgEnum('space_category', ['RESIDENT', 'CAR', 'MOTOR']);
export const sessionState = pgEnum('session_state', ['PARKED', 'AWAITING_PAYMENT', 'COMPLETED']);
export const gateOperation = pgEnum('gate_operation', ['CHECK_IN', 'CHECK_OUT']);
export const paymentStatus = pgEnum('payment_status', ['PAID', 'FAILED']);
export const paymentDisposition = pgEnum('payment_disposition', ['FAILED', 'SETTLED', 'RECONCILIATION_REQUIRED']);

export const buildings = pgTable('buildings', {
  id: text('id').primaryKey(),
  timezone: text('timezone').notNull(),
}, (t) => [check('building_identity_nonempty', sql`length(${t.id}) > 0 and length(${t.timezone}) > 0`)]);

export const spaces = pgTable('spaces', {
  buildingId: text('building_id').notNull().references(() => buildings.id),
  id: integer('id').notNull(),
  floor: integer('floor').notNull(),
  category: spaceCategory('category').notNull(),
}, (t) => [
  primaryKey({ columns: [t.buildingId, t.id] }),
  check('space_positive', sql`${t.id} > 0 and ${t.floor} > 0`),
]);

export const parkingSessions = pgTable('parking_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  buildingId: text('building_id').notNull(),
  spaceId: integer('space_id').notNull(),
  normalizedPlate: varchar('normalized_plate', { length: 16 }).notNull(),
  vehicleType: vehicleType('vehicle_type').notNull(),
  isResident: boolean('is_resident').notNull(),
  state: sessionState('state').notNull().default('PARKED'),
  checkInAt: timestamp('check_in_at', { withTimezone: true }).notNull(),
  checkoutAt: timestamp('checkout_at', { withTimezone: true }),
  durationMinutes: bigint('duration_minutes', { mode: 'number' }),
  chargeCents: bigint('charge_cents', { mode: 'number' }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  unique('session_building_identity').on(t.buildingId, t.id),
  foreignKey({ columns: [t.buildingId, t.spaceId], foreignColumns: [spaces.buildingId, spaces.id] }),
  uniqueIndex('one_active_plate_per_building').on(t.buildingId, t.normalizedPlate)
    .where(sql`${t.state} in ('PARKED', 'AWAITING_PAYMENT')`),
  uniqueIndex('one_active_allocation_per_space').on(t.buildingId, t.spaceId)
    .where(sql`${t.state} in ('PARKED', 'AWAITING_PAYMENT')`),
  check('plate_is_normalized', sql`${t.normalizedPlate} ~ '^[A-Z0-9]{1,16}$'`),
  check('session_lifecycle', sql`
    (${t.state} = 'PARKED' and ${t.checkoutAt} is null and ${t.durationMinutes} is null
      and ${t.chargeCents} is null and ${t.completedAt} is null)
    or (${t.state} in ('AWAITING_PAYMENT', 'COMPLETED')
      and ${t.checkoutAt} is not null and ${t.checkoutAt} >= ${t.checkInAt}
      and ${t.durationMinutes} is not null and ${t.durationMinutes} >= 0
      and ${t.durationMinutes} = floor(extract(epoch from (${t.checkoutAt} - ${t.checkInAt})) / 60)
      and ${t.chargeCents} is not null and ${t.chargeCents} between 0 and 9007199254740991
      and (not ${t.isResident} or ${t.chargeCents} = 0)
      and ((${t.state} = 'AWAITING_PAYMENT' and ${t.chargeCents} > 0 and ${t.completedAt} is null)
        or (${t.state} = 'COMPLETED' and ${t.completedAt} is not null and ${t.completedAt} >= ${t.checkoutAt})))
  `),
]);

export const gateRequestOutcomes = pgTable('gate_request_outcomes', {
  buildingId: text('building_id').notNull().references(() => buildings.id),
  operation: gateOperation('operation').notNull(),
  requestId: uuid('request_id').notNull(),
  canonicalPayload: jsonb('canonical_payload').notNull(),
  sessionId: uuid('session_id'),
  responseStatus: smallint('response_status').notNull(),
  responseBody: jsonb('response_body').notNull(),
}, (t) => [
  primaryKey({ columns: [t.buildingId, t.operation, t.requestId] }),
  foreignKey({ columns: [t.buildingId, t.sessionId], foreignColumns: [parkingSessions.buildingId, parkingSessions.id] }),
  check('gate_payload_objects', sql`jsonb_typeof(${t.canonicalPayload}) = 'object' and jsonb_typeof(${t.responseBody}) = 'object'`),
  check('gate_terminal_outcome', sql`
    (${t.operation} = 'CHECK_IN' and ${t.responseStatus} = 201 and ${t.sessionId} is not null)
    or (${t.operation} = 'CHECK_OUT' and ${t.responseStatus} = 200 and ${t.sessionId} is not null)
    or (${t.responseStatus} = 409 and ${t.responseBody}->'error'->>'code' is not null
      and ((${t.operation} = 'CHECK_IN' and ${t.responseBody}->'error'->>'code' in ('PARKING_FULL', 'VEHICLE_ALREADY_CHECKED_IN'))
        or (${t.operation} = 'CHECK_OUT' and ${t.responseBody}->'error'->>'code' = 'RESIDENT_STATUS_MISMATCH')))
  `),
]);

export const paymentEvents = pgTable('payment_events', {
  providerId: text('provider_id').notNull(),
  paymentId: varchar('payment_id', { length: 128 }).notNull(),
  buildingId: text('building_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  status: paymentStatus('status').notNull(),
  disposition: paymentDisposition('disposition').notNull(),
}, (t) => [
  primaryKey({ columns: [t.providerId, t.paymentId] }),
  foreignKey({ columns: [t.buildingId, t.sessionId], foreignColumns: [parkingSessions.buildingId, parkingSessions.id] }),
  uniqueIndex('one_applied_settlement_per_session').on(t.sessionId).where(sql`${t.disposition} = 'SETTLED'`),
  check('payment_values', sql`length(${t.providerId}) > 0 and length(${t.paymentId}) > 0
    and ${t.amountCents} between 0 and 9007199254740991 and ${t.currency} ~ '^[A-Z]{3}$'`),
  check('payment_disposition_matches_status', sql`
    (${t.status} = 'FAILED' and ${t.disposition} = 'FAILED')
    or (${t.status} = 'PAID' and ${t.disposition} = 'RECONCILIATION_REQUIRED')
    or (${t.status} = 'PAID' and ${t.disposition} = 'SETTLED' and ${t.currency} = 'EUR' and ${t.amountCents} > 0)
  `),
]);
