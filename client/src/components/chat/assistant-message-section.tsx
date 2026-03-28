import { ReactNode } from 'react';
import { AssistantMessage } from './assistant-message';
import { AssistantMessageActions } from './assistant-message-actions';
import { ToolCallSection } from './tool-call-section';
import { ToolCallItem } from './tool-call-section';
import type { ToolCallInfo } from './tool-call-section';
import { ThinkingBlock } from './thinking-block';
import { Skeleton } from '@/components/ui/skeleton';
import type { MessagePart } from '@/state/chatTypes';

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  openai: 'OpenAI'
};

function formatModelLabel(
  model?: string | null,
  provider?: string | null
): string {
  if (!model) return '-';
  const providerLabel = provider
    ? (PROVIDER_DISPLAY_NAMES[provider] ?? provider)
    : null;
  return providerLabel ? `${providerLabel} / ${model}` : model;
}

interface AssistantMessageSectionProps {
  message?: ReactNode;
  thinkingContent?: string;
  modelName?: string | null;
  providerType?: string | null;
  currentCount?: number;
  totalCount?: number;
  skeleton?: boolean;
  isStreaming?: boolean;
  toolCalls?: ToolCallInfo[];
  contentParts?: MessagePart[];
  onRetry?: () => void;
  onCopy?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

export function AssistantMessageSection({
  message = '',
  thinkingContent,
  modelName,
  providerType,
  currentCount = 1,
  totalCount = 1,
  skeleton = false,
  isStreaming = false,
  toolCalls,
  contentParts,
  onRetry,
  onCopy,
  onPrevious,
  onNext
}: AssistantMessageSectionProps) {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(String(message));
    if (onCopy) {
      onCopy();
    }
  };

  if (skeleton) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[95%]" />
        <Skeleton className="h-4 w-[90%]" />
        <Skeleton className="h-4 w-[85%]" />
      </div>
    );
  }

  // Build a lookup map for tool calls by ID
  const toolCallMap = new Map<string, ToolCallInfo>();
  if (toolCalls) {
    for (const tc of toolCalls) {
      toolCallMap.set(tc.toolCallId, tc);
    }
  }

  const hasChronologicalParts =
    contentParts && contentParts.length > 0 && toolCallMap.size > 0;

  return (
    <>
      <span className="text-xs text-muted-foreground">
        {formatModelLabel(modelName, providerType)}
      </span>
      {thinkingContent && (
        <ThinkingBlock
          content={thinkingContent}
          isStreaming={isStreaming && !message}
        />
      )}
      {hasChronologicalParts ? (
        // Render parts in chronological order
        contentParts.map((part, index) => {
          if (part.type === 'toolCall') {
            const tc = toolCallMap.get(part.toolCallId);
            if (!tc) return null;
            return (
              <div key={part.toolCallId} className="mb-1.5">
                <ToolCallItem toolCall={tc} />
              </div>
            );
          }
          return (
            <AssistantMessage key={`text-${index}`}>
              {part.content}
            </AssistantMessage>
          );
        })
      ) : (
        // Fallback: original order (toolCalls first, then text)
        <>
          {toolCalls && toolCalls.length > 0 && (
            <ToolCallSection toolCalls={toolCalls} />
          )}
          <AssistantMessage>{message}</AssistantMessage>
        </>
      )}
      <AssistantMessageActions
        isVisible={!isStreaming}
        currentCount={currentCount}
        totalCount={totalCount}
        onRetry={onRetry}
        onCopy={handleCopy}
        onPrevious={onPrevious}
        onNext={onNext}
      />
    </>
  );
}
