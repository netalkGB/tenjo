import { useEffect, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  ShieldQuestion
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { CodeExecutionToolCall } from './code-execution-tool-call';
import { WebSearchToolCall } from './web-search-tool-call';
import type { SubAgentActivityInfo } from './sub-agent-activity';

const CODE_EXECUTION_TOOL_NAME = 'tenjo_execute_code';
const BROWSER_DELEGATE_TOOL_NAME = 'tenjo_browser_agent';

interface BuiltInTool {
  /** i18n key used as the user-facing label in place of the raw tool name. */
  labelKey: string;
  /**
   * Optional custom renderer. When omitted the generic {@link ToolCallItem}
   * is used and the label above replaces the raw name in its header.
   */
  render?: (
    toolCall: ToolCallInfo,
    activities?: SubAgentActivityInfo[]
  ) => ReactNode;
}

// Single registry of all in-process / built-in tools. The raw tool names
// (`tenjo_*`) are implementation detail and must never appear in the UI;
// resolve through this map instead.
const BUILT_IN_TOOLS: Record<string, BuiltInTool> = {
  [CODE_EXECUTION_TOOL_NAME]: {
    labelKey: 'code_exec_label',
    render: tc => <CodeExecutionToolCall toolCall={tc} />
  },
  [BROWSER_DELEGATE_TOOL_NAME]: {
    labelKey: 'web_search',
    render: (tc, activities) => (
      <WebSearchToolCall toolCall={tc} activities={activities} />
    )
  }
};

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  // Raw partial JSON of arguments while the LLM is still streaming the call.
  // Cleared once the full arguments are parsed into `toolArgs`.
  streamingArgsText?: string;
  result?: unknown;
  success?: boolean;
  status: 'streaming' | 'calling' | 'completed' | 'pendingApproval';
  onApprove?: () => void;
  onReject?: () => void;
  onAutoApprove?: () => void;
}

interface ToolCallSectionProps {
  toolCalls: ToolCallInfo[];
  subAgentActivities?: SubAgentActivityInfo[];
}

export function ToolCallItem({ toolCall }: { toolCall: ToolCallInfo }) {
  const [open, setOpen] = useState(toolCall.status === 'pendingApproval');
  const { t } = useTranslation();

  // Auto-open when the tool call transitions into pendingApproval after mount.
  useEffect(() => {
    if (toolCall.status === 'pendingApproval') {
      setOpen(true);
    }
  }, [toolCall.status]);

  const statusIcon =
    toolCall.status === 'pendingApproval' ? (
      <ShieldQuestion className="h-4 w-4 text-yellow-500" />
    ) : toolCall.status === 'calling' || toolCall.status === 'streaming' ? (
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    ) : toolCall.success ? (
      <CheckCircle2 className="h-4 w-4 text-green-500" />
    ) : (
      <XCircle className="h-4 w-4 text-red-500" />
    );

  const statusText =
    toolCall.status === 'pendingApproval'
      ? t('tool_approval_required')
      : toolCall.status === 'streaming'
        ? t('tool_streaming')
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
        <span className="font-mono text-xs">
          {BUILT_IN_TOOLS[toolCall.toolName]
            ? t(BUILT_IN_TOOLS[toolCall.toolName].labelKey)
            : toolCall.toolName}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {statusText}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 text-xs">
          {toolCall.toolArgs ? (
            <div className="mb-2">
              <div className="mb-1 font-semibold text-muted-foreground">
                {t('tool_args')}:
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono">
                {JSON.stringify(toolCall.toolArgs, null, 2)}
              </pre>
            </div>
          ) : toolCall.streamingArgsText ? (
            <div className="mb-2">
              <div className="mb-1 font-semibold text-muted-foreground">
                {t('tool_args')}:
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono">
                {toolCall.streamingArgsText}
              </pre>
            </div>
          ) : null}
          {toolCall.status === 'pendingApproval' && (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={toolCall.onApprove}
                data-testid="tool-call-approve-button"
              >
                {t('tool_approve')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={toolCall.onReject}
                data-testid="tool-call-reject-button"
              >
                {t('tool_reject')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={toolCall.onAutoApprove}
                data-testid="tool-call-auto-approve-button"
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

function renderToolCall(tc: ToolCallInfo, activities?: SubAgentActivityInfo[]) {
  const builtIn = BUILT_IN_TOOLS[tc.toolName];
  if (builtIn?.render) return builtIn.render(tc, activities);
  return <ToolCallItem toolCall={tc} />;
}

export function ToolCallSection({
  toolCalls,
  subAgentActivities
}: ToolCallSectionProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {toolCalls.map(toolCall => (
        <div key={toolCall.toolCallId}>
          {renderToolCall(toolCall, subAgentActivities)}
        </div>
      ))}
    </div>
  );
}
