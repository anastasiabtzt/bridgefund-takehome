import { DynamicModule, Module } from '@nestjs/common';
import { PaymentSettlementService } from './payment-settlement.service.js';
import { CheckOutController } from './check-out.controller.js';
import { CheckOutService } from './check-out.service.js';
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
      exports: [PaymentSettlementService],
      controllers: [OccupancyController, CheckInController, CheckOutController],
      providers: [OccupancyService, CheckInService, CheckOutService, GateAuthGuard, PaymentSettlementService],
    };
  }
}
