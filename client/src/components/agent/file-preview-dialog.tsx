import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { agentFileDownloadUrl, getAgentFileBlob } from '@/api/server/agent';
import { fencedCode, languageFromPath } from '@/lib/codeFence';
import { MarkdownRenderer } from '@/components/chat/markdown-renderer';
import type { AgentFileKind } from './types';

export interface PreviewFile {
  /** Workspace-relative path of the artifact. */
  path: string;
  name: string;
  kind: AgentFileKind;
}

// Highlighting a multi-megabyte source freezes the tab, so refuse beyond this
// and point the user to the download action instead.
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;

// `html` would hit MarkdownRenderer's interactive HtmlCard branch; `xml` is the
// same highlight.js grammar without the card chrome.
function previewLanguage(name: string): string {
  const language = languageFromPath(name);
  if (language === 'html') return 'xml';
  return language || 'plaintext';
}

/** Unknown extensions fall back to the `text` kind, so a genuinely binary file
 * can reach the text path — detect it instead of rendering mojibake. */
function looksBinary(buffer: ArrayBuffer): boolean {
  return new Uint8Array(buffer.slice(0, 8192)).includes(0);
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'too-large' }
  | { status: 'pdf'; url: string }
  | { status: 'text'; markdown: string };

interface FilePreviewDialogProps {
  projectId: string;
  file: PreviewFile | null;
  onClose: () => void;
}

/**
 * Read-only preview of a sandbox artifact. PDFs render in the browser's
 * built-in viewer (Blob → object URL → iframe, so the session cookie applies);
 * source/text files render as a syntax-highlighted code block via the shared
 * Markdown pipeline.
 */
export function FilePreviewDialog({
  projectId,
  file,
  onClose
}: FilePreviewDialogProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<PreviewState>({ status: 'loading' });

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: 'loading' });
    const load = async () => {
      try {
        const blob = await getAgentFileBlob(projectId, file.path);
        if (cancelled) return;
        if (file.kind === 'pdf') {
          objectUrl = URL.createObjectURL(
            new Blob([blob], { type: 'application/pdf' })
          );
          setState({ status: 'pdf', url: objectUrl });
          return;
        }
        if (blob.size > MAX_TEXT_PREVIEW_BYTES) {
          setState({ status: 'too-large' });
          return;
        }
        const buffer = await blob.arrayBuffer();
        if (cancelled) return;
        if (looksBinary(buffer)) {
          setState({ status: 'failed' });
          return;
        }
        const text = new TextDecoder().decode(buffer);
        setState({
          status: 'text',
          markdown: fencedCode(text, previewLanguage(file.name))
        });
      } catch {
        if (!cancelled) setState({ status: 'failed' });
      }
    };
    load();
    return () => {
      cancelled = true;
      setState({ status: 'loading' });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, file]);

  return (
    <Dialog open={file !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent
        className="flex h-[min(90vh,100dvh-2rem)] w-[min(90vw,64rem)] flex-col gap-0 p-0 sm:max-w-[min(90vw,64rem)]"
        aria-describedby={undefined}
      >
        <DialogHeader className="flex-row items-center gap-2 border-b px-4 py-3 pr-12">
          <DialogTitle className="min-w-0 truncate text-sm font-medium">
            {file?.name}
          </DialogTitle>
          {file && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 px-2"
              data-testid="agent-file-preview-download"
            >
              <a
                href={agentFileDownloadUrl(projectId, file.path)}
                download={file.name}
              >
                <Download className="size-3.5" />
                {t('agent_download')}
              </a>
            </Button>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {state.status === 'failed' ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {t('agent_preview_failed')}
            </div>
          ) : state.status === 'too-large' ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {t('agent_preview_too_large')}
            </div>
          ) : state.status === 'pdf' ? (
            <iframe
              src={state.url}
              title={file?.name ?? 'PDF preview'}
              className="h-full w-full rounded-b-lg"
              data-testid="agent-file-preview-frame"
            />
          ) : state.status === 'text' ? (
            <div
              className="h-full overflow-auto p-3 [&_pre]:my-0!"
              data-testid="agent-file-preview-text"
            >
              <MarkdownRenderer markdown={state.markdown} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
