import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';

interface ToolApprovalActionsProps {
  onApprove?: () => void;
  onReject?: () => void;
  onAutoApprove?: () => void;
}

/**
 * Approve / reject / always-allow buttons for a pending tool approval.
 * Shared by the chat view (ToolCallItem) and the agent view (AgentToolCard) so
 * both surfaces present the same decision UI for MCP tool calls.
 */
export function ToolApprovalActions({
  onApprove,
  onReject,
  onAutoApprove
}: ToolApprovalActionsProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex gap-2">
      <Button
        size="sm"
        onClick={onApprove}
        data-testid="tool-call-approve-button"
      >
        {t('tool_approve')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onReject}
        data-testid="tool-call-reject-button"
      >
        {t('tool_reject')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={onAutoApprove}
        data-testid="tool-call-auto-approve-button"
      >
        {t('tool_auto_approve')}
      </Button>
    </div>
  );
}
