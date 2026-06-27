import { ReactNode } from 'react';
import { MarkdownRenderer, ResolvedFileLink } from './markdown-renderer';

interface AssistantMessageProps {
  children: ReactNode;
  messageId?: string;
  isStreaming?: boolean;
  /** See {@link MarkdownRenderer}'s resolveFileLink. */
  resolveFileLink?: (href: string) => ResolvedFileLink | null;
  /** See {@link MarkdownRenderer}'s onOpenLocalUrl. */
  onOpenLocalUrl?: (url: string) => void;
}

export function AssistantMessage({
  children,
  messageId,
  isStreaming,
  resolveFileLink,
  onOpenLocalUrl
}: AssistantMessageProps) {
  if (typeof children !== 'string') {
    return (
      <div data-testid="assistant-message-content">
        <div>{children}</div>
      </div>
    );
  }

  return (
    <div data-testid="assistant-message-content">
      <div>
        <MarkdownRenderer
          markdown={children}
          messageId={messageId}
          isStreaming={isStreaming}
          resolveFileLink={resolveFileLink}
          onOpenLocalUrl={onOpenLocalUrl}
        />
      </div>
    </div>
  );
}
