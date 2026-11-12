import { DynamicModule, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from './config.js';
import { Clock, SystemClock } from './clock.js';
import { DatabaseService } from './database/database.service.js';

@Module({})
export class RuntimeModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: RuntimeModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        DatabaseService,
        SystemClock,
        { provide: Clock, useExisting: SystemClock },
      ],
      exports: [APP_CONFIG, DatabaseService, Clock, SystemClock],
    };
  }
}
