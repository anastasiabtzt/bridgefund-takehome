import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { calculateCharge } from '../billing/calculate-charge.js';
import { Clock } from '../clock.js';
import { DatabaseService } from '../database/database.service.js';
import { buildings, gateRequestOutcomes, parkingSessions } from '../database/schema.js';
import { CheckOutPayload, sameCheckoutPayload } from './check-out.rules.js';
import { gateRequestKey, GATE_REQUEST_NAMESPACE } from './gate-request-key.js';

export interface CheckOutOutcome { status: number; body: unknown }
export class CheckOutUnavailable extends Error {}
export class ClockInconsistency extends Error {}
const errorOutcome = (status: number, code: string, message: string): CheckOutOutcome => ({ status, body: { error: { code, message } } });

@Injectable()
export class CheckOutService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(Clock) private readonly clock: Clock) {}

  async execute(buildingId: string, requestId: string, payload: CheckOutPayload): Promise<CheckOutOutcome> {
    const client = await this.database.pool.connect().catch((error: unknown) => {
      if (error instanceof Error && ['timeout exceeded when trying to connect', 'Connection terminated due to connection timeout'].includes(error.message)) {
        throw new CheckOutUnavailable();
      }
      throw error;
    });
    try {
      return await drizzle(client).transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${GATE_REQUEST_NAMESPACE}::integer, ${gateRequestKey(buildingId, 'CHECK_OUT', requestId)}::integer)`);
        const [existing] = await tx.select().from(gateRequestOutcomes).where(and(
          eq(gateRequestOutcomes.buildingId, buildingId), eq(gateRequestOutcomes.operation, 'CHECK_OUT'), eq(gateRequestOutcomes.requestId, requestId),
        ));
        if (existing) return sameCheckoutPayload(existing.canonicalPayload, payload)
          ? { status: existing.responseStatus, body: existing.responseBody }
          : errorOutcome(409, 'IDEMPOTENCY_KEY_REUSED', 'Request ID is bound to a different request.');

        const scope = and(eq(parkingSessions.buildingId, buildingId), eq(parkingSessions.id, payload.parkingSessionId));
        // Identification/access only; state is authoritative only after both locks.
        const [identified] = await tx.select({ id: parkingSessions.id }).from(parkingSessions).where(scope);
        if (!identified) return errorOutcome(404, 'SESSION_NOT_FOUND', 'Parking session was not found.');
        const [building] = await tx.select({ id: buildings.id }).from(buildings).where(eq(buildings.id, buildingId)).for('update');
        if (!building) throw new Error('Pilot building is not seeded.');
        const [session] = await tx.select().from(parkingSessions).where(scope).for('update');
        if (!session) return errorOutcome(404, 'SESSION_NOT_FOUND', 'Parking session was not found.');

        let outcome: CheckOutOutcome;
        if (session.isResident !== payload.isResident) {
          outcome = errorOutcome(409, 'RESIDENT_STATUS_MISMATCH', 'Resident status does not match the parking session.');
        } else {
          let minutes = session.durationMinutes;
          let cents = session.chargeCents;
          if (session.state === 'PARKED') {
            const checkoutAt = this.clock.now();
            if (!Number.isFinite(checkoutAt.getTime()) || checkoutAt < session.checkInAt) throw new ClockInconsistency();
            minutes = Math.floor((checkoutAt.getTime() - session.checkInAt.getTime()) / 60000);
            cents = calculateCharge(session.checkInAt, checkoutAt, session.vehicleType, session.isResident);
            await tx.update(parkingSessions).set({ checkoutAt, durationMinutes: minutes, chargeCents: cents,
              state: cents === 0 ? 'COMPLETED' : 'AWAITING_PAYMENT', completedAt: cents === 0 ? checkoutAt : null }).where(scope);
          }
          if (minutes === null || cents === null) throw new Error('Frozen checkout data is missing.');
          outcome = { status: 200, body: { parkingSpaceId: session.spaceId, sessionLengthInMinutes: minutes,
            amountDue: { value: cents, currency: 'EUR' } } };
        }
        await tx.insert(gateRequestOutcomes).values({ buildingId, operation: 'CHECK_OUT', requestId,
          canonicalPayload: payload, sessionId: session.id, responseStatus: outcome.status, responseBody: outcome.body });
        return outcome;
      }, { isolationLevel: 'read committed' });
    } finally { client.release(); }
  }
}
