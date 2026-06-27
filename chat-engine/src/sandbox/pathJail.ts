import { SandboxConfigurationError } from './errors.js';

/**
 * Path jail for the coding tools' file operations.
 *
 * A model-supplied path must never let read_file / write_file / str_replace
 * touch anything outside the workspace root. This is the entire filesystem-side
 * security boundary, so it is fail-closed: anything ambiguous is rejected rather
 * than resolved leniently.
 *
 * `jailRelative` normalizes an input path to a safe POSIX path RELATIVE to the
 * workspace root:
 *  - separators are unified to `/`;
 *  - a leading Windows drive (`C:`), UNC, or root slash is stripped, so an
 *    "absolute" path is interpreted as rooted AT the workspace (never the host
 *    or container root) — this keeps the tools' "relative or absolute"
 *    description truthful without ever escaping;
 *  - `.` segments are dropped and `..` segments pop the accumulated path, but a
 *    `..` that would climb ABOVE the root throws (the escape we must prevent).
 *
 * The returned string is empty (`''`) when the path resolves to the root itself;
 * callers join it onto the concrete root (`<root>` host path or `/workspace`).
 */
export class PathJailError extends SandboxConfigurationError {
  constructor(message: string) {
    super(message);
  }
}

export function jailRelative(inputPath: string): string {
  if (typeof inputPath !== 'string') {
    throw new PathJailError('path must be a string');
  }
  // Empty / '.' / '/' all resolve to the workspace root (returned as '').
  // The file tools reject an empty path themselves; listing/snapshotting the
  // root, however, is legitimate.

  // Unify separators, then strip a Windows drive prefix and any leading slashes
  // so the remainder is treated relative to the workspace root.
  const unified = inputPath.replace(/\\/g, '/');
  const withoutDrive = unified.replace(/^[a-zA-Z]:/, '');
  const relative = withoutDrive.replace(/^\/+/, '');

  const segments: string[] = [];
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        throw new PathJailError(
          `path escapes the workspace root: ${inputPath}`
        );
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join('/');
}
