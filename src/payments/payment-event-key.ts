import { createHash } from 'node:crypto';

export const PILOT_PROVIDER_ID = 'pilot';
export const PAYMENT_EVENT_NAMESPACE = 2; // Gate requests reserve namespace 1.
export function paymentEventKey(providerId: string, paymentId: string): number {
  return createHash('sha256').update(JSON.stringify([providerId, paymentId])).digest().readInt32BE(0);
}
