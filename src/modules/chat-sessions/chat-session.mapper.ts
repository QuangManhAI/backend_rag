import { BadRequestException } from '@nestjs/common';
import { TITLE_MAX, UTC7_OFFSET_MS } from './chat-sessions.constants';
import type { MessageDto, SessionSummaryDto } from './dto/chat-session.dto';
import type { ChatMessage } from './schemas/chat-message.schema';
import type {
  ChatSession,
  ChatSessionDocument,
} from './schemas/chat-session.schema';

/** Unicode-aware length (an emoji counts as one character). */
const charLength = (s: string) => Array.from(s).length;

/** Trimmed title of 1–120 characters, else 400 `invalid title`. */
export function validTitle(raw: string): string {
  const t = raw.trim();
  if (!t || charLength(t) > TITLE_MAX)
    throw new BadRequestException('invalid title');
  return t;
}

/** Default session title: `YY-MM-DD:HH-MM-SS` in UTC+07 (e.g. `26-10-19:14-28-33`). */
export function formatTimestampTitle(date: Date = new Date()): string {
  const utc7 = new Date(date.getTime() + UTC7_OFFSET_MS);
  const yy = String(utc7.getUTCFullYear()).slice(-2);
  const mm = String(utc7.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc7.getUTCDate()).padStart(2, '0');
  const hh = String(utc7.getUTCHours()).padStart(2, '0');
  const min = String(utc7.getUTCMinutes()).padStart(2, '0');
  const ss = String(utc7.getUTCSeconds()).padStart(2, '0');
  return `${yy}-${mm}-${dd}:${hh}-${min}-${ss}`;
}

export function toSummary(
  s: ChatSessionDocument | (ChatSession & { _id: string }),
): SessionSummaryDto {
  const lastMsgAt = s.last_message_at ?? s.created_at;
  return {
    id: s._id,
    title: s.title,
    message_count: s.message_count,
    last_message_at: lastMsgAt.toISOString(),
    created_at: s.created_at.toISOString(),
    updated_at: s.updated_at.toISOString(),
  };
}

export function toMessage(m: ChatMessage & { _id: string }): MessageDto {
  const updatedAt = m.updated_at ?? m.created_at;
  const out: MessageDto = {
    id: m._id,
    role: m.role,
    content: m.content,
    created_at: m.created_at.toISOString(),
    updated_at: updatedAt.toISOString(),
  };
  if (m.role === 'assistant') {
    out.citations = m.citations ?? [];
    out.grounded_chunks = m.grounded_chunks ?? [];
    if (m.timings) out.timings = m.timings;
  }
  return out;
}
