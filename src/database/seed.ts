import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { DatabaseService } from './database.service.js';
import { loadConfig } from '../config.js';
import { buildings, spaces } from './schema.js';

export async function seedPilot(database: DatabaseService): Promise<void> {
  const expectedSpaces = Array.from({ length: 150 }, (_, index) => {
    const id = index + 1;
    return {
      buildingId: 'PB-AMS-9X4T', id, floor: id <= 75 ? 1 : 2,
      // Category encodes vehicle eligibility: resident CAR/MOTOR, visitor CAR or MOTOR.
      category: id <= 50 ? 'RESIDENT' as const : id <= 130 ? 'CAR' as const : 'MOTOR' as const,
    };
  });
  await database.db.transaction(async (tx) => {
    await tx.insert(buildings).values({ id: 'PB-AMS-9X4T', timezone: 'Europe/Amsterdam' }).onConflictDoNothing();
    const [building] = await tx.select().from(buildings)
      .where(eq(buildings.id, 'PB-AMS-9X4T')).for('update');
    await tx.insert(spaces).values(expectedSpaces).onConflictDoNothing();
    const actualSpaces = await tx.select().from(spaces)
      .where(eq(spaces.buildingId, 'PB-AMS-9X4T')).orderBy(spaces.id).for('update');
    if (building.timezone !== 'Europe/Amsterdam') {
      throw new Error('Pilot seed validation failed: building timezone differs from expected configuration.');
    }
    if (actualSpaces.length !== expectedSpaces.length || actualSpaces.some((space, index) => {
      const expected = expectedSpaces[index];
      return space.id !== expected.id || space.floor !== expected.floor || space.category !== expected.category;
    })) {
      throw new Error('Pilot seed validation failed: space IDs, floors or vehicle eligibility differ from expected configuration.');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const database = new DatabaseService(loadConfig());
  try {
    await seedPilot(database);
    console.log('Pilot seed applied without overwriting existing records.');
  } finally {
    await database.onModuleDestroy();
  }
}
