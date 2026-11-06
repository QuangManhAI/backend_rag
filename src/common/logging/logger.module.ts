import { Module } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'http';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import pino from 'pino';
import type { Request, Response } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { contextOf } from './request-context';
import { uuidv7 } from './uuid';

/** Fields never written to logs, wherever they appear. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'old_password',
  'new_password',
  'refresh_token',
  'access_token',
  'query',
  '*.password',
  '*.old_password',
  '*.new_password',
  '*.refresh_token',
  '*.access_token',
  '*.query',
];

function statusOf(res: ServerResponse): number {
  return res.statusCode;
}

/** Fields of the single per-request line (API_DESIGN §1.3); only added once the response is out. */
export function requestLineProps(
  req: IncomingMessage,
  res: ServerResponse,
): Record<string, unknown> {
  if (!res.headersSent) return {};
  const r = req as Request;
  const ctx = contextOf(res as Response);
  return {
    method: r.method,
    path: (r.originalUrl ?? r.url ?? '').split('?')[0],
    status: statusOf(res),
    user_id: r.user?.id ?? null,
    ...(ctx?.fields ?? {}),
  };
}

export function requestLineLevel(
  _req: IncomingMessage,
  res: ServerResponse,
  err?: Error,
): pino.LevelWithSilent {
  const status = statusOf(res);
  if (contextOf(res as Response)?.event?.endsWith('_ABORTED')) return 'info';
  if (status >= 500 || (err && status < 400)) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

function eventOf(res: ServerResponse, fallback: string): string {
  return contextOf(res as Response)?.event ?? fallback;
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.get('NODE_ENV') === 'test' ? 'silent' : 'info',
          base: undefined,
          messageKey: 'msg',
          timestamp: pino.stdTimeFunctions.isoTime,
          formatters: { level: (label: string) => ({ level: label }) },
          redact: { paths: REDACT_PATHS, censor: '[redacted]' },
          quietReqLogger: true,
          genReqId: (req: IncomingMessage) => (req as Request).id ?? uuidv7(),
          customAttributeKeys: {
            reqId: 'request_id',
            responseTime: 'latency_ms',
          },
          serializers: {
            req: () => undefined,
            res: () => undefined,
            err: pino.stdSerializers.err,
          },
          customProps: requestLineProps,
          customLogLevel: requestLineLevel,
          customSuccessMessage: (_req: IncomingMessage, res: ServerResponse) =>
            eventOf(res, 'REQUEST_DONE'),
          customErrorMessage: (_req: IncomingMessage, res: ServerResponse) =>
            eventOf(res, 'REQUEST_FAILED'),
        },
      }),
    }),
  ],
})
export class LoggerModule {}
