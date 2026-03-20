export interface KeyValueEntry {
  key: string;
  value: string;
}

export function recordToEntries(
  record: Record<string, string> | undefined
): KeyValueEntry[] {
  if (!record) return [];
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

export function entriesToRecord(
  entries: KeyValueEntry[]
): Record<string, string> | undefined {
  const filtered = entries.filter(e => e.key.trim() !== '');
  if (filtered.length === 0) return undefined;
  return Object.fromEntries(filtered.map(e => [e.key, e.value]));
}
