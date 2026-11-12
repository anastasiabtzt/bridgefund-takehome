import { DynamicModule, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from './config.js';
import { Clock, SystemClock } from './clock.js';
import { DatabaseService } from './database/database.service.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: Clock, useClass: SystemClock },
        DatabaseService,
      ],
    };
  }
}
