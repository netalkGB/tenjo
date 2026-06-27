import { Clock, Paperclip, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export interface AgentQueuedMessage {
  id: string;
  text: string;
  fileCount: number;
}

interface AgentMessageQueueProps {
  items: AgentQueuedMessage[];
  onRemove: (id: string) => void;
}

/**
 * Messages the user has queued while the agent is still working. They are sent
 * in order once the agent becomes free.
 */
export function AgentMessageQueue({ items, onRemove }: AgentMessageQueueProps) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <div className="mb-2 space-y-1.5" data-testid="agent-message-queue">
      <div className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
        <Clock className="size-3.5" />
        <span>{t('agent_queue_title')}</span>
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] tabular-nums">
          {items.length}
        </span>
      </div>
      {items.map((item, index) => (
        <div
          key={item.id}
          className="group flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-sm"
          data-testid={`agent-queue-item-${item.id}`}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium text-muted-foreground">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {item.text || (
              <span className="text-muted-foreground">
                {t('agent_queue_attachment_only')}
              </span>
            )}
          </span>
          {item.fileCount > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
              <Paperclip className="size-3" />
              {item.fileCount}
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label={t('agent_queue_remove')}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            data-testid={`agent-queue-remove-${item.id}`}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
