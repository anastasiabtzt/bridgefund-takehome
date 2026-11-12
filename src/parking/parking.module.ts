import { DynamicModule, Module } from '@nestjs/common';
import { CheckInController } from './check-in.controller.js';
import { CheckInService } from './check-in.service.js';
import { GateAuthGuard } from './gate-auth.guard.js';
import { OccupancyController } from './occupancy.controller.js';
import { OccupancyService } from './occupancy.service.js';

@Module({})
export class ParkingModule {
  static register(runtime: DynamicModule): DynamicModule {
    return {
      module: ParkingModule,
      imports: [runtime],
      controllers: [OccupancyController, CheckInController],
      providers: [OccupancyService, CheckInService, GateAuthGuard],
    };
  }
}
