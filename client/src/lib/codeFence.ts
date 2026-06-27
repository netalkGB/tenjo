/**
 * Pick a code-fence length longer than any backtick run inside the content, so
 * output containing literal ``` doesn't terminate the block early.
 */
function makeFence(content: string): string {
  let max = 2;
  const matches = content.match(/`+/g);
  if (matches) {
    for (const m of matches) {
      if (m.length > max) max = m.length;
    }
  }
  return '`'.repeat(max + 1);
}

/**
 * Wrap content in a Markdown fenced code block that survives inner backticks.
 * Trailing newlines are stripped so an implicit '\n' doesn't render as a blank
 * line before the closing fence (the copy action still gets the visible text).
 */
export function fencedCode(content: string, language: string): string {
  const trimmed = content.replace(/\n+$/, '');
  const fence = makeFence(trimmed);
  return `${fence}${language}\n${trimmed}\n${fence}`;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  html: 'html',
  css: 'css',
  scss: 'scss',
  vue: 'xml',
  svelte: 'xml',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql'
};

/** Best-effort highlight.js language for a file path (empty when unknown). */
export function languageFromPath(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) {
    return '';
  }
  return LANGUAGE_BY_EXT[path.slice(dot + 1).toLowerCase()] ?? '';
}
