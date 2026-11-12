import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DatabaseService } from './database.service.js';
import { loadConfig } from '../config.js';

// SQL migrations are checked in and reviewed; do not use schema push at startup.
export async function migrateDatabase(database: DatabaseService): Promise<void> {
  await migrate(database.db, { migrationsFolder: resolve('drizzle') });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const database = new DatabaseService(loadConfig());
  try {
    await migrateDatabase(database);
    console.log('Database migrations applied.');
  } finally {
    await database.onModuleDestroy();
  }
}
