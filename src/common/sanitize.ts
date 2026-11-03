/**
 * Escapes every character that has a special meaning in a regular expression, so a user-provided
 * string can safely be used inside a MongoDB `$regex` filter (ReDoS prevention).
 *
 * Shared by the chat-session title search and the admin user/session search.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
