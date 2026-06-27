import type { FileSnapshot, FileChange } from './Sandbox.js';

export function diffSnapshots(
  before: FileSnapshot,
  after: FileSnapshot
): FileChange[] {
  const changes: FileChange[] = [];
  for (const [path, stat] of after) {
    const previous = before.get(path);
    if (!previous) {
      changes.push({ path, kind: 'created' });
    } else if (
      previous.size !== stat.size ||
      previous.mtimeMs !== stat.mtimeMs
    ) {
      changes.push({ path, kind: 'updated' });
    }
  }
  for (const path of before.keys()) {
    if (!after.has(path)) {
      changes.push({ path, kind: 'deleted' });
    }
  }
  changes.sort((a, b) => a.path.localeCompare(b.path));
  return changes;
}
