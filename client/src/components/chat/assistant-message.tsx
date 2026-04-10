import { ReactNode } from 'react';
import { MarkdownRenderer } from './markdown-renderer';

interface AssistantMessageProps {
  children: ReactNode;
}

export function AssistantMessage({ children }: AssistantMessageProps) {
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
        <MarkdownRenderer markdown={children} />
      </div>
    </div>
  );
}
