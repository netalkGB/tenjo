import { useEffect, useRef, useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

const COLLAPSED_MAX_HEIGHT = 72; // ~3 lines of text

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

export function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom while streaming
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mb-3">
      <div className="border-l-2 border-muted-foreground/30 pl-3">
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <ChevronRight
            className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          />
          <span>{isStreaming ? t('thinking') : t('thought')}</span>
          {isStreaming && (
            <span className="inline-flex gap-0.5">
              <span className="animate-pulse">.</span>
              <span className="animate-pulse [animation-delay:200ms]">.</span>
              <span className="animate-pulse [animation-delay:400ms]">.</span>
            </span>
          )}
        </CollapsibleTrigger>

        {/* Collapsed: fixed-height scrollable area */}
        {!isOpen && (
          <div
            ref={isOpen ? undefined : scrollRef}
            style={{ maxHeight: COLLAPSED_MAX_HEIGHT }}
            className="mt-1 overflow-y-auto rounded bg-muted/40 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed"
          >
            {content}
          </div>
        )}

        {/* Expanded: full content scrollable area */}
        <CollapsibleContent>
          <div
            ref={isOpen ? scrollRef : undefined}
            className="mt-1 max-h-96 overflow-y-auto rounded bg-muted/40 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed"
          >
            {content}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
