import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { buildings, parkingSessions } from '../database/schema.js';

type PaymentTransaction = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
interface PaymentSession {
  id: string;
  buildingId: string;
  state: 'PARKED' | 'AWAITING_PAYMENT' | 'COMPLETED';
  checkoutAt: Date | null;
  chargeCents: number | null;
}

@Injectable()
export class PaymentSettlementService {
  async lockSession(tx: PaymentTransaction, sessionId: string): Promise<PaymentSession | undefined> {
    // Identification only; use a fresh locked read for authoritative business state.
    const [identified] = await tx.select({ buildingId: parkingSessions.buildingId }).from(parkingSessions).where(eq(parkingSessions.id, sessionId));
    if (!identified) return undefined;
    await tx.select({ id: buildings.id }).from(buildings).where(eq(buildings.id, identified.buildingId)).for('update');
    const [session] = await tx.select({ id: parkingSessions.id, buildingId: parkingSessions.buildingId,
      state: parkingSessions.state, checkoutAt: parkingSessions.checkoutAt, chargeCents: parkingSessions.chargeCents })
      .from(parkingSessions).where(and(eq(parkingSessions.buildingId, identified.buildingId), eq(parkingSessions.id, sessionId))).for('update');
    return session;
  }

  async complete(tx: PaymentTransaction, session: PaymentSession, completedAt: Date): Promise<void> {
    if (session.state !== 'AWAITING_PAYMENT' || !session.checkoutAt || !Number.isFinite(completedAt.getTime()) || completedAt < session.checkoutAt) {
      throw new Error('Invalid settlement completion.');
    }
    const changed = await tx.update(parkingSessions).set({ state: 'COMPLETED', completedAt }).where(and(
      eq(parkingSessions.buildingId, session.buildingId), eq(parkingSessions.id, session.id), eq(parkingSessions.state, 'AWAITING_PAYMENT'),
    )).returning({ id: parkingSessions.id });
    if (changed.length !== 1) throw new Error('Settlement session state changed unexpectedly.');
  }
}
