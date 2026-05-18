import { useEffect, useState } from 'react';
import { Check, Code2, Copy, Download, Eye, Loader2, X } from 'lucide-react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import hljs from 'highlight.js/lib/core';
import cssLang from 'highlight.js/lib/languages/css';
import javascriptLang from 'highlight.js/lib/languages/javascript';
import htmlLang from 'highlight.js/lib/languages/xml';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { copyTextToClipboard } from '@/lib/clipboard';
import { generateRandomId } from '@/lib/generateRandomId';
import { useTranslation } from '@/hooks/useTranslation';
import { usePreview } from '@/hooks/usePreview';

const COPY_CONFIRMATION_TIMEOUT_MS = 2000;

// Register the HTML grammar plus the sub-languages it delegates to so embedded
// <style> and <script> blocks pick up CSS/JS highlighting automatically.
hljs.registerLanguage('xml', htmlLang);
hljs.registerLanguage('css', cssLang);
hljs.registerLanguage('javascript', javascriptLang);

type PreviewView = 'preview' | 'source';

function downloadAsHtmlFile(content: string): void {
  const filename = `${generateRandomId()}.html`;
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function HtmlPreviewPanel() {
  const { preview, closePreview } = usePreview();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [isIframeLoaded, setIsIframeLoaded] = useState(false);
  const [view, setView] = useState<PreviewView>('preview');

  // Reset the loading overlay and active tab whenever the previewed content
  // changes so the user always lands on the rendered view first.
  useEffect(() => {
    setIsIframeLoaded(false);
    setView('preview');
  }, [preview?.content]);

  if (!preview) return null;

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(preview.content);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_CONFIRMATION_TIMEOUT_MS);
    } catch {
      // clipboard API failure is non-critical
    }
  };

  const highlightedSource = hljs.highlight(preview.content, {
    language: 'xml'
  }).value;

  return (
    <TabsPrimitive.Root
      value={view}
      onValueChange={value => setView(value as PreviewView)}
      className="flex flex-col h-full bg-background"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4">
        <span className="text-sm font-medium truncate">{preview.title}</span>
        <TabsPrimitive.List className="flex items-center gap-1 rounded-md bg-muted p-0.5">
          <TabsPrimitive.Trigger
            value="preview"
            title={t('preview')}
            aria-label={t('preview')}
            className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm cursor-pointer"
          >
            <Eye className="size-4" />
          </TabsPrimitive.Trigger>
          <TabsPrimitive.Trigger
            value="source"
            title={t('source')}
            aria-label={t('source')}
            className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm cursor-pointer"
          >
            <Code2 className="size-4" />
          </TabsPrimitive.Trigger>
        </TabsPrimitive.List>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleCopy}
                aria-label={t('copy_source_code')}
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {copied ? t('copied') : t('copy_source_code')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => downloadAsHtmlFile(preview.content)}
                aria-label={t('download')}
              >
                <Download className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('download')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={closePreview}
                aria-label={t('close_preview')}
              >
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('close_preview')}</TooltipContent>
          </Tooltip>
        </div>
      </header>
      <div className="relative flex-1 min-h-0">
        <TabsPrimitive.Content
          value="preview"
          forceMount
          // Keep the iframe mounted across tab switches so the rendered page
          // does not reload (and lose runtime state) every time the user peeks
          // at the source. Absolute fill keeps the layout independent of
          // Radix's own display handling on Tabs.Content.
          className="absolute inset-0 data-[state=inactive]:hidden"
        >
          <iframe
            title={preview.title}
            srcDoc={preview.content}
            sandbox="allow-scripts"
            onLoad={() => setIsIframeLoaded(true)}
            className="absolute inset-0 w-full h-full border-0 bg-white"
          />
          {!isIframeLoaded && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 text-sm text-muted-foreground pointer-events-none">
              <Loader2 className="size-4 animate-spin" />
              <span>{t('loading')}</span>
            </div>
          )}
        </TabsPrimitive.Content>
        <TabsPrimitive.Content
          value="source"
          className="absolute inset-0 overflow-auto data-[state=inactive]:hidden"
        >
          <pre className="m-0 p-4 text-xs leading-relaxed [&>code.hljs]:bg-transparent [&>code.hljs]:p-0">
            <code
              className="hljs language-xml whitespace-pre"
              dangerouslySetInnerHTML={{ __html: highlightedSource }}
            />
          </pre>
        </TabsPrimitive.Content>
      </div>
    </TabsPrimitive.Root>
  );
}
