import { DatabaseService } from '../../src/database/database.service.js';
import { loadConfig } from '../../src/config.js';

export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required; integration tests never silently skip.');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || url.pathname !== '/parkingbusiness_test' || decodeURIComponent(url.username) !== 'parkingbusiness_test'
    || url.search || url.hash) {
    throw new Error('Refusing test database: require parkingbusiness_test database/user and no URL parameters.');
  }
  if (env.DATABASE_URL) {
    const dev = new URL(env.DATABASE_URL);
    if (dev.hostname === url.hostname && (dev.port || '5432') === (url.port || '5432') && dev.pathname === url.pathname) {
      throw new Error('Refusing test database: it resolves to the configured development database.');
    }
  }
  return value;
}

export async function openTestDatabase(): Promise<DatabaseService> {
  const database = new DatabaseService(loadConfig({ ...process.env, DATABASE_URL: testDatabaseUrl() }));
  try {
    // Verify the server's identity, not only the supplied connection string.
    const result = await database.pool.query<{ database: string; role: string }>(
      'select current_database() as database, current_user as role',
    );
    if (result.rows[0].database !== 'parkingbusiness_test' || result.rows[0].role !== 'parkingbusiness_test') {
      throw new Error('Refusing test database: live database/user is not parkingbusiness_test.');
    }
    return database;
  } catch (error) {
    await database.onModuleDestroy();
    throw error;
  }
}
