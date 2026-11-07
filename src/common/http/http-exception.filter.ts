import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  MethodNotAllowedException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'http';
import { requestIdOf } from '../logging/request-context';
import { sendProblem, toProblemDetails } from './problem-details';
import { toXml, wantsXml } from './xml';

/** Error body of every endpoint (API_DESIGN §1.2). */
export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  request_id: string | null;
}

export function messageOf(exception: HttpException): string {
  const res = exception.getResponse();
  if (typeof res === 'string') return res;
  const m = (res as { message?: unknown }).message;
  if (Array.isArray(m)) return String(m[0] ?? exception.message);
  if (typeof m === 'string') return m;
  return exception.message;
}

export function toErrorBody(
  exception: unknown,
  requestId: string | null,
): ErrorBody {
  const status =
    exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  const message =
    exception instanceof HttpException
      ? messageOf(exception)
      : 'internal server error';
  return {
    statusCode: status,
    error: STATUS_CODES[status] ?? 'Error',
    message,
    request_id: requestId,
  };
}

/** An error in the format the client asked for. */
export function sendError(req: Request, res: Response, body: ErrorBody): void {
  res.status(body.statusCode);
  if (wantsXml(req)) res.type('application/xml').send(toXml(body));
  else res.json(body);
}

/** The 404 of the framework's router, as opposed to a resource a handler did not find. */
function isRouteNotFound(e: unknown): boolean {
  return e instanceof NotFoundException && /^Cannot [A-Z]+ /.test(e.message);
}

/**
 * Turns every thrown error into the §1.2 body. Unexpected errors become 500 without leaking the
 * stack; the error is attached to the response so the request log line carries it.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  /** `methodsOf` lists the methods a path answers to, which turns a wrong method into a 405. */
  constructor(private readonly methodsOf?: (path: string) => string[]) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response & { err?: unknown }>();
    const allowed = isRouteNotFound(exception)
      ? (this.methodsOf?.(req.path) ?? [])
      : [];
    if (allowed.length) res.setHeader('Allow', allowed.join(', '));
    const targetError = allowed.length
      ? new MethodNotAllowedException('method not allowed')
      : exception;

    const isV2 =
      req.originalUrl?.includes('/api/v2') ||
      req.path?.includes('/api/v2') ||
      req.url?.includes('/api/v2');

    if (isV2) {
      const problem = toProblemDetails(targetError, req);
      if (problem.status >= 500) {
        res.err =
          exception instanceof Error ? exception : new Error(String(exception));
      }
      if (res.headersSent) {
        res.end();
        return;
      }
      sendProblem(res, problem);
      return;
    }

    const body = toErrorBody(targetError, requestIdOf(req));
    if (body.statusCode >= 500) {
      res.err =
        exception instanceof Error ? exception : new Error(String(exception));
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    sendError(req, res, body);
  }
}
