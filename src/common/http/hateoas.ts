import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export const API_PREFIX = 'api/v1';
const BASE = `/${API_PREFIX}`;

export interface Link {
  href: string;
  /** Absent means `GET`. */
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
}
export type Links = Record<string, Link>;

const get = (path: string): Link => ({ href: `${BASE}${path}` });
const act = (method: Link['method'], path: string): Link => ({
  href: `${BASE}${path}`,
  method,
});

// ------------------------------------------------------------------ link relations

export const accountLinks = (): Links => ({
  self: get('/users/me'),
  update: act('PATCH', '/users/me'),
  password: act('PUT', '/users/me/password'),
  'chat-sessions': get('/chat-sessions'),
  'token-rotations': act('POST', '/auth/token-rotations'),
  'token-revocations': act('POST', '/auth/token-revocations'),
});

export const sessionLinks = (id: string): Links => ({
  self: get(`/chat-sessions/${id}`),
  messages: get(`/chat-sessions/${id}/messages`),
  rename: act('PATCH', `/chat-sessions/${id}`),
  delete: act('DELETE', `/chat-sessions/${id}`),
  chat: act('POST', '/rag/chat'),
});

export const paperLinks = (id: string): Links => ({
  self: get(`/papers/${encodeURIComponent(id)}`),
});

/** What a chat answer leads to. Anonymous answers are not stored, so only the papers remain. */
export function chatLinks(answer: {
  session_id: string | null;
  citations: string[];
}): Links {
  const links: Links = answer.session_id
    ? {
        session: get(`/chat-sessions/${answer.session_id}`),
        messages: get(`/chat-sessions/${answer.session_id}/messages`),
      }
    : {};
  if (answer.citations.length) {
    const ids = answer.citations.map(encodeURIComponent).join(',');
    links.papers = get(`/papers?ids=${ids}`);
  }
  return links;
}

export const healthLinks = (): Links => ({
  self: get('/health'),
  live: get('/health/live'),
  ready: get('/health/ready'),
});

/** The lock action offered depends on the account's state. */
export function adminUserLinks(user: {
  id: string;
  is_active: boolean;
}): Links {
  const path = `/admin/users/${user.id}`;
  return {
    self: get(path),
    roles: act('PUT', `${path}/roles`),
    [user.is_active ? 'lock' : 'unlock']: act('PUT', `${path}/status`),
    tokens: get(`${path}/tokens`),
    'revoke-tokens': act('DELETE', `${path}/tokens`),
    'chat-sessions': get(`${path}/chat-sessions`),
  };
}

export const adminSessionLinks = (id: string): Links => ({
  self: get(`/admin/chat-sessions/${id}`),
  messages: get(`/admin/chat-sessions/${id}/messages`),
});

/** Entry point of the API: a client only needs this URL to discover the rest. */
export const rootLinks = (): Links => ({
  self: get(''),
  register: act('POST', '/users'),
  tokens: act('POST', '/auth/tokens'),
  me: get('/users/me'),
  'chat-sessions': get('/chat-sessions'),
  chat: act('POST', '/rag/chat'),
  'chat-stream': act('POST', '/rag/chat/stream'),
  papers: get('/papers?ids={ids}'),
  health: get('/health'),
  admin: get('/admin/users'),
});

// ------------------------------------------------------------------ route metadata

// The shapes are route-specific: each decorator use states the body it knows it receives.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface LinkSpec {
  resource?: (body: any, req: Request) => Links;
  item?: (item: any) => Links;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const LINKS_KEY = 'rag:links';

/** Declares the `_links` of a route's response. */
export const WithLinks = (spec: LinkSpec = {}) => SetMetadata(LINKS_KEY, spec);

function withCursor(url: string, cursor: string): string {
  const u = new URL(url, 'http://localhost');
  u.searchParams.set('cursor', cursor);
  return `${u.pathname}${u.search}`;
}

/** Adds `_links` to a response, on copies: bodies may be objects shared with a cache. */
export function addLinks(
  body: object,
  spec: LinkSpec,
  req: Request,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  const page = body as { items?: unknown; next_cursor?: unknown };
  const links: Links = {};
  if (Array.isArray(page.items)) {
    links.self = { href: req.originalUrl };
    if (typeof page.next_cursor === 'string') {
      links.next = { href: withCursor(req.originalUrl, page.next_cursor) };
    }
    if (spec.item) {
      const item = spec.item;
      out.items = page.items.map((i: object) => ({ ...i, _links: item(i) }));
    }
  }
  Object.assign(links, spec.resource?.(body, req));
  out._links = links;
  return out;
}

@Injectable()
export class LinksInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.get<LinkSpec | undefined>(
      LINKS_KEY,
      ctx.getHandler(),
    );
    if (!spec) return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    return next
      .handle()
      .pipe(
        map((body: unknown) =>
          typeof body === 'object' && body !== null
            ? addLinks(body, spec, req)
            : body,
        ),
      );
  }
}
