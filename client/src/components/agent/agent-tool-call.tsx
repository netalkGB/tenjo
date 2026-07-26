import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  FilePen,
  FilePlus,
  FileSearch,
  ListChecks,
  Loader2,
  ShieldQuestion,
  Terminal,
  Wrench,
  Zap
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { fencedCode, languageFromPath } from '@/lib/codeFence';
import { prettifyContextDir } from '@/lib/contextPath';
import { MarkdownRenderer } from '@/components/chat/markdown-renderer';
import { ToolApprovalActions } from '@/components/chat/tool-approval-actions';
import { cn } from '@/lib/utils';

const TOOL_ICON: Record<string, typeof Wrench> = {
  bash: Terminal,
  read_file: FileSearch,
  str_replace: FilePen,
  write_file: FilePlus,
  present_plan: ListChecks,
  update_plan: ListChecks,
  punch: Zap
};

/** One-line summary of a tool call's most relevant argument (header preview). */
function summarizeArgs(name: string, rawArgs: string): string {
  try {
    const args = JSON.parse(rawArgs) as Record<string, unknown>;
    if (name === 'bash' && typeof args.command === 'string') {
      return args.command;
    }
    if (name === 'punch' && typeof args.skill_name === 'string') {
      return args.skill_name;
    }
    if (name === 'update_plan' && typeof args.step === 'number') {
      const status =
        typeof args.status === 'string' ? args.status : 'completed';
      return `step ${args.step} → ${status}`;
    }
    if (typeof args.path === 'string') {
      return args.path;
    }
    return rawArgs;
  } catch {
    return rawArgs;
  }
}

interface ToolInput {
  /** Code/text body shown in the input section. */
  code: string;
  /** highlight.js language for the body (empty = plain). */
  language: string;
  /** Optional label (for example a file path) shown above the body. */
  label?: string;
}

// Fallback language so a code block always gets highlight.js's `.hljs` class —
// the dark terminal background only applies to highlighted blocks, so an empty
// language would render light and break the terminal look.
const PLAIN_LANGUAGE = 'plaintext';

/** Map a tool call's args to a syntax-highlightable input block. */
function toolInput(name: string, rawArgs: string): ToolInput {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    return { code: rawArgs, language: PLAIN_LANGUAGE };
  }
  if (name === 'bash' && typeof args.command === 'string') {
    return { code: args.command, language: 'bash' };
  }
  if (name === 'write_file' && typeof args.path === 'string') {
    const content = typeof args.content === 'string' ? args.content : '';
    return {
      code: content,
      language: languageFromPath(args.path) || PLAIN_LANGUAGE,
      label: args.path
    };
  }
  if (name === 'str_replace' && typeof args.path === 'string') {
    const oldStr = typeof args.old === 'string' ? args.old : '';
    const newStr = typeof args.new === 'string' ? args.new : '';
    const diff = [
      ...oldStr.split('\n').map(line => `- ${line}`),
      ...newStr.split('\n').map(line => `+ ${line}`)
    ].join('\n');
    return { code: diff, language: 'diff', label: args.path };
  }
  if (name === 'read_file' && typeof args.path === 'string') {
    return { code: args.path, language: PLAIN_LANGUAGE };
  }
  return { code: JSON.stringify(args, null, 2), language: 'json' };
}

export interface AgentToolCardProps {
  name: string;
  /** Raw JSON arguments string from the tool call. */
  args: string;
  /** Tool result text, once available. */
  result?: string;
  /** The call is still executing (no result yet and the task is busy). */
  pending: boolean;
  /** The call (an MCP tool) is waiting for the user's approval. */
  approvalPending?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onAutoApprove?: () => void;
}

/**
 * A coding-agent tool call rendered as a collapsible card: header with the tool
 * name, an argument preview and a status; expands to a syntax-highlighted input
 * block (command / file content / diff) and the result output — mirroring the
 * chat view's tool-call look (copy buttons come from {@link MarkdownRenderer}).
 */
export function AgentToolCard({
  name,
  args,
  result,
  pending,
  approvalPending = false,
  onApprove,
  onReject,
  onAutoApprove
}: AgentToolCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(approvalPending);
  // Auto-open when the call transitions into awaiting-approval after mount, so
  // the user sees the arguments they are deciding on (mirrors the chat view).
  useEffect(() => {
    if (approvalPending) {
      setOpen(true);
    }
  }, [approvalPending]);
  const Icon = TOOL_ICON[name] ?? Wrench;
  // Display-only: show the internal `_uploads` dir as the friendly label.
  const label = t('agent_context_files');
  const prettyArgs = prettifyContextDir(args, label);
  const prettyResult =
    result === undefined ? undefined : prettifyContextDir(result, label);
  const input = toolInput(name, prettyArgs);
  const hasOutput = !!prettyResult && prettyResult.trim().length > 0;

  return (
    <div
      className={cn(
        'my-1.5 rounded-md border',
        approvalPending
          ? 'border-yellow-500/50 bg-yellow-500/5'
          : 'border-border bg-muted/20'
      )}
      data-testid={`agent-tool-call-${name}`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
        onClick={() => setOpen(o => !o)}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
        />
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-mono text-xs font-medium">
          {name === 'punch' ? t('punch') : name}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {summarizeArgs(name, prettyArgs)}
        </span>
        {approvalPending ? (
          <ShieldQuestion className="size-4 shrink-0 text-yellow-500" />
        ) : pending ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-green-500" />
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {approvalPending
            ? t('tool_approval_required')
            : pending
              ? t('tool_executing')
              : t('tool_completed')}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border p-3">
          <section>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">
              {input.label ?? t('agent_tool_input')}
            </div>
            <div className="max-h-96 overflow-auto">
              <MarkdownRenderer
                markdown={fencedCode(input.code, input.language)}
              />
            </div>
          </section>

          {approvalPending && (
            <ToolApprovalActions
              onApprove={onApprove}
              onReject={onReject}
              onAutoApprove={onAutoApprove}
            />
          )}

          {hasOutput && (
            <section>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">
                {t('agent_tool_output')}
              </div>
              <div className="max-h-96 overflow-auto">
                <MarkdownRenderer
                  markdown={fencedCode(prettyResult ?? '', 'stdout')}
                />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
