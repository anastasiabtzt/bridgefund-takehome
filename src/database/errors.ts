// Drizzle wraps driver errors in cause; inspect codes, never error-message text.
export function isTransientDatabaseFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error);
    const { code, cause } = error as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && (
      /^08[0-9A-Z]{3}$/.test(code)
      || ['53300', '57P01', '57P02', '57P03', '57014', '55P03',
        'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'].includes(code)
    )) return true;
    error = cause;
  }
  return false;
}
