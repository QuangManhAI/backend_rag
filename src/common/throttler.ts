import { Throttle } from '@nestjs/throttler';

/**
 * Rate limits (prompt_security S1.1). The values follow the limits already documented in
 * `backend_rag/docs/AUTH_AND_SECURITY_ARCHITECTURE.md` §5.
 *
 * The throttler keys on the client IP. `trust proxy` must therefore be configured correctly
 * (see `common/security.ts`), otherwise every user behind the same proxy shares one bucket.
 *
 * Only one throttler named `default` is registered globally; a route overrides its limit with
 * `@RateLimit(...)`. Registering one named throttler per route would apply *all* of them to
 * every route, which is not what we want.
 */
export const RATE_LIMITS = {
  /** `POST /auth/register` — mass account creation + Argon2 CPU exhaustion. */
  register: { limit: 5, ttl: 60_000 },
  /** `POST /auth/login` — credential stuffing. */
  login: { limit: 10, ttl: 60_000 },
  /** `POST /auth/refresh` — token minting. */
  refresh: { limit: 30, ttl: 60_000 },
  /** `POST /auth/change-password` — credential rotation. */
  changePassword: { limit: 5, ttl: 60_000 },
  /** `POST /rag/chat` and `POST /rag/chat/stream` — the LLM queue has a single slot. */
  ragChat: { limit: 20, ttl: 60_000 },
  /** Global fallback for every other route. */
  default: { limit: 120, ttl: 60_000 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** The name of the single globally registered throttler. */
export const THROTTLER_NAME = 'default';

/** `@RateLimit(...)` decorator bound to one of the named limits. */
export function RateLimit(
  name: RateLimitName,
): MethodDecorator & ClassDecorator {
  const { limit, ttl } = RATE_LIMITS[name];
  return Throttle({ [THROTTLER_NAME]: { limit, ttl } });
}
