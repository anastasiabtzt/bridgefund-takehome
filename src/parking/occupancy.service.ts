import { Inject, Injectable } from '@nestjs/common';
import { and, eq, exists, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { parkingSessions, spaces } from '../database/schema.js';

export interface OccupancySpace {
  parkingSpaceId: number;
  eligibleFor: 'RESIDENT' | 'VISITOR';
  vehicleTypes: ('CAR' | 'MOTOR')[];
  isOccupied: boolean;
}

export function mapSpace(row: { id: number; category: string; occupied: boolean }): OccupancySpace {
  if (!['RESIDENT', 'CAR', 'MOTOR'].includes(row.category)) throw new Error('Unexpected space category.');
  return {
    parkingSpaceId: row.id,
    eligibleFor: row.category === 'RESIDENT' ? 'RESIDENT' : 'VISITOR',
    vehicleTypes: row.category === 'RESIDENT' ? ['CAR', 'MOTOR'] : [row.category as 'CAR' | 'MOTOR'],
    isOccupied: row.occupied,
  };
}

@Injectable()
export class OccupancyService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async read(): Promise<OccupancySpace[]> {
    // One statement gives one MVCC snapshot, without allocation/session locks.
    const rows = await this.database.db.select({
      id: spaces.id,
      category: spaces.category,
      occupied: sql<boolean>`${exists(this.database.db.select({ one: sql`1` }).from(parkingSessions).where(and(
        eq(parkingSessions.buildingId, spaces.buildingId),
        eq(parkingSessions.spaceId, spaces.id),
        inArray(parkingSessions.state, ['PARKED', 'AWAITING_PAYMENT']),
      )))}`,
    }).from(spaces).where(eq(spaces.buildingId, 'PB-AMS-9X4T')).orderBy(spaces.id);
    return rows.map(mapSpace);
  }
}
