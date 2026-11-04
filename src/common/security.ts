import helmet from 'helmet';

/**
 * Security response headers (prompt_security S1.1).
 *
 * `contentSecurityPolicy` stays at helmet's default (`default-src 'self'`) — the API serves JSON and
 * Swagger UI only; no inline script is required beyond what Swagger bundles itself.
 * `crossOriginEmbedderPolicy` is disabled because the SSE stream and the local GGUF tooling do not
 * need cross-origin isolation.
 */
export function securityHeaders(isProduction: boolean) {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
        connectSrc: ["'self'"],
      },
    },
    hsts: isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
}

/** `trust proxy` value for the current environment. */
export function trustProxySetting(
  nodeEnv: string,
): number | 'loopback' | false {
  if (nodeEnv === 'production') return 1; // one reverse proxy hop in front of the app
  if (nodeEnv === 'test') return 'loopback';
  return false; // dev: the client IP must stay the real one so `@Ip()` is meaningful
}
