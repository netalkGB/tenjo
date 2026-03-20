import { ReactNode } from 'react';
import { AssistantMessage } from './assistant-message';
import { AssistantMessageActions } from './assistant-message-actions';
import { ToolCallSection } from './tool-call-section';
import type { ToolCallInfo } from './tool-call-section';
import { ThinkingBlock } from './thinking-block';
import { Skeleton } from '@/components/ui/skeleton';

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

  return (
    <>
      {toolCalls && toolCalls.length > 0 && (
        <ToolCallSection toolCalls={toolCalls} />
      )}
      <span className="text-xs text-muted-foreground">
        {formatModelLabel(modelName, providerType)}
      </span>
      {thinkingContent && (
        <ThinkingBlock
          content={thinkingContent}
          isStreaming={isStreaming && !message}
        />
      )}
      <AssistantMessage>{message}</AssistantMessage>
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
