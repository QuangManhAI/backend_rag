import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  NotAcceptableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export const XML_MEDIA_TYPES = ['application/xml', 'text/xml'];
const SSE_MEDIA_TYPE = 'text/event-stream';
const OFFERED = ['application/json', ...XML_MEDIA_TYPES, SSE_MEDIA_TYPE];
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SUPPORTED_BODY =
  /^(?:application\/(?:[\w.+-]+\+)?json|application\/(?:[\w.+-]+\+)?xml|text\/xml)\s*(?:;|$)/i;

/** XML has no types: these fields are the booleans of the request DTOs. Numbers use `@Type`. */
const BOOLEAN_FIELDS = new Set([
  'active',
  'expand_query',
  'use_authority_boost',
]);
/** XML cannot tell one element from a list of one: these fields are always lists. */
const ARRAY_FIELDS = new Set(['roles']);

const parser = new XMLParser({
  ignoreAttributes: true,
  // Tag values stay strings: a numeric password or title must not turn into a number.
  parseTagValue: false,
  isArray: (name) => ARRAY_FIELDS.has(name),
  tagValueProcessor: (name, value) =>
    BOOLEAN_FIELDS.has(name) && (value === 'true' || value === 'false')
      ? value === 'true'
      : value,
});
const builder = new XMLBuilder({ ignoreAttributes: true });

export function toXml(body: unknown): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${builder.build({ response: body })}`;
}

/** Any well-formed document with one root element ➔ the object inside that root. */
export function parseXmlBody(xml: string): Record<string, unknown> {
  // No document type means no entity expansion and no external entities (XXE, billion laughs).
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new BadRequestException('invalid xml');
  }
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    // The parser refuses names such as `__proto__`.
    throw new BadRequestException('invalid xml');
  }
  const roots = Object.keys(doc).filter((k) => k !== '?xml');
  const root = roots.length === 1 ? doc[roots[0]] : undefined;
  if (root === '') return {};
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new BadRequestException('invalid xml');
  }
  return root as Record<string, unknown>;
}

/** True for a request body that is neither JSON nor XML (415). */
export function unsupportedBody(req: Request): boolean {
  const hasBody =
    Number(req.headers['content-length'] ?? 0) > 0 ||
    req.headers['transfer-encoding'] !== undefined;
  return (
    BODY_METHODS.has(req.method) &&
    hasBody &&
    !SUPPORTED_BODY.test(req.headers['content-type'] ?? '')
  );
}

export const UNSUPPORTED_BODY = () =>
  new UnsupportedMediaTypeException(
    'content type must be application/json or application/xml',
  );

/** True when the client prefers XML over JSON. `*` and no `Accept` header mean JSON. */
export function wantsXml(req: Request): boolean {
  const type = req.accepts(OFFERED);
  return typeof type === 'string' && XML_MEDIA_TYPES.includes(type);
}

/** Turns a parsed `text` body into the object the validation pipe expects. */
export function xmlBodyMiddleware(
  sendError: (req: Request, res: Response, e: BadRequestException) => void,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (typeof req.body !== 'string') return next();
    try {
      req.body = parseXmlBody(req.body);
      next();
    } catch (e) {
      sendError(req, res, e as BadRequestException);
    }
  };
}

/** Response negotiation: 406 when nothing we produce is acceptable, XML when it is preferred. */
@Injectable()
export class ContentNegotiationInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (!req.accepts(OFFERED)) {
      throw new NotAcceptableException(
        'accept must allow application/json or application/xml',
      );
    }
    return next.handle().pipe(
      map((body: unknown) => {
        if (body === undefined || !wantsXml(req)) return body;
        res.type('application/xml');
        return toXml(body);
      }),
    );
  }
}
