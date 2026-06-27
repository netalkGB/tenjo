import { useState } from 'react';
import {
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Terminal
} from 'lucide-react';
import { parse as parsePartialJson, Allow } from 'partial-json';
import { useTranslation } from '@/hooks/useTranslation';
import { fencedCode } from '@/lib/codeFence';
import { MarkdownRenderer } from './markdown-renderer';
import type { ToolCallInfo } from './tool-call-section';

interface CodeExecutionResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  durationMs?: number;
  error?: string;
}

function extractCode(args: Record<string, unknown> | undefined): string {
  const code = args?.code;
  return typeof code === 'string' ? code : '';
}

/**
 * Extracts the `code` field from a streaming, possibly-incomplete JSON object
 * using the `partial-json` parser, which tolerates truncated strings/objects.
 */
function extractStreamingCode(partial: string | undefined): string {
  if (!partial) return '';
  try {
    const parsed: unknown = parsePartialJson(partial, Allow.ALL);
    if (parsed && typeof parsed === 'object' && 'code' in parsed) {
      const code = (parsed as { code: unknown }).code;
      return typeof code === 'string' ? code : '';
    }
    return '';
  } catch {
    return '';
  }
}

function asResult(value: unknown): CodeExecutionResult | null {
  if (!value || typeof value !== 'object') return null;
  return value as CodeExecutionResult;
}

interface CodeExecutionToolCallProps {
  toolCall: ToolCallInfo;
}

export function CodeExecutionToolCall({
  toolCall
}: CodeExecutionToolCallProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  const isStreaming = toolCall.status === 'streaming';
  const streamingCode = isStreaming
    ? extractStreamingCode(toolCall.streamingArgsText)
    : '';
  // While streaming, prefer the decoded `code` value if extractable, otherwise
  // fall back to the raw partial JSON so the user always sees text flowing in.
  const code = isStreaming
    ? streamingCode || (toolCall.streamingArgsText ?? '')
    : extractCode(toolCall.toolArgs);
  const codeLanguage = isStreaming && !streamingCode ? 'json' : 'javascript';
  const result = asResult(toolCall.result);
  const isRunning = toolCall.status === 'calling' || isStreaming;

  const statusIcon = isRunning ? (
    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
  ) : toolCall.success ? (
    <CheckCircle2 className="h-4 w-4 text-green-500" />
  ) : (
    <XCircle className="h-4 w-4 text-red-500" />
  );

  const statusText = isStreaming
    ? t('code_exec_generating')
    : isRunning
      ? t('code_exec_running')
      : toolCall.success
        ? t('code_exec_completed')
        : t('code_exec_failed');

  return (
    <div className="rounded-md border border-border bg-muted/20">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Terminal className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-xs">{t('code_exec_label')}</span>
        {statusIcon}
        <span className="ml-auto text-xs text-muted-foreground">
          {statusText}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border p-3">
          <section>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">
              {t('code_exec_source')}
            </div>
            {code ? (
              <MarkdownRenderer markdown={fencedCode(code, codeLanguage)} />
            ) : isStreaming ? (
              <div className="flex items-center gap-2 text-xs italic text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('code_exec_generating')}
              </div>
            ) : (
              <div className="text-xs italic text-muted-foreground">
                {t('code_exec_no_source')}
              </div>
            )}
          </section>

          {!isStreaming && (
            <section>
              <div className="mb-1 flex items-center justify-between text-xs font-semibold text-muted-foreground">
                <span>{t('code_exec_output')}</span>
                {result && !isRunning && <ResultBadge result={result} />}
              </div>
              <ConsoleOutput
                isRunning={isRunning}
                result={result}
                hasError={!toolCall.success}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ResultBadge({ result }: { result: CodeExecutionResult }) {
  const { t } = useTranslation();
  const parts: string[] = [];
  if (typeof result.exitCode === 'number') {
    parts.push(`exit=${result.exitCode}`);
  }
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  }
  if (typeof result.durationMs === 'number') {
    parts.push(`${result.durationMs}ms`);
  }
  if (result.timedOut) {
    parts.push(t('code_exec_timed_out'));
  }
  if (parts.length === 0) return null;
  return (
    <span className="font-mono text-[10px] text-muted-foreground">
      {parts.join(' · ')}
    </span>
  );
}

interface ConsoleOutputProps {
  isRunning: boolean;
  result: CodeExecutionResult | null;
  hasError: boolean;
}

function ConsoleOutput({ isRunning, result, hasError }: ConsoleOutputProps) {
  const { t } = useTranslation();

  if (isRunning) {
    return (
      <div className="rounded bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-400">
        <Loader2 className="mr-2 inline h-3 w-3 animate-spin" />
        {t('code_exec_running')}
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded bg-zinc-950 px-3 py-2 font-mono text-xs italic text-zinc-500">
        {t('code_exec_no_output')}
      </div>
    );
  }

  if (result.error && !result.stdout && !result.stderr) {
    return <MarkdownRenderer markdown={fencedCode(result.error, 'error')} />;
  }

  const hasStdout = !!result.stdout;
  const hasStderr = !!result.stderr;

  if (!hasStdout && !hasStderr) {
    return (
      <div className="rounded bg-zinc-950 px-3 py-2 font-mono text-xs italic text-zinc-500">
        {hasError ? t('code_exec_failed') : t('code_exec_no_output')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {result.stdout && (
        <MarkdownRenderer markdown={fencedCode(result.stdout, 'stdout')} />
      )}
      {result.stderr && (
        <MarkdownRenderer markdown={fencedCode(result.stderr, 'stderr')} />
      )}
    </div>
  );
}
