import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { Express } from 'express';
import { AppConfigService } from './config/app-config.service';
import { HttpExceptionFilter } from './common/http-exception.filter';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './common/request-context';
import { securityHeaders, trustProxySetting } from './common/security';
import { RATE_LIMITS } from './common/throttler';
import { createValidationPipe } from './common/validation';

export const API_PREFIX = 'api/v1';

/** Shared by main.ts and the e2e tests so both run the exact same pipeline. */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);
  const nodeEnv = config.get('NODE_ENV');
  const isProduction = nodeEnv === 'production';

  // `trust proxy` must be set before Express reads the client IP, because the rate limiter keys
  // on it (prompt_security S1.1).
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', trustProxySetting(nodeEnv));
  app.use(requestIdMiddleware);
  app.use(securityHeaders(isProduction));
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({
    origin: config.corsOrigins,
    exposedHeaders: [REQUEST_ID_HEADER],
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  // Swagger is a development aid: it exposes the full API surface, so it stays off in production.
  if (!isProduction) {
    const doc = new DocumentBuilder()
      .setTitle('RAG_TS API')
      .setDescription(
        'Scientific RAG backend (monolith). Contract: docs/API_DESIGN.md',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      `${API_PREFIX}/docs`,
      app,
      SwaggerModule.createDocument(app, doc),
      {
        jsonDocumentUrl: `${API_PREFIX}/docs-json`,
      },
    );
  }
}

export { RATE_LIMITS };
