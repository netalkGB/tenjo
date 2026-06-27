import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { useEffect, useRef, useState } from 'react';
import {
  Copy,
  Check,
  Play,
  Code2,
  ChevronDown,
  Download,
  Eye,
  Monitor
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { copyTextToClipboard } from '@/lib/clipboard';
import { remarkFileLinks } from '@/lib/remarkFileLinks';
import { useDialog } from '@/hooks/useDialog';
import { usePreview } from '@/hooks/usePreview';
import { useTranslation } from '@/hooks/useTranslation';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';

const COPY_CONFIRMATION_TIMEOUT_MS = 2000;
const LANGUAGE_PATTERN = /language-(\w+)/;

interface CodeBlockProps {
  children?: React.ReactNode;
  className?: string;
  node?: unknown;
  messageId?: string;
  isStreaming?: boolean;
}

/**
 * Recursively pulls plain text out of React children. Needed because
 * rehype-highlight replaces the original code text node with span elements,
 * so naive `String(children)` returns "[object Object]".
 */
function extractText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join('');
  }
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: React.ReactNode } }).props;
    return extractText(props?.children);
  }
  return '';
}

// Extract the document title from a (possibly partial) HTML string. Returns
// null when the <title> element has not finished streaming yet so callers can
// fall back to a translated placeholder.
function extractHtmlTitle(html: string): string | null {
  // Skip parsing until the closing tag has arrived; otherwise the HTML parser
  // would happily swallow everything up to EOF as the title content.
  if (!/<\/title\s*>/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.title.trim();
  return title.length > 0 ? title : null;
}

interface HtmlCardProps {
  code: string;
  className?: string;
  children?: React.ReactNode;
  isStreaming?: boolean;
  onPreview: () => void;
}

function HtmlCard({
  code,
  className,
  children,
  isStreaming,
  onPreview
}: HtmlCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(!!isStreaming);
  const prevStreamingRef = useRef(isStreaming);
  const sourceRef = useRef<HTMLPreElement>(null);
  const title = extractHtmlTitle(code) ?? t('html_untitled_document');

  // Auto-expand when streaming begins so the user can watch the source come
  // through, and auto-collapse the moment streaming ends to declutter the chat.
  useEffect(() => {
    if (prevStreamingRef.current === isStreaming) return;
    prevStreamingRef.current = isStreaming;
    setExpanded(!!isStreaming);
  }, [isStreaming]);

  // Keep the source view pinned to the latest content while streaming.
  useEffect(() => {
    if (!isStreaming) return;
    const el = sourceRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [code, isStreaming]);

  return (
    <Card className="not-prose @container my-4 flex-col items-stretch gap-0 p-0 shadow-none">
      <div className="flex items-center gap-3 p-3 select-none">
        <div className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-lg">
          <Code2 className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight">
            {title}
          </div>
          <div className="text-muted-foreground text-xs leading-tight mt-1">
            {t('html_card_subtitle')}
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onPreview}
          aria-label={t('open_preview')}
          className="cursor-pointer"
        >
          <Play />
          <span className="hidden @sm:inline">{t('preview')}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(prev => !prev)}
          aria-label={expanded ? t('collapse') : t('expand')}
          aria-expanded={expanded}
          className="cursor-pointer"
        >
          <span className="hidden @sm:inline">
            {expanded ? t('collapse') : t('expand')}
          </span>
          <ChevronDown
            className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </Button>
      </div>
      {expanded && (
        <div className="border-t">
          <pre
            ref={sourceRef}
            className={`mt-0! mb-0! rounded-none! overflow-auto p-0! text-xs! [&>code.hljs]:p-3! ${
              isStreaming ? 'max-h-28' : 'max-h-96'
            }`}
          >
            <code className={className}>{children}</code>
          </pre>
        </div>
      )}
    </Card>
  );
}

function CodeBlock({
  children,
  className,
  messageId,
  isStreaming
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const { openPreview } = usePreview();
  const { openDialog } = useDialog();
  const { t } = useTranslation();

  const match = LANGUAGE_PATTERN.exec(className || '');
  const language = match ? match[1] : '';
  const isPreviewable = language.toLowerCase() === 'html';

  const handleCopy = async () => {
    try {
      const code = extractText(children).replace(/\n$/, '');
      await copyTextToClipboard(code);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_CONFIRMATION_TIMEOUT_MS);
    } catch {
      // clipboard API failure is non-critical
    }
  };

  const handlePreview = () => {
    if (isStreaming) {
      openDialog({
        title: t('preview'),
        description: t('preview_disabled_streaming'),
        type: 'ok'
      });
      return;
    }
    const code = extractText(children).replace(/\n$/, '');
    openPreview({
      content: code,
      title: t('html_preview'),
      sourceMessageId: messageId ?? null
    });
  };

  // HTML output can be very long and dominates the chat view. Show it as a
  // compact card instead — the source lives in the preview pane's Source tab.
  if (isPreviewable) {
    return (
      <HtmlCard
        code={extractText(children).replace(/\n$/, '')}
        className={className}
        isStreaming={isStreaming}
        onPreview={handlePreview}
      >
        {children}
      </HtmlCard>
    );
  }

  return (
    <div className="relative group">
      <div className="flex items-center justify-between bg-zinc-800 px-3 py-1.5 rounded-t-md select-none">
        <span className="text-xs text-zinc-400 font-mono">
          {language || 'code'}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer select-none"
            aria-label={t('copy')}
          >
            {copied ? (
              <>
                <Check size={14} />
                <span>{t('copied')}</span>
              </>
            ) : (
              <>
                <Copy size={14} />
                <span>{t('copy')}</span>
              </>
            )}
          </button>
        </div>
      </div>
      <pre className="mt-0! rounded-t-none! p-0! [&>code.hljs]:p-3!">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function isInlineCode(className?: string): boolean {
  return !LANGUAGE_PATTERN.test(className || '');
}

/** A markdown href resolved to a downloadable artifact. */
export interface ResolvedFileLink {
  url: string;
  name: string;
  /** When set, clicking opens an in-app preview instead of downloading. */
  onOpen?: () => void;
}

/**
 * An http(s) URL on localhost — these point INSIDE the agent sandbox (a dev
 * server the agent started), so when `onOpenLocalUrl` is provided they open
 * the in-app GUI preview instead of navigating the user's own browser.
 */
const LOCAL_URL_PATTERN =
  /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/i;

/** Opens sandbox localhost URLs in the in-app preview. */
function LocalUrlPreviewLink({
  href,
  onOpen,
  label
}: {
  href: string;
  onOpen: (url: string) => void;
  label: string;
}) {
  return (
    <a
      href={href}
      className="mx-0.5 inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 align-middle text-sm font-medium no-underline transition-colors hover:bg-accent hover:text-accent-foreground"
      onClick={event => {
        event.preventDefault();
        onOpen(href);
      }}
    >
      <Monitor className="size-4" aria-hidden="true" />
      {label}
    </a>
  );
}

/**
 * A workspace-relative href: no URL scheme, not protocol-relative and not an
 * in-page anchor. Only these are offered to `resolveFileLink`.
 */
function isRelativeHref(href: string): boolean {
  return (
    !/^[a-z][a-z0-9+.-]*:/i.test(href) &&
    !href.startsWith('//') &&
    !href.startsWith('#')
  );
}

interface MarkdownRendererProps {
  markdown: string;
  messageId?: string;
  isStreaming?: boolean;
  /**
   * Maps a workspace-relative href to a downloadable artifact. When provided,
   * resolved links download the file and unresolved relative links render as
   * plain text (they would navigate nowhere in the SPA). External links are
   * unaffected.
   */
  resolveFileLink?: (href: string) => ResolvedFileLink | null;
  /**
   * Opens a localhost URL (a dev server inside the agent sandbox) in the GUI
   * preview. When provided, clicks on such links are intercepted.
   */
  onOpenLocalUrl?: (url: string) => void;
}

export function MarkdownRenderer({
  markdown,
  messageId,
  isStreaming,
  resolveFileLink,
  onOpenLocalUrl
}: MarkdownRendererProps) {
  const { t } = useTranslation();
  return (
    <div className="prose prose-base max-w-none dark:prose-invert prose-headings:font-bold prose-h1:text-4xl prose-h2:text-3xl prose-h3:text-2xl prose-h4:text-xl prose-p:my-5 prose-p:leading-relaxed prose-ul:my-5 prose-ol:my-5 prose-li:my-2 prose-table:my-6 prose-thead:bg-gray-100 dark:prose-thead:bg-gray-800 prose-th:border prose-th:border-gray-300 dark:prose-th:border-gray-600 prose-th:px-4 prose-th:py-2 prose-td:border prose-td:border-gray-300 dark:prose-td:border-gray-600 prose-td:px-4 prose-td:py-2">
      <ReactMarkdown
        remarkPlugins={
          // Auto-link bare/inline-code mentions of downloadable artifacts —
          // models don't reliably emit markdown links for generated files.
          resolveFileLink
            ? [remarkGfm, remarkMath, [remarkFileLinks, resolveFileLink]]
            : [remarkGfm, remarkMath]
        }
        rehypePlugins={[rehypeRaw, rehypeHighlight, rehypeKatex]}
        components={{
          code({ children: markdown, className, node, ...props }) {
            if (isInlineCode(className)) {
              // A localhost URL the model wrapped in backticks: still surface it
              // as a preview action (mirrors the anchor handler below).
              const text = extractText(markdown).trim();
              if (onOpenLocalUrl && LOCAL_URL_PATTERN.test(text)) {
                return (
                  <LocalUrlPreviewLink
                    href={text}
                    onOpen={onOpenLocalUrl}
                    label={t('markdown_open_in_preview')}
                  />
                );
              }
              return (
                <code className={className} {...props}>
                  {markdown}
                </code>
              );
            }

            return (
              <CodeBlock
                className={className}
                node={node}
                messageId={messageId}
                isStreaming={isStreaming}
              >
                {markdown}
              </CodeBlock>
            );
          },
          pre({ children: markdown }) {
            return <>{markdown}</>;
          },
          a({ children, href, ...props }) {
            if (href && onOpenLocalUrl && LOCAL_URL_PATTERN.test(href)) {
              return (
                <LocalUrlPreviewLink
                  href={href}
                  onOpen={onOpenLocalUrl}
                  label={t('markdown_open_in_preview')}
                />
              );
            }
            if (href && resolveFileLink && isRelativeHref(href)) {
              const file = resolveFileLink(href);
              if (!file) {
                return <span>{children}</span>;
              }
              if (file.onOpen) {
                // Previewable artifact: open the in-app preview dialog. The
                // href is kept so middle-click / "open in new tab" still
                // fetches the file directly.
                const open = file.onOpen;
                return (
                  <a
                    href={file.url}
                    className="mx-0.5 inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 align-middle text-sm font-medium no-underline transition-colors hover:bg-accent hover:text-accent-foreground"
                    onClick={event => {
                      event.preventDefault();
                      open();
                    }}
                    {...props}
                  >
                    <Eye className="size-4 self-center" aria-hidden="true" />
                    {file.name}
                  </a>
                );
              }
              return (
                <a
                  href={file.url}
                  download={file.name}
                  className="inline-flex items-baseline gap-1"
                  {...props}
                >
                  <Download className="size-4 self-center" aria-hidden="true" />
                  {file.name}
                </a>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          }
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
