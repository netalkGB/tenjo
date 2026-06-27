import type { FileSnapshot } from 'tenjo-chat-engine';
import type {
  AgentFileKind,
  AgentFileNode,
  AgentFileChange
} from '../types/agentProtocol';

/**
 * Pure helpers that turn raw sandbox file data into the UI's file-tree shapes.
 * Shared by the session manager (initial tree + live changes), the subscribe
 * path, and the REST download route so the mapping lives in one place.
 */

/** Extension → UI file kind. Mirrors the client's KIND_ICON keys. */
const KIND_BY_EXT: Record<string, AgentFileKind> = {
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  py: 'code',
  rb: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  cs: 'code',
  php: 'code',
  sh: 'code',
  html: 'code',
  css: 'code',
  scss: 'code',
  vue: 'code',
  svelte: 'code',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  pdf: 'pdf',
  doc: 'docx',
  docx: 'docx',
  ppt: 'pptx',
  pptx: 'pptx',
  xls: 'xlsx',
  xlsx: 'xlsx',
  csv: 'xlsx',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  ico: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  flac: 'audio',
  mp4: 'video',
  m4v: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  bz2: 'archive',
  xz: 'archive',
  '7z': 'archive',
  rar: 'archive',
  yml: 'config',
  yaml: 'config',
  toml: 'config',
  ini: 'config',
  env: 'config',
  lock: 'config',
  txt: 'text'
};

/** Extension → response MIME for sandbox artifact downloads/previews. */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  bz2: 'application/x-bzip2',
  xz: 'application/x-xz',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  tsx: 'text/plain; charset=utf-8'
};

/** Derive the UI file kind from a file name (defaults to plain text). */
export function fileKind(name: string): AgentFileKind {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return 'text';
  }
  const ext = name.slice(dot + 1).toLowerCase();
  return KIND_BY_EXT[ext] ?? 'text';
}

/** Derive the HTTP Content-Type for a sandbox artifact download. */
export function contentTypeForAgentFile(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return 'application/octet-stream';
  }
  const ext = name.slice(dot + 1).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

/** Human-readable byte size, for example "1.2 KB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * HOME == the project dir, so npm/git/shell drop machine-generated caches
 * straight into the workspace. They are not the user's files and they churn (npm
 * alone writes ~900 files during an install), so they are hidden — both from the
 * tree and from the watcher's change stream. Matched per path segment.
 */
const HIDDEN_HOME_CACHE = new Set([
  '.npm',
  '.cache',
  '.local',
  '.config',
  '.node-gyp',
  '.bash_history',
  '.node_repl_history',
  '.python_history',
  '.wget-hsts',
  '.tmp'
]);

/**
 * Workspace dir holding user-uploaded context files. Surfaced in a SEPARATE UI
 * section (not the normal project tree) via {@link splitFileTrees}.
 */
export const CONTEXT_UPLOAD_DIR = '_uploads';

/** Sidecar suffix for an uploaded image's text description (hidden from the UI). */
const CONTEXT_SIDECAR_SUFFIX = '._context.txt';

/**
 * Whether a changed/listed path is hidden noise that should not surface in the
 * file tree. Machine-generated HOME caches ({@link HIDDEN_HOME_CACHE}) and the
 * generated image text-description sidecars are hidden; every real project
 * dotfile (.gitignore, .env, .github, ...) IS shown.
 */
export function isHiddenAgentPath(filePath: string): boolean {
  if (filePath.endsWith(CONTEXT_SIDECAR_SUFFIX)) {
    return true;
  }
  return filePath.split('/').some((segment) => HIDDEN_HOME_CACHE.has(segment));
}

/** Whether a path lives under the uploaded-context dir ({@link CONTEXT_UPLOAD_DIR}). */
function isContextUploadPath(filePath: string): boolean {
  return (
    filePath === CONTEXT_UPLOAD_DIR ||
    filePath.startsWith(`${CONTEXT_UPLOAD_DIR}/`)
  );
}

interface MutableNode {
  node: AgentFileNode;
  children: Map<string, MutableNode>;
}

function makeFolder(id: string, name: string): MutableNode {
  return {
    node: { id, name, type: 'folder', updatedAtLabel: '', children: [] },
    children: new Map()
  };
}

/**
 * Build a sorted {@link AgentFileNode} tree from a flat sandbox snapshot
 * (workspace-relative POSIX path → size/mtime). Hidden paths are pruned; folders
 * sort before files, then alphabetically.
 */
export function buildFileTree(snapshot: FileSnapshot): AgentFileNode[] {
  const root = makeFolder('', '');

  for (const [path, stat] of snapshot) {
    if (isHiddenAgentPath(path)) {
      continue;
    }
    const segments = path.split('/').filter(Boolean);
    let cursor = root;
    let acc = '';
    for (let i = 0; i < segments.length; i++) {
      const name = segments[i];
      acc = acc ? `${acc}/${name}` : name;
      const isLeaf = i === segments.length - 1;
      if (isLeaf) {
        cursor.children.set(name, {
          node: {
            id: acc,
            name,
            type: 'file',
            kind: fileKind(name),
            sizeLabel: formatSize(stat.size),
            updatedAtLabel: ''
          },
          children: new Map()
        });
      } else {
        let next = cursor.children.get(name);
        if (!next || next.node.type !== 'folder') {
          next = makeFolder(acc, name);
          cursor.children.set(name, next);
        }
        cursor = next;
      }
    }
  }

  const collect = (folder: MutableNode): AgentFileNode[] => {
    const entries = [...folder.children.values()];
    entries.sort((a, b) => {
      if (a.node.type !== b.node.type) {
        return a.node.type === 'folder' ? -1 : 1;
      }
      return a.node.name.localeCompare(b.node.name);
    });
    return entries.map((entry) => {
      if (entry.node.type === 'folder') {
        return { ...entry.node, children: collect(entry) };
      }
      return entry.node;
    });
  };

  return collect(root);
}

/**
 * Split one sandbox snapshot into the normal project tree and the uploaded
 * context-file tree. The `_uploads/` dir is pulled out for the UI's separate
 * "context files" section; everything else forms the project tree. The context
 * nodes are the `_uploads` folder's children flattened to the top level (so
 * they render without the wrapper folder) while KEEPING their full path in
 * `id` so the download route still resolves them. Both reuse
 * {@link buildFileTree}, which already prunes hidden paths (incl. sidecars).
 */
export function splitFileTrees(snapshot: FileSnapshot): {
  nodes: AgentFileNode[];
  contextNodes: AgentFileNode[];
} {
  const projectSnapshot: FileSnapshot = new Map();
  const contextSnapshot: FileSnapshot = new Map();
  for (const [path, stat] of snapshot) {
    if (isContextUploadPath(path)) {
      contextSnapshot.set(path, stat);
    } else {
      projectSnapshot.set(path, stat);
    }
  }
  const uploadFolder = buildFileTree(contextSnapshot).find(
    (node) => node.id === CONTEXT_UPLOAD_DIR && node.type === 'folder'
  );
  return {
    nodes: buildFileTree(projectSnapshot),
    contextNodes: uploadFolder?.children ?? []
  };
}

/** Strip a trailing slash the sandbox uses to mark directories. */
export function normalizeChangePath(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Coalesce a raw watcher batch into UI changes: drop hidden noise, normalize
 * directory paths, and keep the last kind seen per path (created > updated,
 * deleted wins).
 */
export function coalesceChanges(
  batch: { path: string; kind: AgentFileChange['kind'] }[]
): AgentFileChange[] {
  const pending = new Map<string, AgentFileChange['kind']>();
  for (const change of batch) {
    // The sandbox marks directories with a trailing slash. A bare directory
    // create/update needs no node of its own — the folder shows up from the
    // file paths under it; emitting it would add a stray FILE node named like
    // the directory. Directory deletes still pass so the folder subtree is
    // removed.
    const isDirectory = change.path.endsWith('/');
    const path = normalizeChangePath(change.path);
    // Uploaded context files live in their own UI section, fed by a full-tree
    // refresh after upload — keep them out of the normal live change stream.
    if (!path || isHiddenAgentPath(path) || isContextUploadPath(path)) {
      continue;
    }
    if (isDirectory && change.kind !== 'deleted') {
      continue;
    }
    const previous = pending.get(path);
    if (change.kind === 'deleted') {
      pending.set(path, 'deleted');
    } else if (change.kind === 'created') {
      pending.set(path, 'created');
    } else {
      pending.set(path, previous === 'created' ? 'created' : 'updated');
    }
  }
  return [...pending].map(([path, kind]) => ({ path, kind }));
}
