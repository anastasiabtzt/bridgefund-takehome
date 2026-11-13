import { randomUUID } from 'node:crypto';

export function paymentFailureDiagnostic(error: unknown): {
  operation: 'payment_confirmation'; correlationId: string;
  classification: 'database_error' | 'application_error'; sqlState?: string;
} {
  const seen = new Set<unknown>();
  let sqlState: string | undefined;
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error);
    const { code, cause } = error as { code?: unknown; cause?: unknown };
    // Known PostgreSQL error classes only; never emit an arbitrary error code/name.
    if (typeof code === 'string' && /^(?:0[89ABFLPZ]|2[0-8BDF]|3[489BDF]|4[024]|5[34578]|72|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(code)) {
      sqlState = code;
      break;
    }
    error = cause;
  }
  return { operation: 'payment_confirmation', correlationId: randomUUID(),
    classification: sqlState ? 'database_error' : 'application_error', ...(sqlState ? { sqlState } : {}) };
}
