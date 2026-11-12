export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  databaseUrl: string;
  port: number;
  poolMax: number;
  connectionTimeoutMs: number;
  poolIdleTimeoutMs: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  idleTransactionTimeoutMs: number;
}

type Environment = Record<string, string | undefined>;

function integer(env: Environment, name: string, fallback: number, max: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) {
    throw new Error(`Configuration error: ${name} must be an integer between 1 and ${max}.`);
  }
  return Number(raw);
}

export function loadConfig(env: Environment = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Configuration error: DATABASE_URL is required.');
  try {
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
      throw new Error('Invalid connection URL');
    }
  } catch {
    throw new Error('Configuration error: DATABASE_URL must be a PostgreSQL URL with a host and database name.');
  }

  const config: AppConfig = {
    databaseUrl,
    port: integer(env, 'PORT', 3000, 65535),
    poolMax: integer(env, 'DB_POOL_MAX', 5, 100),
    connectionTimeoutMs: integer(env, 'DB_CONNECTION_TIMEOUT_MS', 250, 60000),
    poolIdleTimeoutMs: integer(env, 'DB_POOL_IDLE_TIMEOUT_MS', 10000, 600000),
    statementTimeoutMs: integer(env, 'DB_STATEMENT_TIMEOUT_MS', 1000, 60000),
    lockTimeoutMs: integer(env, 'DB_LOCK_TIMEOUT_MS', 250, 60000),
    idleTransactionTimeoutMs: integer(env, 'DB_IDLE_TRANSACTION_TIMEOUT_MS', 1000, 60000),
  };
  if (config.lockTimeoutMs >= config.statementTimeoutMs) {
    throw new Error('Configuration error: DB_LOCK_TIMEOUT_MS must be less than DB_STATEMENT_TIMEOUT_MS.');
  }
  return config;
}
