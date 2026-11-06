import { createHash } from 'crypto';
import type { ChatRequestDto } from '../dto/chat-request.dto';

/** Identifies the request body behind an `Idempotency-Key`. */
export function requestFingerprint(req: ChatRequestDto): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        req.query,
        req.session_id ?? null,
        req.top_k,
        req.nprobe,
        req.category ?? null,
        req.use_authority_boost,
        req.expand_query,
      ]),
    )
    .digest('hex');
}
