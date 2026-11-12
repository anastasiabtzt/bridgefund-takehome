import { Inject, Injectable } from '@nestjs/common';
import { and, asc, between, eq, inArray, notExists, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Clock } from '../clock.js';
import { DatabaseService } from '../database/database.service.js';
import { buildings, gateRequestOutcomes, parkingSessions, spaces } from '../database/schema.js';
import { CheckInPayload, eligibleRange, samePayload } from './check-in.rules.js';
import { gateRequestKey, GATE_REQUEST_NAMESPACE } from './gate-request-key.js';

export interface CheckInOutcome { status: number; body: unknown }
export class CheckInUnavailable extends Error {}
const rejection = (code: string, message: string): CheckInOutcome => ({ status: 409, body: { error: { code, message } } });

@Injectable()
export class CheckInService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(Clock) private readonly clock: Clock) {}

  async execute(buildingId: string, requestId: string, payload: CheckInPayload): Promise<CheckInOutcome> {
    const client = await this.database.pool.connect().catch((error: unknown) => {
      // pg-pool's acquisition timeout has no driver code. Restrict this to acquisition.
      if (error instanceof Error && ['timeout exceeded when trying to connect', 'Connection terminated due to connection timeout'].includes(error.message)) {
        throw new CheckInUnavailable();
      }
      throw error;
    });
    try {
      return await drizzle(client).transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${GATE_REQUEST_NAMESPACE}::integer, ${gateRequestKey(buildingId, 'CHECK_IN', requestId)}::integer)`);
        const identity = and(eq(gateRequestOutcomes.buildingId, buildingId), eq(gateRequestOutcomes.operation, 'CHECK_IN'), eq(gateRequestOutcomes.requestId, requestId));
        const [existing] = await tx.select().from(gateRequestOutcomes).where(identity);
        if (existing) return samePayload(existing.canonicalPayload, payload)
          ? { status: existing.responseStatus, body: existing.responseBody }
          : rejection('IDEMPOTENCY_KEY_REUSED', 'Request ID is bound to a different request.');

        const [building] = await tx.select({ id: buildings.id }).from(buildings).where(eq(buildings.id, buildingId)).for('update');
        if (!building) throw new Error('Pilot building is not seeded.');
        const [active] = await tx.select({ id: parkingSessions.id }).from(parkingSessions).where(and(
          eq(parkingSessions.buildingId, buildingId), eq(parkingSessions.normalizedPlate, payload.normalizedLicensePlate),
          inArray(parkingSessions.state, ['PARKED', 'AWAITING_PAYMENT']),
        )).limit(1);
        let outcome: CheckInOutcome;
        let sessionId: string | undefined;
        if (active) {
          outcome = rejection('VEHICLE_ALREADY_CHECKED_IN', 'Vehicle already has an active parking session.');
        } else {
          const [low, high] = eligibleRange(payload);
          const [space] = await tx.select({ id: spaces.id }).from(spaces).where(and(
            eq(spaces.buildingId, buildingId), between(spaces.id, low, high),
            notExists(tx.select({ one: sql`1` }).from(parkingSessions).where(and(
              eq(parkingSessions.buildingId, spaces.buildingId), eq(parkingSessions.spaceId, spaces.id),
              inArray(parkingSessions.state, ['PARKED', 'AWAITING_PAYMENT']),
            ))),
          )).orderBy(asc(spaces.id)).limit(1);
          if (!space) outcome = rejection('PARKING_FULL', 'No eligible space is available.');
          else {
            const [session] = await tx.insert(parkingSessions).values({
              buildingId, spaceId: space.id, normalizedPlate: payload.normalizedLicensePlate,
              vehicleType: payload.vehicleType, isResident: payload.isResident, checkInAt: this.clock.now(),
            }).onConflictDoNothing({ target: [parkingSessions.buildingId, parkingSessions.normalizedPlate],
              where: sql`${parkingSessions.state} in ('PARKED', 'AWAITING_PAYMENT')` }).returning({ id: parkingSessions.id });
            // Only the active-plate index is handled. Other constraint failures abort.
            if (!session) outcome = rejection('VEHICLE_ALREADY_CHECKED_IN', 'Vehicle already has an active parking session.');
            else {
              sessionId = session.id;
              outcome = { status: 201, body: { parkingSessionId: session.id, parkingSpaceId: space.id } };
            }
          }
        }
        await tx.insert(gateRequestOutcomes).values({ buildingId, operation: 'CHECK_IN', requestId,
          canonicalPayload: payload, sessionId, responseStatus: outcome.status, responseBody: outcome.body });
        return outcome;
      }, { isolationLevel: 'read committed' });
    } finally { client.release(); }
  }
}
