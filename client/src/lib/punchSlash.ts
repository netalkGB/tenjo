/** Slash-token helpers for agent prompt autocomplete (force-load is server-side). */

/**
 * Detect the incomplete `/token` at the cursor for autocomplete.
 * Returns null when the cursor is not inside a slash token.
 */
export function getSlashQueryAtCursor(
  value: string,
  cursor: number
): { start: number; query: string } | null {
  const before = value.slice(0, cursor);
  const match = before.match(/(?:^|[^\w-])\/([a-z0-9-]*)$/i);
  if (!match) return null;
  const token = match[1] ?? '';
  const start = before.length - token.length - 1;
  return { start, query: token.toLowerCase() };
}
