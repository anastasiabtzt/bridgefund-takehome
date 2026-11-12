import { DynamicModule, Module } from '@nestjs/common';
import { AppConfig } from './config.js';
import { RuntimeModule } from './runtime.module.js';
import { ParkingModule } from './parking/parking.module.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    const runtime = RuntimeModule.register(config);
    return {
      module: AppModule,
      imports: [ParkingModule.register(runtime)],
    };
  }
}
