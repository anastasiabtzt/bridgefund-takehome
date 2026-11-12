import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureHttp } from './http.js';
import { loadConfig } from './config.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), { abortOnError: false });
  configureHttp(app);
  app.enableShutdownHooks();
  try {
    await app.listen(config.port, '127.0.0.1');
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Application startup failed.');
  process.exitCode = 1;
});
