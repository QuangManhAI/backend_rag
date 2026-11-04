import type { ExecutionContext } from '@nestjs/common';
import { RATE_LIMITS, RateLimitChat, THROTTLER_NAME } from './throttler';

@RateLimitChat()
class Probe {}

const limitFor = (headers: Record<string, string>): number => {
  const limit = Reflect.getMetadata(
    `THROTTLER:LIMIT${THROTTLER_NAME}`,
    Probe,
  ) as (ctx: ExecutionContext) => number;
  return limit({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext);
};

describe('RateLimitChat', () => {
  it('gives anonymous callers half the budget', () => {
    expect(limitFor({})).toBe(RATE_LIMITS.ragChatAnonymous.limit);
    expect(limitFor({ authorization: 'Bearer x' })).toBe(
      RATE_LIMITS.ragChat.limit,
    );
    expect(RATE_LIMITS.ragChatAnonymous.limit).toBeLessThan(
      RATE_LIMITS.ragChat.limit,
    );
  });
});
