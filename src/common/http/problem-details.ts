import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'http';
import { requestIdOf } from '../logging/request-context';
import { messageOf } from './http-exception.filter';

export interface InvalidParam {
  name: string;
  reason: string;
}

/** RFC 9457 Problem Details for HTTP APIs (application/problem+json). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  request_id?: string | null;
  timestamp?: string;
  code?: string;
  invalid_params?: InvalidParam[];
}

export function toProblemDetails(
  exception: unknown,
  req: Request,
): ProblemDetails {
  const status =
    exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

  const defaultTitle = STATUS_CODES[status] ?? 'Error';
  const detail =
    exception instanceof HttpException
      ? messageOf(exception)
      : 'internal server error';

  let code: string | undefined;
  let invalid_params: InvalidParam[] | undefined;

  if (exception instanceof HttpException) {
    const res = exception.getResponse();
    if (typeof res === 'object' && res !== null) {
      const obj = res as Record<string, unknown>;
      if (typeof obj.error === 'string' && obj.error !== defaultTitle) {
        code = obj.error;
      }
      if (Array.isArray(obj.invalid_params)) {
        invalid_params = obj.invalid_params as InvalidParam[];
      } else if (Array.isArray(obj.message) && status === 400) {
        invalid_params = (obj.message as string[]).map((msg) => ({
          name: typeof msg === 'string' ? msg.split(' ')[0] : 'field',
          reason: String(msg),
        }));
      }
    }
  }

  const typeSlug = (code ?? defaultTitle)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const type = `urn:rag:error:${typeSlug}`;

  const path = req.originalUrl || req.url || req.path || '';

  return {
    type,
    title: defaultTitle,
    status,
    detail,
    instance: path,
    request_id: requestIdOf(req),
    timestamp: new Date().toISOString(),
    ...(code ? { code } : {}),
    ...(invalid_params && invalid_params.length ? { invalid_params } : {}),
  };
}

export function sendProblem(res: Response, problem: ProblemDetails): void {
  res.status(problem.status);
  res.type('application/problem+json').json(problem);
}
