import { Loader2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export type ChatStatus =
  | 'toolExecuting'
  | 'processing'
  | 'generatingTitle'
  | 'analyzingImages'
  | null;

interface ChatStatusLineProps {
  status: ChatStatus;
}

export function ChatStatusLine({ status }: ChatStatusLineProps) {
  const { t } = useTranslation();

  if (!status) return null;

  const statusMessages: Record<NonNullable<ChatStatus>, string> = {
    toolExecuting: t('status_tool_executing'),
    processing: t('status_processing'),
    generatingTitle: t('status_generating_title'),
    analyzingImages: t('status_analyzing_images')
  };

  return (
    <div
      className="flex items-center gap-2 px-6 py-1.5 text-xs text-muted-foreground"
      data-testid={`chat-status-${status}`}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{statusMessages[status]}</span>
    </div>
  );
}
