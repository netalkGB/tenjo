import { ReactNode } from 'react';
import { MarkdownRenderer } from './markdown-renderer';

interface AssistantMessageProps {
  children: ReactNode;
  messageId?: string;
  isStreaming?: boolean;
}

export function AssistantMessage({
  children,
  messageId,
  isStreaming
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
        />
      </div>
    </div>
  );
}
