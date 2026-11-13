import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Clock } from '../clock.js';
import { DatabaseService } from '../database/database.service.js';
import { paymentEvents } from '../database/schema.js';
import { PaymentSettlementService } from '../parking/payment-settlement.service.js';
import { PaymentPayload, samePayment } from './payment.rules.js';
import { paymentEventKey, PAYMENT_EVENT_NAMESPACE, PILOT_PROVIDER_ID } from './payment-event-key.js';

export class PaymentUnavailable extends Error {}
export interface PaymentResult { status: number; body?: { error: { code: string; message: string } } }
const failure = (status: number, code: string, message: string): PaymentResult => ({ status, body: { error: { code, message } } });

@Injectable()
export class PaymentService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PaymentSettlementService) private readonly parking: PaymentSettlementService,
    @Inject(Clock) private readonly clock: Clock) {}

  async execute(payload: PaymentPayload): Promise<PaymentResult> {
    const client = await this.database.pool.connect().catch((error: unknown) => {
      if (error instanceof Error && ['timeout exceeded when trying to connect', 'Connection terminated due to connection timeout'].includes(error.message)) throw new PaymentUnavailable();
      throw error;
    });
    try {
      return await drizzle(client).transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${PAYMENT_EVENT_NAMESPACE}::integer, ${paymentEventKey(PILOT_PROVIDER_ID, payload.paymentId)}::integer)`);
        const [existing] = await tx.select().from(paymentEvents).where(and(
          eq(paymentEvents.providerId, PILOT_PROVIDER_ID), eq(paymentEvents.paymentId, payload.paymentId),
        ));
        if (existing) return samePayment(existing, payload) ? { status: 204 }
          : failure(409, 'PAYMENT_ID_REUSED', 'Payment ID is bound to a different event.');
        const session = await this.parking.lockSession(tx, payload.parkingSessionId);
        if (!session) return failure(404, 'SESSION_NOT_FOUND', 'Parking session was not found.');
        if (session.state === 'PARKED') return failure(409, 'CHECKOUT_REQUIRED', 'Checkout is required before accepting payment events.');

        let disposition: 'FAILED' | 'SETTLED' | 'RECONCILIATION_REQUIRED';
        if (payload.status === 'FAILED') disposition = 'FAILED';
        else if (session.state === 'COMPLETED') disposition = 'RECONCILIATION_REQUIRED';
        else {
          if (payload.amount.currency !== 'EUR' || payload.amount.value !== session.chargeCents) {
            return failure(409, 'PAYMENT_MISMATCH', 'Payment does not match the frozen charge.');
          }
          // All locks and business checks precede this single actual-settlement sample.
          const completedAt = this.clock.now();
          await this.parking.complete(tx, session, completedAt);
          disposition = 'SETTLED';
        }
        await tx.insert(paymentEvents).values({ providerId: PILOT_PROVIDER_ID, paymentId: payload.paymentId,
          buildingId: session.buildingId, sessionId: session.id, amountCents: payload.amount.value,
          currency: payload.amount.currency, status: payload.status, disposition });
        return { status: 204 };
      }, { isolationLevel: 'read committed' });
    } finally { client.release(); }
  }
}
