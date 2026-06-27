/**
 * The sandbox directory that holds user-uploaded context files. Kept ASCII /
 * path-safe internally; only the DISPLAY is prettified (see
 * {@link prettifyContextDir}).
 */
const CONTEXT_UPLOAD_DIR = '_uploads';

// A path token whose final segment is `_uploads` — optionally preceded by an
// absolute/relative prefix (for example `/workspaces/<id>/`). The lookbehind stops it
// matching inside a longer word (for example `my_uploads`); the lookahead requires the
// segment to end at a boundary.
const UPLOAD_PATH_RE = new RegExp(
  `(?<![\\w/])(?:[^\\s"'\`<>]*\\/)?${CONTEXT_UPLOAD_DIR}(?=$|[/\\s"'\`<>])`,
  'g'
);

/**
 * Display-only: rewrite the internal `_uploads` directory (including any
 * absolute path prefix) to the friendly label, so agent commands/paths read as
 * "context files" instead of leaking the raw sandbox dir. The real path on disk
 * is unchanged — this is purely for what the user sees.
 */
export function prettifyContextDir(text: string, label: string): string {
  if (!text || !text.includes(CONTEXT_UPLOAD_DIR)) {
    return text;
  }
  return text.replace(UPLOAD_PATH_RE, label);
}
