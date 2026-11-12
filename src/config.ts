export const APP_CONFIG = Symbol('APP_CONFIG');

export interface GateCredential {
  id: string;
  buildingId: string;
  role: 'ENTRANCE' | 'EXIT';
  secret: string;
}

export interface AppConfig {
  gates: GateCredential[];
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

function gateCredentials(raw: string | undefined): GateCredential[] {
  if (raw === undefined) return []; // No configured credential means check-in is inaccessible.
  try {
    const gates: unknown = JSON.parse(raw);
    if (!Array.isArray(gates) || gates.some((gate) => !gate || typeof gate !== 'object'
      || Object.keys(gate).sort().join(',') !== 'buildingId,id,role,secret'
      || typeof gate.id !== 'string' || !gate.id.length
      || gate.buildingId !== 'PB-AMS-9X4T' || !['ENTRANCE', 'EXIT'].includes(gate.role)
      || typeof gate.secret !== 'string' || !/^[!-~]{32,256}$/.test(gate.secret))
      || new Set(gates.map((gate) => gate.id)).size !== gates.length
      || new Set(gates.map((gate) => gate.secret)).size !== gates.length) throw new Error();
    return gates;
  } catch {
    throw new Error('Configuration error: GATE_CREDENTIALS must contain unique pilot gate identities, roles and secrets of 32–256 printable ASCII characters.');
  }
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
    gates: gateCredentials(env.GATE_CREDENTIALS),
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
