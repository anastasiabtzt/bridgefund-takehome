import { DynamicModule, Module } from '@nestjs/common';
import { OccupancyController } from './occupancy.controller.js';
import { OccupancyService } from './occupancy.service.js';

@Module({})
export class ParkingModule {
  static register(runtime: DynamicModule): DynamicModule {
    return {
      module: ParkingModule,
      imports: [runtime],
      controllers: [OccupancyController],
      providers: [OccupancyService],
    };
  }
}