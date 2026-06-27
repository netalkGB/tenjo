import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Code2,
  Cog,
  Download,
  FileArchive,
  File as FileIcon,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Folder,
  FolderOpen,
  Loader2,
  Paperclip,
  Presentation,
  Trash2
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { AgentFileKind, AgentFileNode, PREVIEWABLE_KINDS } from './types';
import type { FileHighlight } from '@/contexts/agent-reducer';
import { agentFileDownloadUrl, agentWorkspaceZipUrl } from '@/api/server/agent';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<AgentFileKind, typeof FileIcon> = {
  code: Code2,
  pdf: FileText,
  docx: FileText,
  pptx: Presentation,
  xlsx: FileSpreadsheet,
  json: Cog,
  markdown: FileText,
  image: FileImage,
  audio: FileMusic,
  video: FileVideoCamera,
  archive: FileArchive,
  config: Cog,
  text: FileIcon
};

const HIGHLIGHT_TRANSITION_CLASS: Record<FileHighlight, string> = {
  edited: 'transition-colors duration-[1500ms] ease-out',
  added: 'transition-[background-color,transform] duration-[1500ms] ease-out',
  deleted: 'transition-[opacity,transform] duration-[900ms] ease-in'
};

const HIGHLIGHT_ACTIVE_CLASS: Record<FileHighlight, string> = {
  edited: 'bg-primary/35',
  added: '-translate-x-1 bg-green-500/40',
  deleted: 'translate-x-0 bg-destructive/40 opacity-100'
};

const HIGHLIGHT_SETTLED_CLASS: Record<FileHighlight, string> = {
  edited: 'bg-transparent',
  added: 'translate-x-0 bg-transparent',
  deleted: 'translate-x-2 bg-destructive/40 opacity-0'
};

function highlightClass(
  highlight: FileHighlight | undefined,
  settled: boolean
): string {
  if (!highlight) {
    return '';
  }
  return cn(
    HIGHLIGHT_TRANSITION_CLASS[highlight],
    settled
      ? HIGHLIGHT_SETTLED_CLASS[highlight]
      : HIGHLIGHT_ACTIVE_CLASS[highlight]
  );
}

// Strongest-first: a folder with both an added and an edited child glows as
// "added". Used to surface a descendant change on its (possibly collapsed)
// ancestor folders.
const GLOW_PRIORITY: FileHighlight[] = ['added', 'edited', 'deleted'];

// Bulky / non-source folders that stay collapsed even at the root, where folders
// otherwise expand by default — dependencies and document scratch are noise to
// scroll past. Matched by folder name.
const COLLAPSED_BY_DEFAULT = new Set(['node_modules', '.tmp']);

/** The highest-priority highlight among a folder's descendants, if any. */
function descendantHighlight(
  node: AgentFileNode,
  highlights: Record<string, FileHighlight>
): FileHighlight | undefined {
  let best: FileHighlight | undefined;
  const visit = (current: AgentFileNode) => {
    const glow = highlights[current.id];
    if (
      glow &&
      (!best || GLOW_PRIORITY.indexOf(glow) < GLOW_PRIORITY.indexOf(best))
    ) {
      best = glow;
    }
    current.children?.forEach(visit);
  };
  node.children?.forEach(visit);
  return best;
}

interface FileTreeRowProps {
  node: AgentFileNode;
  depth: number;
  projectId: string;
  highlights: Record<string, FileHighlight>;
  /** When provided, file rows show a delete action wired to this (context files). */
  onDelete?: (id: string, name: string) => void;
  /** Opens an in-browser preview for supported kinds (PDF and source/text). */
  onPreview?: (path: string, name: string, kind: AgentFileKind) => void;
}

function FileTreeRow({
  node,
  depth,
  projectId,
  highlights,
  onDelete,
  onPreview
}: FileTreeRowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(
    depth === 0 && !COLLAPSED_BY_DEFAULT.has(node.name)
  );
  const indent = { paddingLeft: `${depth * 16 + 8}px` };
  // A folder surfaces a descendant change so a collapsed folder still shows that
  // something inside it was added/updated; its own highlight (for example delete) wins.
  const glow =
    highlights[node.id] ??
    (node.type === 'folder'
      ? descendantHighlight(node, highlights)
      : undefined);
  const [highlightSettled, setHighlightSettled] = useState(false);

  useEffect(() => {
    if (!glow) {
      setHighlightSettled(false);
      return;
    }

    setHighlightSettled(false);
    const frame = requestAnimationFrame(() => {
      setHighlightSettled(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [glow]);

  const glowClass = highlightClass(glow, highlightSettled);

  if (node.type === 'folder') {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              'group flex w-full items-center gap-2 py-1.5 pr-2 text-left hover:bg-accent/40',
              glowClass
            )}
            style={indent}
            data-testid={`agent-file-folder-${node.id}`}
          >
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-90'
              )}
            />
            {open ? (
              <FolderOpen className="size-4 shrink-0 text-foreground" />
            ) : (
              <Folder className="size-4 shrink-0 text-foreground" />
            )}
            <span className="truncate text-sm font-medium">{node.name}</span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {node.children?.length ?? 0}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {node.children?.map(child => (
            <FileTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              projectId={projectId}
              highlights={highlights}
              onDelete={onDelete}
              onPreview={onPreview}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  const kind = node.kind ?? 'text';
  const Icon = KIND_ICON[kind];
  const previewable = onPreview !== undefined && PREVIEWABLE_KINDS.has(kind);

  return (
    <div
      className={cn(
        'group flex items-center gap-2 py-1.5 pr-2 hover:bg-accent/40',
        glowClass
      )}
      style={indent}
      data-testid={`agent-file-${node.id}`}
    >
      <span className="size-3.5 shrink-0" aria-hidden />
      {previewable ? (
        <button
          type="button"
          className="flex min-w-0 cursor-pointer items-center gap-2 text-left hover:underline"
          onClick={() => onPreview?.(node.id, node.name, kind)}
          aria-label={t('agent_preview')}
          data-testid={`agent-file-preview-${node.id}`}
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm">{node.name}</span>
        </button>
      ) : (
        <>
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm">{node.name}</span>
        </>
      )}
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
        {node.sizeLabel}
      </span>
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 gap-1 px-2 opacity-0 transition-opacity group-hover:opacity-100"
        data-testid={`agent-file-download-${node.id}`}
        aria-label={t('agent_download')}
      >
        <a href={agentFileDownloadUrl(projectId, node.id)} download={node.name}>
          <Download className="size-3.5" />
        </a>
      </Button>
      {onDelete && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 px-2 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          data-testid={`agent-file-delete-${node.id}`}
          aria-label={t('delete')}
          onClick={() => onDelete(node.id, node.name)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

interface FileManagerProps {
  files: AgentFileNode[];
  /** User-uploaded context files (the `_uploads/` dir), shown in their own section. */
  contextFiles: AgentFileNode[];
  projectId: string;
  highlights: Record<string, FileHighlight>;
  /**
   * The file tree has not arrived yet (sandbox/pod still starting). Drives a
   * "please wait" state instead of the misleading "no files yet" empty message.
   */
  loading: boolean;
  /** Delete a context file (path, name) — wired to the context section's rows. */
  onDeleteContextFile: (path: string, name: string) => void;
  /** Opens the page-level preview dialog (shared with chat artifact links). */
  onPreview: (path: string, name: string, kind: AgentFileKind) => void;
}

function countFiles(nodes: AgentFileNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'file') {
      count += 1;
    } else if (node.children) {
      count += countFiles(node.children);
    }
  }
  return count;
}

export function FileManager({
  files,
  contextFiles,
  projectId,
  highlights,
  loading,
  onDeleteContextFile,
  onPreview
}: FileManagerProps) {
  const { t } = useTranslation();
  const total = countFiles(files);

  if (files.length === 0 && contextFiles.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground">
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            <span>{t('agent_files_loading')}</span>
          </>
        ) : (
          t('agent_no_artifacts')
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {contextFiles.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Paperclip className="size-3.5" />
            {t('agent_context_files')}
          </div>
          <div className="overflow-hidden rounded-md border bg-card">
            {contextFiles.map(node => (
              <FileTreeRow
                key={node.id}
                node={node}
                depth={0}
                projectId={projectId}
                highlights={highlights}
                onDelete={onDeleteContextFile}
                onPreview={onPreview}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {total} {t('agent_files_suffix')}
        </div>
        {total > 0 && (
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
            data-testid="agent-download-zip"
          >
            <a href={agentWorkspaceZipUrl(projectId)} download>
              <FileArchive className="size-3.5" />
              {t('agent_download_zip')}
            </a>
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        {files.map(node => (
          <FileTreeRow
            key={node.id}
            node={node}
            depth={0}
            projectId={projectId}
            highlights={highlights}
            onPreview={onPreview}
          />
        ))}
      </div>
    </div>
  );
}
