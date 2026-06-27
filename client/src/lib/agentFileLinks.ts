import { agentFileDownloadUrl } from '@/api/server/agent';
import {
  PREVIEWABLE_KINDS,
  type AgentFileKind,
  type AgentFileNode
} from '@/components/agent/types';
import type { ResolvedFileLink } from '@/components/chat/markdown-renderer';

export type FileLinkResolver = (href: string) => ResolvedFileLink | null;

/**
 * Build a resolver that maps a workspace-relative href from the agent's
 * markdown (for example `report.pdf`, `./out/chart.png`) to the sandbox download URL.
 * Returns null only for paths that don't exist in the current file tree, so any
 * actual sandbox file can be downloaded regardless of extension. When
 * `onPreview` is given, previewable kinds (PDF) open the in-app preview instead
 * of downloading.
 */
export function createAgentFileLinkResolver(
  projectId: string,
  fileTree: AgentFileNode[],
  onPreview?: (path: string, name: string, kind: AgentFileKind) => void
): FileLinkResolver {
  const byPath = new Map<string, AgentFileNode>();
  const byName = new Map<string, AgentFileNode | null>();
  const walk = (nodes: AgentFileNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'file') {
        byPath.set(node.id, node);
        const existing = byName.get(node.name);
        byName.set(node.name, existing === undefined ? node : null);
      }
      if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(fileTree);

  return href => {
    let path: string;
    try {
      // Markdown hrefs percent-encode spaces and non-ASCII filenames.
      path = decodeURIComponent(href);
    } catch {
      return null;
    }
    path = normalizeAgentFileHref(path);
    const node = byPath.get(path) ?? byName.get(path.split('/').pop() ?? '');
    const kind = node?.kind;
    if (!node) {
      return null;
    }
    const link: ResolvedFileLink = {
      url: agentFileDownloadUrl(projectId, node.id),
      name: node.name
    };
    if (onPreview && kind && PREVIEWABLE_KINDS.has(kind)) {
      link.onOpen = () => onPreview(node.id, node.name, kind);
    }
    return link;
  };
}

function normalizeAgentFileHref(href: string): string {
  const withoutCurrentDir = href.trim().replace(/^\.\//, '');
  if (withoutCurrentDir === '/workspace') {
    return '';
  }
  if (withoutCurrentDir.startsWith('/workspace/')) {
    return withoutCurrentDir.slice('/workspace/'.length);
  }
  return withoutCurrentDir.replace(/^\/+/, '');
}
