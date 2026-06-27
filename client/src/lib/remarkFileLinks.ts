import type { ResolvedFileLink } from '@/components/chat/markdown-renderer';

/**
 * Remark plugin that auto-links file mentions in assistant prose. Models often
 * reference a generated artifact as inline code (`report.pdf`) or bare text
 * instead of a markdown link, so relying on the model to emit `[x](x)` is not
 * enough. This walks the mdast tree and wraps any mention that the resolver
 * recognizes as a downloadable artifact in a link node; the renderer's `a`
 * component then turns it into a download link. Fenced code blocks and
 * existing links are left untouched.
 */

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

/**
 * A path-looking token: word/unicode-letter characters (so non-ASCII file
 * names match) ending in a dot + short alphanumeric extension. Trailing
 * punctuation (for example `。`, a sentence-ending period) is excluded because the
 * extension must follow the final dot.
 */
const FILE_CANDIDATE = /[\p{L}\p{N}_./-]+\.[A-Za-z0-9]{1,8}/gu;

type Resolve = (href: string) => ResolvedFileLink | null;

function linkNode(path: string, children: MdNode[]): MdNode {
  return { type: 'link', url: path, children };
}

/** Split a text node around resolvable file mentions; null when none found. */
function splitTextNode(value: string, resolve: Resolve): MdNode[] | null {
  const result: MdNode[] = [];
  let last = 0;
  for (const match of value.matchAll(FILE_CANDIDATE)) {
    const candidate = match[0];
    if (!resolve(candidate)) {
      continue;
    }
    if (match.index > last) {
      result.push({ type: 'text', value: value.slice(last, match.index) });
    }
    result.push(linkNode(candidate, [{ type: 'text', value: candidate }]));
    last = match.index + candidate.length;
  }
  if (result.length === 0) {
    return null;
  }
  if (last < value.length) {
    result.push({ type: 'text', value: value.slice(last) });
  }
  return result;
}

function walk(parent: MdNode, resolve: Resolve): void {
  const children = parent.children;
  if (!children) {
    return;
  }
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    // Existing links keep their own target; fenced code blocks are verbatim.
    if (
      node.type === 'link' ||
      node.type === 'linkReference' ||
      node.type === 'code'
    ) {
      continue;
    }
    if (node.type === 'inlineCode' && typeof node.value === 'string') {
      if (resolve(node.value)) {
        children[i] = linkNode(node.value, [node]);
      }
      continue;
    }
    if (node.type === 'text' && typeof node.value === 'string') {
      const replaced = splitTextNode(node.value, resolve);
      if (replaced) {
        children.splice(i, 1, ...replaced);
        i += replaced.length - 1;
      }
      continue;
    }
    walk(node, resolve);
  }
}

/**
 * Usage: `remarkPlugins={[[remarkFileLinks, resolve]]}`. The generated link
 * urls are the workspace-relative paths themselves — the renderer's `a`
 * component resolves them to download URLs (and percent-encoding added by the
 * mdast→hast url normalization is undone by the resolver's decode).
 */
export function remarkFileLinks(resolve: Resolve) {
  return (tree: unknown): void => {
    walk(tree as MdNode, resolve);
  };
}
