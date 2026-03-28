import { useState } from 'react';
import {
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  ShieldQuestion
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  result?: unknown;
  success?: boolean;
  status: 'calling' | 'completed' | 'pendingApproval';
  onApprove?: () => void;
  onReject?: () => void;
  onAutoApprove?: () => void;
}

interface ToolCallSectionProps {
  toolCalls: ToolCallInfo[];
}

export function ToolCallItem({ toolCall }: { toolCall: ToolCallInfo }) {
  const [open, setOpen] = useState(toolCall.status === 'pendingApproval');
  const { t } = useTranslation();

  const statusIcon =
    toolCall.status === 'pendingApproval' ? (
      <ShieldQuestion className="h-4 w-4 text-yellow-500" />
    ) : toolCall.status === 'calling' ? (
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    ) : toolCall.success ? (
      <CheckCircle2 className="h-4 w-4 text-green-500" />
    ) : (
      <XCircle className="h-4 w-4 text-red-500" />
    );

  const statusText =
    toolCall.status === 'pendingApproval'
      ? t('tool_approval_required')
      : toolCall.status === 'calling'
        ? t('tool_executing')
        : toolCall.success
          ? t('tool_completed')
          : t('tool_failed');

  return (
    <div
      className={`rounded-md border ${
        toolCall.status === 'pendingApproval'
          ? 'border-yellow-500/50 bg-yellow-500/5'
          : 'border-border bg-muted/30'
      }`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        {statusIcon}
        <span className="font-mono text-xs">{toolCall.toolName}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {statusText}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 text-xs">
          {toolCall.toolArgs && (
            <div className="mb-2">
              <div className="mb-1 font-semibold text-muted-foreground">
                {t('tool_args')}:
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono">
                {JSON.stringify(toolCall.toolArgs, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.status === 'pendingApproval' && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={toolCall.onApprove}>
                {t('tool_approve')}
              </Button>
              <Button size="sm" variant="outline" onClick={toolCall.onReject}>
                {t('tool_reject')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={toolCall.onAutoApprove}
              >
                {t('tool_auto_approve')}
              </Button>
            </div>
          )}
          {toolCall.result !== undefined && (
            <div>
              <div className="mb-1 font-semibold text-muted-foreground">
                {t('tool_result')}:
              </div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono">
                {JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolCallSection({ toolCalls }: ToolCallSectionProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {toolCalls.map(toolCall => (
        <ToolCallItem key={toolCall.toolCallId} toolCall={toolCall} />
      ))}
    </div>
  );
}
