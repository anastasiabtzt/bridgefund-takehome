import { canonicalUuid } from '../uuid.js';

export interface PaymentPayload {
  paymentId: string;
  parkingSessionId: string;
  amount: { value: number; currency: string };
  status: 'PAID' | 'FAILED';
}
export function canonicalPayment(value: unknown): PaymentPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid payment.');
  const body = value as Record<string, unknown>;
  const amount = body.amount as Record<string, unknown> | null;
  if (Object.keys(body).sort().join(',') !== 'amount,parkingSessionId,paymentId,status'
    || typeof body.paymentId !== 'string' || body.paymentId.length < 1 || [...body.paymentId].length > 128
    || [...body.paymentId].some((character) => {
      const code = character.codePointAt(0)!;
      return code === 0 || (code >= 0xD800 && code <= 0xDFFF);
    })
    || typeof body.parkingSessionId !== 'string' || !['PAID', 'FAILED'].includes(body.status as string)
    || !amount || typeof amount !== 'object' || Array.isArray(amount)
    || Object.keys(amount).sort().join(',') !== 'currency,value'
    || typeof amount.value !== 'number' || !Number.isSafeInteger(amount.value) || amount.value < 0
    || typeof amount.currency !== 'string' || !/^[A-Z]{3}$/.test(amount.currency)) throw new Error('Invalid payment.');
  return { paymentId: body.paymentId, parkingSessionId: canonicalUuid(body.parkingSessionId),
    amount: { value: amount.value, currency: amount.currency }, status: body.status as 'PAID' | 'FAILED' };
}
export function samePayment(value: { sessionId: string; amountCents: number; currency: string; status: string }, payload: PaymentPayload): boolean {
  return value.sessionId === payload.parkingSessionId && value.amountCents === payload.amount.value
    && value.currency === payload.amount.currency && value.status === payload.status;
}
