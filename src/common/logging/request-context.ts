import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { isUuid, uuidv7 } from './uuid';

/** Per-request state: the request id and the business event logged on the request line. */
export interface RequestContext {
  requestId: string;
  event?: string;
  fields: Record<string, unknown>;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * First middleware of the app: accepts a client `X-Request-Id` only when it is a valid UUID,
 * otherwise generates a v7 one; echoes it back and opens the request context.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = isUuid(incoming) ? incoming.toLowerCase() : uuidv7();
  req.id = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  const ctx: RequestContext = { requestId, fields: {} };
  res.locals.ctx = ctx;
  storage.run(ctx, next);
}

/** `req.id` as a string (pino-http types it as string | number | object). */
export function requestIdOf(req: Request): string | null {
  return typeof req.id === 'string' || typeof req.id === 'number'
    ? String(req.id)
    : null;
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Names the business event of the current request (e.g. `LOGIN_OK`). It becomes the `msg` of the
 * request log line, and `fields` are added to that line. Outside a request this is a no-op.
 */
export function logEvent(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.event = event;
  Object.assign(ctx.fields, fields);
}

/** Adds fields to the current request log line without naming its event. */
export function logFields(fields: Record<string, unknown>): void {
  const ctx = storage.getStore();
  if (ctx) Object.assign(ctx.fields, fields);
}

export function contextOf(res: {
  locals?: Record<string, unknown>;
}): RequestContext | undefined {
  return res.locals?.ctx as RequestContext | undefined;
}
