import { createHash } from 'node:crypto';

// Two-key advisory locks reserve the first integer as the gate-request namespace.
// Payment events must use a different first integer. Hash collisions only serialize.
export const GATE_REQUEST_NAMESPACE = 1;
export function gateRequestKey(building: string, operation: 'CHECK_IN' | 'CHECK_OUT', requestId: string): number {
  return createHash('sha256').update(JSON.stringify([building, operation, requestId.toLowerCase()])).digest().readInt32BE(0);
}
