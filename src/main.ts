process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE ?? '4';
import 'dotenv/config';
import type { Server } from 'http';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { EnvValidationError, parseEnv } from './config/env.schema';

async function bootstrap(): Promise<void> {
  try {
    parseEnv(process.env);
  } catch (e) {
    if (e instanceof EnvValidationError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  const server = (await app.listen(Number(process.env.PORT ?? 3000))) as Server;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}

void bootstrap();
