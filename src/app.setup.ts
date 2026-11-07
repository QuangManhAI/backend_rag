import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import {
  text as textBody,
  type Express,
  type Request,
  type Response,
} from 'express';
import { AppConfigService } from './config/app-config.service';
import { API_PREFIX, LinksInterceptor } from './common/http/hateoas';
import { allowedMethods } from './common/http/http-contract';
import {
  HttpExceptionFilter,
  sendError,
  toErrorBody,
} from './common/http/http-exception.filter';
import { sendProblem, toProblemDetails } from './common/http/problem-details';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
  requestIdOf,
} from './common/logging/request-context';
import { securityHeaders, trustProxySetting } from './common/security/security';
import { RATE_LIMITS } from './common/security/throttler';
import { createValidationPipe } from './common/http/validation';
import {
  ContentNegotiationInterceptor,
  UNSUPPORTED_BODY,
  unsupportedBody,
  XML_MEDIA_TYPES,
  xmlBodyMiddleware,
} from './common/http/xml';

export { API_PREFIX };

/** Shared by main.ts and the e2e tests so both run the exact same pipeline. */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);
  const nodeEnv = config.get('NODE_ENV');
  const isProduction = nodeEnv === 'production';

  // `trust proxy` must be set before Express reads the client IP, because the rate limiter keys
  // on it (prompt_security S1.1).
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set(
    'trust proxy',
    trustProxySetting(nodeEnv, config.get('TRUST_PROXY_HOPS')),
  );
  app.use(requestIdMiddleware);
  app.use(securityHeaders(isProduction));
  const respondError = (req: Request, res: Response, e: unknown) => {
    if (req.originalUrl?.includes('/api/v2') || req.path?.includes('/api/v2')) {
      sendProblem(res, toProblemDetails(e, req));
    } else {
      sendError(req, res, toErrorBody(e, requestIdOf(req)));
    }
  };
  app.use((req: Request, res: Response, next: () => void) => {
    if (unsupportedBody(req)) respondError(req, res, UNSUPPORTED_BODY());
    else next();
  });
  app.use(textBody({ type: XML_MEDIA_TYPES, limit: '100kb' }));
  app.use(xmlBodyMiddleware(respondError));
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX, {
    exclude: ['api/v2/(.*)', 'api/v2'],
  });
  app.enableCors({
    origin: config.corsOrigins,
    exposedHeaders: [REQUEST_ID_HEADER, 'Idempotent-Replayed', 'Retry-After'],
  });
  app.useGlobalPipes(createValidationPipe());
  // The first interceptor wraps the second, so links are added before the body is serialized.
  app.useGlobalInterceptors(
    new ContentNegotiationInterceptor(),
    new LinksInterceptor(app.get(Reflector)),
  );
  app.useGlobalFilters(
    new HttpExceptionFilter((path) => allowedMethods(express, path)),
  );
  app.enableShutdownHooks();

  // Swagger is a development aid: it exposes the full API surface, so it stays off in production.
  if (!isProduction) {
    const docV1 = new DocumentBuilder()
      .setTitle('RAG_TS API v1')
      .setDescription(
        'Scientific RAG backend (monolith) v1. Contract: docs/api/API_DESIGN.md',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    const documentV1 = SwaggerModule.createDocument(app, docV1);
    documentV1.paths = Object.fromEntries(
      Object.entries(documentV1.paths).filter(([p]) => p.startsWith('/api/v1')),
    );
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, documentV1, {
      jsonDocumentUrl: `${API_PREFIX}/docs-json`,
    });

    const docV2 = new DocumentBuilder()
      .setTitle('RAG_TS API v2')
      .setDescription(
        'Scientific RAG backend (monolith) v2 - RFC 9457 Problem Details & RESTful standards.',
      )
      .setVersion('2.0.0')
      .addBearerAuth()
      .build();
    const documentV2 = SwaggerModule.createDocument(app, docV2);
    documentV2.paths = Object.fromEntries(
      Object.entries(documentV2.paths).filter(([p]) => p.startsWith('/api/v2')),
    );
    SwaggerModule.setup('api/v2/docs', app, documentV2, {
      jsonDocumentUrl: 'api/v2/docs-json',
    });
  }
}

export { RATE_LIMITS };
