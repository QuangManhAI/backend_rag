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

/**
 * `trust proxy` value. `hops` is the number of reverse proxies really in front of the app, set by
 * the deployment (`TRUST_PROXY_HOPS`): trusting a proxy that is not there lets any client choose
 * its own IP with `X-Forwarded-For`, which defeats the rate limiter and the login lockout and
 * forges the IP in the audit trail. Behind an undeclared proxy the failure is the safe one: every
 * client shares one bucket.
 */
export function trustProxySetting(
  nodeEnv: string,
  hops: number,
): number | 'loopback' | false {
  if (nodeEnv === 'test') return 'loopback';
  return hops > 0 ? hops : false;
}
