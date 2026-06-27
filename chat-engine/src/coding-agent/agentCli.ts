import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { ChatClient, ChatStatus } from '../ChatClient.js';
import { ChatAgent, AgentToolCall, QueuedItem } from '../ChatAgent.js';
import { LmStudioChatApiClient } from '../LmStudioChatApiClient.js';
import { bundleTools } from '../tools/types.js';
import {
  compactMessages,
  getContextUsage,
  applySummaryToMessages,
  stripThinkingFromMessages,
  summarizeIncremental,
} from '../ContextManager.js';
import { ChatStreamGuardError } from '../ChatApiError.js';
import {
  createCodingTools,
  CODING_TOOL_NAMES,
  CODING_AGENT_SYSTEM_PROMPT,
  CODING_AGENT_ACT_NUDGE,
} from './codingTools.js';
import { diffSnapshots } from '../sandbox/diffSnapshots.js';
import type {
  Sandbox,
  FileSnapshot,
  FileChange,
  SandboxWatcher,
} from '../sandbox/Sandbox.js';
import { createPlanController } from './planMode.js';
import { color } from './colors.js';

/** Turn-boundary hook for optional workspace mode switching. */
export interface WorkspaceHook {
  onTurnStart(promptTexts: readonly string[]): void;
  prepareTurn?(): Promise<void>;
  onTurnComplete(): void;
}

const RESERVED_OUTPUT_TOKENS = 4096;

const SUMMARY_SYSTEM_PROMPT = [
  "You compress an agent's conversation history into a compact summary.",
  'Produce a SELF-CONTAINED summary (merging the existing summary, if any, with',
  'the new transcript) that the agent can rely on to keep working on the task.',
  'Preserve, concisely: the user goals/requirements, decisions made, files',
  'created or edited and the key changes, important identifiers (functions,',
  'paths, symbols), commands run and their outcomes, what was tried and failed',
  'and why, and any open problems or next steps. Drop chit-chat and verbose tool',
  'output. Be strictly factual — do not invent. Keep it under ~400 words.',
].join('\n');

const SUMMARY_THRESHOLD_RATIO = 0.7;
const SUMMARY_RECENT_KEEP = 12;

/**
 * Hide dotfile noise from file-change reports, except `.tmp` document outputs.
 */
function isHiddenChangePath(filePath: string): boolean {
  if (filePath === '.tmp' || filePath.startsWith('.tmp/')) return false;
  return filePath.split('/').some((segment) => segment.startsWith('.'));
}

export interface CodingAgentCliOptions {
  sandbox: Sandbox;
  workspace?: WorkspaceHook | null;
  onExit?: () => void;
  workingDirLabel: string;
  systemPromptSuffix?: string;
}

/** Shared interactive coding-agent CLI loop. */
export async function runCodingAgentCli(
  options: CodingAgentCliOptions
): Promise<void> {
  const {
    sandbox,
    workspace = null,
    onExit,
    workingDirLabel,
    systemPromptSuffix,
  } = options;
  const imageRoot = process.cwd();

  const plan = createPlanController((message) => console.log(message));
  const { definitions, handlers } = bundleTools([
    ...createCodingTools(sandbox),
    ...plan.tools,
  ]);

  const apiClient = new LmStudioChatApiClient({
    apiBaseUrl: 'http://localhost:1234/',
    apiKey: null,
    model: 'qwen/qwen3.6-35b-a3b',
    tools: definitions,
    streamGuard: {
      maxReasoningCharsWithoutOutput: 60000,
      maxDurationMs: 300000,
    },
  });
  const client = new ChatClient(apiClient);
  client.setSystemPrompt({
    role: 'system',
    content: systemPromptSuffix
      ? `${CODING_AGENT_SYSTEM_PROMPT}\n\n${systemPromptSuffix}`
      : CODING_AGENT_SYSTEM_PROMPT,
  });

  let maxContext: number | null = null;
  try {
    maxContext = await apiClient.getMaxContextLength();
  } catch {
    maxContext = null;
  }

  // Compact only the outgoing request; the stored conversation remains intact.
  client.setOutgoingMessageTransform((messages) => {
    const condensed = applySummaryToMessages(
      stripThinkingFromMessages(messages),
      agent.getCompactionState()
    );
    if (maxContext === null) return condensed;
    const result = compactMessages(condensed, {
      maxContextTokens: maxContext,
      reservedOutputTokens: RESERVED_OUTPUT_TOKENS,
      compactThresholdRatio: 0.8,
      targetRatio: 0.6,
      recentMessagesToKeep: 12,
    });
    if (result.compacted) {
      const pct = Math.round((result.estimatedTokensAfter / maxContext) * 100);
      console.log(
        color.note(
          `\n[context] compacted ~${result.estimatedTokensBefore} → ~${result.estimatedTokensAfter} tokens (~${pct}% of the ${maxContext}-token window) to avoid overflow`
        )
      );
    }
    return result.messages;
  });

  const summarizerApi = new LmStudioChatApiClient({
    apiBaseUrl: 'http://localhost:1234/',
    apiKey: null,
    model: 'qwen/qwen3.6-35b-a3b',
    tools: [],
    streamGuard: {
      maxReasoningCharsWithoutOutput: 60000,
      maxDurationMs: 300000,
    },
  });
  const runSummarize = async ({
    previousSummary,
    conversationText,
  }: {
    previousSummary: string;
    conversationText: string;
  }): Promise<string> => {
    console.log(
      color.note(
        '\n[context] summarizing earlier conversation to free up space…'
      )
    );
    const userPrompt = [
      previousSummary
        ? `Existing summary so far:\n${previousSummary}`
        : 'There is no existing summary yet.',
      '',
      'New conversation transcript to fold in:',
      conversationText,
      '',
      'Return ONLY the updated summary.',
    ].join('\n');
    try {
      const res = await summarizerApi.chatStream([
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ]);
      return typeof res.content === 'string' ? res.content.trim() : '';
    } catch (error) {
      console.log(
        color.note(
          `[context] summarization skipped: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      return '';
    }
  };

  const printChanges = (changes: readonly FileChange[]): void => {
    const visible = changes.filter(
      (change) => !isHiddenChangePath(change.path)
    );
    if (visible.length === 0) return;
    const mark = { created: '+', updated: '~', deleted: '-' } as const;
    const rendered = [...visible]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((change) => {
        const label = `${mark[change.kind]}${change.path}`;
        if (change.kind === 'created') return color.answer(label);
        if (change.kind === 'deleted') return color.error(label);
        return color.status(label);
      });
    console.log('\n' + color.status('[files] ') + rendered.join('  '));
  };

  // Prefer live file events; fall back to snapshot diffs when unavailable.
  let watcher: SandboxWatcher | null = null;
  if (typeof sandbox.watch === 'function') {
    const pending = new Map<string, FileChange['kind']>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = (): void => {
      flushTimer = null;
      const batch = [...pending].map(([path, kind]) => ({ path, kind }));
      pending.clear();
      printChanges(batch);
    };
    watcher = sandbox.watch((event) => {
      const previous = pending.get(event.path);
      if (event.kind === 'deleted') pending.set(event.path, 'deleted');
      else if (event.kind === 'created') pending.set(event.path, 'created');
      else
        pending.set(event.path, previous === 'created' ? 'created' : 'updated');
      if (!flushTimer) flushTimer = setTimeout(flush, 400);
    });
  }

  let lastSnapshot: FileSnapshot | null = null;
  const safeSnapshot = async (): Promise<FileSnapshot | null> => {
    try {
      return await sandbox.snapshot();
    } catch {
      return null;
    }
  };
  const reportIncrementalChanges = async (): Promise<void> => {
    if (!lastSnapshot) return;
    const now = await safeSnapshot();
    if (!now) return;
    const changes = diffSnapshots(lastSnapshot, now);
    lastSnapshot = now;
    printChanges(changes);
  };
  const fileAffectingTools = new Set<string>([
    CODING_TOOL_NAMES.bash,
    CODING_TOOL_NAMES.write_file,
    CODING_TOOL_NAMES.str_replace,
  ]);

  const agent = new ChatAgent(client, {
    drainStrategy: 'sequential',
    drainQueuedAtToolBoundary: true,
    autoContinueOnEmpty: 3,
    nudgeOnTextOnlyTurn: {
      maxNudges: 1,
      instruction: CODING_AGENT_ACT_NUDGE,
      actionToolNames: ['str_replace', 'write_file'],
    },
    beforeTurn: async (c) => {
      await workspace?.prepareTurn?.();
      if (!watcher) lastSnapshot = await safeSnapshot();
      if (maxContext === null) return;
      const state = agent.getCompactionState();
      const result = await summarizeIncremental(c.getMessages(), {
        maxContextTokens: maxContext,
        compactThresholdRatio: SUMMARY_THRESHOLD_RATIO,
        recentMessagesToKeep: SUMMARY_RECENT_KEEP,
        previousSummary: state.summary,
        coveredCount: state.coveredCount,
        summarize: runSummarize,
      });
      if (!result.summarized) return;
      agent.setCompactionState({
        summary: result.summary,
        coveredCount: result.coveredCount,
      });
      const pct = Math.round(
        (result.estimatedOutgoingTokensAfter / maxContext) * 100
      );
      console.log(
        color.note(
          `[context] summarized ${result.summarizedMessageCount} old message(s) → ~${result.estimatedOutgoingTokensAfter} tokens (~${pct}% of the ${maxContext}-token window); full history preserved`
        )
      );
    },
    executeTool: async (toolCall: AgentToolCall, context) => {
      const { name, arguments: rawArgs } = toolCall.function;
      const handler = handlers.get(name);
      if (!handler) {
        return { approved: true, result: { error: `Unknown tool: ${name}` } };
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = rawArgs ? JSON.parse(rawArgs) : {};
      } catch {
        return {
          approved: true,
          result: { error: `Invalid JSON arguments: ${rawArgs}` },
        };
      }
      const blocked = plan.guard(name, parsed);
      if (blocked) {
        console.log(color.note(`\n[blocked: ${name}] ${blocked.error}`));
        return { approved: true, result: blocked };
      }
      if (!plan.isPlanTool(name)) {
        console.log(color.tool(`\n[tool: ${name}] ${rawArgs}`));
      }
      const result = await handler(parsed, { signal: context.signal });
      plan.observe(name, parsed, result);
      if (!watcher && fileAffectingTools.has(name)) {
        await reportIncrementalChanges();
      }
      return { approved: true, result };
    },
  });

  // Print the answer header lazily because content can arrive before status.
  let answerHeaderPending = true;
  const writeAnswerHeader = (): void => {
    if (!answerHeaderPending) {
      return;
    }
    answerHeaderPending = false;
    process.stdout.write(color.status('\n[answer] '));
  };
  agent.onMessage((message: string) => {
    writeAnswerHeader();
    process.stdout.write(color.answer(message));
  });
  agent.onThinking((message: string) =>
    process.stdout.write(color.thinking(message))
  );
  agent.onReasoning((message: string) =>
    process.stdout.write(color.thinking(message))
  );
  agent.onStatus((status: ChatStatus) => {
    if (status === 'tool_call') {
      answerHeaderPending = true;
      process.stdout.write(color.status('\n[deciding which tool to use...]\n'));
    } else if (status === 'reasoning') {
      answerHeaderPending = true;
      process.stdout.write(color.status('\n[thinking...]\n'));
    }
  });

  const itemLabel = (item: QueuedItem): string => {
    const text = plan.displayTask(item.text).trim();
    const imageMark = (item.imageUrls?.length ?? 0) > 0 ? '(image) ' : '';
    return `${imageMark}${text || (imageMark ? '(image only)' : '')}`.trim();
  };

  const joinLabels = (items: readonly QueuedItem[]): string =>
    items.map(itemLabel).join(' | ');

  const printQueue = (queue: readonly QueuedItem[]): void => {
    if (queue.length === 0) {
      console.log(color.queue('  (queue empty)'));
      return;
    }
    for (const item of queue) {
      console.log(
        color.queue(
          `  [${item.status}] ${item.id.slice(0, 8)} ${itemLabel(item)}`
        )
      );
    }
  };

  agent.onTurnStart((items) => {
    answerHeaderPending = true;
    plan.syncTurn(items.map((i) => i.text));
    workspace?.onTurnStart(items.map((i) => plan.displayTask(i.text)));
    const label = plan.isActive() ? 'plan task start' : 'task start';
    console.log(color.task(`\n[${label}] ${joinLabels(items)}`));
  });
  agent.onTurnComplete((items, result) => {
    plan.endTurn();
    workspace?.onTurnComplete();
    const content = result.assistantMessage?.content;
    const answer = typeof content === 'string' ? content.trim() : '';
    if (!answer) {
      process.stdout.write(
        color.note(
          '\n[note] The model did not produce a final answer (it stopped mid-thinking or returned an empty turn). Make your instruction more specific and resend it.\n'
        )
      );
    }
    console.log(color.task(`\n[task done] ${joinLabels(items)}`));
  });
  agent.onError((error, items) => {
    plan.endTurn();
    console.error(
      color.error(`\n[task error] "${joinLabels(items)}": ${error.message}`)
    );
    if (error instanceof ChatStreamGuardError) {
      console.error(
        color.note(
          '[hint] Aborted because the model kept thinking without finishing (thinking loop). Send the instruction again, or break it into smaller, more specific pieces and resend.'
        )
      );
    }
  });
  agent.onIdle(() =>
    console.log(color.status('\n[idle — waiting for instructions]'))
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const printContextUsage = (): void => {
    const usage = getContextUsage(client.getMessages(), {
      maxContextTokens: maxContext,
      reservedOutputTokens: RESERVED_OUTPUT_TOKENS,
    });
    if (usage.maxContextTokens === null) {
      console.log(
        color.note(
          `[context] ~${usage.estimatedTokens} tokens used (model context window unknown)`
        )
      );
      return;
    }
    const percent = Math.round((usage.usedRatio ?? 0) * 100);
    console.log(
      color.status(
        `[context] ~${usage.estimatedTokens}/${usage.maxContextTokens} tokens used (${percent}%), ~${usage.remainingTokens} left for input`
      )
    );
  };

  console.log(
    color.status(`Coding agent ready. Working directory: ${workingDirLabel}`)
  );
  if (maxContext !== null) {
    console.log(color.status(`Model context window: ${maxContext} tokens`));
    console.log(
      color.status(
        `Auto-summary: at ~${Math.round(SUMMARY_THRESHOLD_RATIO * 100)}% full, older turns are folded into a rolling summary (truncation is the backstop).`
      )
    );
  }
  console.log(
    color.status(
      'Type an instruction and press Enter. Commands: /exit, /queue, /context, /plan <task>, /image <path> [text]'
    )
  );
  console.log(
    color.status(
      '  /plan <task>: investigate first, present a plan for your approval, then implement it (progress shown as a live checklist).'
    )
  );
  console.log(
    color.status(
      '  /image <path> [text]: attach an image (png/jpg/jpeg/webp) to the prompt — needs a vision model loaded.'
    )
  );

  rl.on('line', (line) => {
    const input = line.trim();
    if (plan.routeInput(input)) {
      return;
    }
    if (input === '/exit') {
      rl.close();
      return;
    }
    if (input === '/queue') {
      printQueue(agent.getQueue());
      return;
    }
    if (input === '/context') {
      printContextUsage();
      return;
    }
    if (input === '/image' || input.startsWith('/image ')) {
      const imageMatch = /^\/image\s+(\S+)\s*(.*)$/s.exec(input);
      if (!imageMatch) {
        console.log(color.note('Usage: /image <path> [text]'));
        return;
      }
      const imagePath = path.resolve(imageRoot, imageMatch[1]);
      const text = imageMatch[2].trim();
      if (!fs.existsSync(imagePath)) {
        console.log(color.note(`Image not found: ${imagePath}`));
        return;
      }
      const id = agent.submit(text, [imagePath]);
      const label = text || '(image only)';
      console.log(
        agent.isRunning()
          ? color.queue(`[queued ${id.slice(0, 8)}] (image) ${label}`)
          : color.task(`[image ${id.slice(0, 8)}] ${label}`)
      );
      return;
    }
    if (input === '') {
      return;
    }
    const planMatch = /^\/plan\s+(.+)$/s.exec(input);
    if (planMatch) {
      const task = planMatch[1].trim();
      if (task.length === 0) {
        console.log(color.note('Usage: /plan <task>'));
        return;
      }
      const id = agent.submit(plan.wrapTask(task));
      console.log(
        agent.isRunning()
          ? color.queue(`[queued ${id.slice(0, 8)} · plan] ${task}`)
          : color.plan(`[plan ${id.slice(0, 8)}] ${task}`)
      );
      return;
    }
    const id = agent.submit(input);
    if (agent.isRunning()) {
      console.log(color.queue(`[queued ${id.slice(0, 8)}] ${input}`));
    }
  });

  rl.on('close', async () => {
    console.log(color.note('\nDraining queue before exit...'));
    await agent.waitForIdle();
    watcher?.stop();
    onExit?.();
    process.exit(0);
  });
}
