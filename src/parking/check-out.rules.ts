import { canonicalRequestId } from './check-in.rules.js';

export interface CheckOutPayload { parkingSessionId: string; isResident: boolean }
export function canonicalCheckOut(value: unknown): CheckOutPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request.');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join(',') !== 'isResident,parkingSessionId'
    || typeof body.parkingSessionId !== 'string' || typeof body.isResident !== 'boolean') throw new Error('Invalid request.');
  return { parkingSessionId: canonicalRequestId(body.parkingSessionId), isResident: body.isResident };
}
export function sameCheckoutPayload(value: unknown, payload: CheckOutPayload): boolean {
  if (!value || typeof value !== 'object') return false;
  const original = value as CheckOutPayload;
  return original.parkingSessionId === payload.parkingSessionId && original.isResident === payload.isResident;
}
