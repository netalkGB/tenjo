import type { Tool } from '../tools/types.js';
import { color } from './colors.js';

/**
 * Plan mode for the coding agent.
 *
 * `/plan <task>` starts read-only, asks the model to present a structured plan,
 * then unlocks editing after approval. Normal tasks bypass this controller.
 */

export type PlanPhase = 'research' | 'approved';

const EDITING_TOOLS = new Set(['write_file', 'str_replace']);

/**
 * Shell commands considered read-only, used to gate `bash` during the research
 * phase only. This is a heuristic allow-list, not a security sandbox: it keeps
 * the model honest about "investigate before editing" without trying to defend
 * against a deliberately adversarial command.
 */
const READ_ONLY_COMMANDS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'find',
  'fd',
  'tree',
  'pwd',
  'echo',
  'printf',
  'stat',
  'file',
  'which',
  'type',
  'du',
  'df',
  'env',
  'date',
  'whoami',
  'hostname',
  'uname',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'sort',
  'uniq',
  'cut',
  'tr',
  'column',
  'nl',
  'diff',
  'cmp',
  'jq',
  'test',
  'true',
  'false',
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'ls-files',
  'rev-parse',
  'blame',
  'cat-file',
  'describe',
  'shortlog',
  'reflog',
  'grep',
]);

const READ_ONLY_DPKG_ARGS = new Set([
  '-l',
  '--list',
  '-s',
  '--status',
  '-L',
  '--listfiles',
]);

const READ_ONLY_DPKG_QUERY_ARGS = new Set([
  '-l',
  '--list',
  '-s',
  '--status',
  '-L',
  '--listfiles',
  '-W',
  '--show',
]);

const READ_ONLY_APT_CACHE_SUBCOMMANDS = new Set([
  'search',
  'show',
  'policy',
  'madison',
  'depends',
  'rdepends',
  'pkgnames',
]);

const READ_ONLY_UPDATE_ALTERNATIVES_ARGS = new Set([
  '--list',
  '--query',
  '--display',
  '--get-selections',
]);

const READ_ONLY_PKG_CONFIG_ARGS = new Set([
  '--modversion',
  '--exists',
  '--print-errors',
  '--cflags',
  '--libs',
  '--libs-only-l',
  '--libs-only-L',
  '--libs-only-other',
  '--cflags-only-I',
  '--cflags-only-other',
  '--list-all',
]);

const READ_ONLY_APT_SUBCOMMANDS = new Set([
  'depends',
  'list',
  'policy',
  'rdepends',
  'search',
  'show',
]);

const READ_ONLY_VERSION_ARGS = new Set([
  '-v',
  '-V',
  '-version',
  '--version',
  'version',
]);

/**
 * A file-writing redirect (`> file`, `>> file`, `2> file`). `>&`/`2>&1` and
 * redirects to /dev/null are not file writes and are allowed.
 */
const FILE_WRITE_REDIRECT = />>?\s*(?!&|\/dev\/null\b)\S/;

const COMMAND_SUBSTITUTION = /\$\(|`/;

const commandName = (token: string): string =>
  (token.split('/').pop() ?? token).toLowerCase();

function stripReadOnlyRedirects(tokens: string[]): string[] {
  const cleanTokens: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1] ?? '';
    if (
      /^\d?>&\d$/.test(token) ||
      /^\d?>\/dev\/null$/.test(token) ||
      token === '</dev/null'
    ) {
      continue;
    }
    if (/^\d?>$/.test(token) && nextToken === '/dev/null') {
      i++;
      continue;
    }
    if (token === '<' && nextToken === '/dev/null') {
      i++;
      continue;
    }
    cleanTokens.push(token);
  }
  return cleanTokens;
}

function isReadOnlyVersionProbe(name: string, args: string[]): boolean {
  if (!name) {
    return false;
  }
  const cleanArgs = stripReadOnlyRedirects(args);
  return (
    cleanArgs.length > 0 &&
    cleanArgs.every((arg) => READ_ONLY_VERSION_ARGS.has(arg))
  );
}

function isReadOnlyPkgConfigProbe(args: string[]): boolean {
  const cleanArgs = stripReadOnlyRedirects(args);
  if (cleanArgs.length === 0) {
    return false;
  }
  const optionArgs = cleanArgs.filter((arg) => arg.startsWith('-'));
  if (optionArgs.length === 0) {
    return false;
  }
  return optionArgs.every(
    (arg) => READ_ONLY_PKG_CONFIG_ARGS.has(arg) || arg.startsWith('--variable=')
  );
}

function isReadOnlyToolchainProbe(name: string, args: string[]): boolean {
  const cleanArgs = stripReadOnlyRedirects(args);
  const first = cleanArgs[0] ?? '';

  switch (name) {
    case 'command':
      return ['-v', '-V'].includes(first);
    case 'apt':
      return READ_ONLY_APT_SUBCOMMANDS.has(first);
    case 'dpkg':
      return READ_ONLY_DPKG_ARGS.has(first);
    case 'dpkg-query':
      return READ_ONLY_DPKG_QUERY_ARGS.has(first);
    case 'apt-cache':
      return READ_ONLY_APT_CACHE_SUBCOMMANDS.has(first);
    case 'update-alternatives':
      return READ_ONLY_UPDATE_ALTERNATIVES_ARGS.has(first);
    case 'pkg-config':
      return isReadOnlyPkgConfigProbe(cleanArgs);
    default:
      return isReadOnlyVersionProbe(name, cleanArgs);
  }
}

/**
 * Best-effort check that a shell command only reads. Rejects write redirects and
 * command substitution outright, then requires every pipeline/sequence segment
 * to start with an allow-listed command (and, for `git`, a read-only
 * subcommand). Heuristic by design — see {@link READ_ONLY_COMMANDS}.
 */
function isReadOnlyBash(command: string): boolean {
  if (FILE_WRITE_REDIRECT.test(command) || COMMAND_SUBSTITUTION.test(command)) {
    return false;
  }
  const segments = command.split(/&&|\|\||\||;|\n/);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    // Skip leading environment assignments such as `FOO=bar cmd`.
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
      i++;
    }
    if (i >= tokens.length) {
      continue;
    }
    const name = commandName(tokens[i]);
    if (name === 'git') {
      const subcommand = (tokens[i + 1] ?? '').toLowerCase();
      if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
        return false;
      }
      continue;
    }
    if (isReadOnlyToolchainProbe(name, tokens.slice(i + 1))) {
      continue;
    }
    if (!READ_ONLY_COMMANDS.has(name)) {
      return false;
    }
  }
  return true;
}

const APPROVE_PATTERN = /^(y|yes|approve|ok)$/i;

const BARE_REJECT_PATTERN = /^(n|no|reject)$/i;

/**
 * First line of the wrapped plan-mode prompt. A task is recognised as a plan
 * task purely by its prompt starting with this marker — there is no separate id
 * bookkeeping to keep in sync, so detection cannot race the agent's pump (which
 * fires onTurnStart synchronously inside submit() when the agent is idle).
 */
const PLAN_MARKER = 'PLAN MODE — do not edit anything yet.';

const TASK_SEPARATOR = '\n\nTask:\n';

const PLAN_INSTRUCTION = [
  PLAN_MARKER,
  'First investigate only what is needed to make a correct plan. For an existing',
  'project, use read_file and read-only bash commands (ls, cat, grep, find, git',
  'status/diff/log) to inspect relevant files. For a brand-new scaffold, do not',
  'run `ls` only to prove the directory is empty; assume the workspace is ready',
  'unless the task depends on existing files. Read-only toolchain checks are',
  'allowed during planning when they only query command existence, versions, or',
  'package metadata. Prefer `command -v <tool>` or package metadata for existence',
  "checks; if a version matters, use that tool's documented version command.",
  'Do not shotgun probe flags or add success sentinels such as `&& echo OK`.',
  'Installs and edits are still blocked until approval. The write_file and',
  'str_replace tools are BLOCKED until your plan is approved.',
  'If a required runtime, compiler, SDK, or package manager is missing, include',
  'installing it as an approved implementation step, then include compile/build',
  'and run verification. Do not downgrade the deliverable to source-only',
  'instructions or hand install/run commands to the user.',
  'When you understand the task, call present_plan with a concise, numbered list',
  'of the concrete steps you will take. Do NOT write the plan only as normal',
  'assistant text; the approval UI appears only when you call present_plan. The',
  'user will then approve the plan or send feedback. If they send feedback,',
  'revise the plan and call present_plan again. Only AFTER approval should you',
  'implement the plan with your editing tools.',
].join('\n');

/**
 * Follow-up instruction used when a plan-mode model describes a plan in normal
 * assistant text and stops.
 */
export const PLAN_MODE_PRESENT_PLAN_NUDGE = [
  'You are still in plan mode and editing is not approved yet.',
  'Your previous message may have described a plan in normal text, but that does',
  'not open the approval UI and does not count as presenting a plan.',
  'Call present_plan now with the concrete steps. Do not edit files or run',
  'non-read-only commands until present_plan returns approved.',
].join('\n');

/**
 * Recover the original task text from a (possibly wrapped) plan-mode prompt, for
 * display only. The wrapped form is still what the model sees.
 */
export function displayTask(text: string): string {
  if (!text.startsWith(PLAN_MARKER)) {
    return text;
  }
  const index = text.indexOf(TASK_SEPARATOR);
  return index >= 0 ? text.slice(index + TASK_SEPARATOR.length).trim() : text;
}

const PRESENT_PLAN_TOOL = 'present_plan';

const UPDATE_PLAN_TOOL = 'update_plan';

const fileBasename = (filePath: string): string =>
  (filePath.split(/[\\/]/).pop() ?? filePath).toLowerCase();

type PlanTodoStatus = 'pending' | 'in_progress' | 'completed';

interface PlanTodo {
  readonly text: string;
  status: PlanTodoStatus;
}

export interface PlanTodoView {
  /** Plan step text shown to the user. */
  text: string;
  /** Current step status. */
  status: PlanTodoStatus;
}

/**
 * Structured plan-mode events for a headless/web consumer.
 */
export interface PlanEvents {
  /** Called when the model presents a plan for approval. */
  onPlanPresented?(steps: string[], summary: string | null): void;
  /** Called when the approved-plan checklist changes. */
  onProgress?(todos: PlanTodoView[]): void;
  /** Called when the pending plan is approved or rejected. */
  onResolved?(approved: boolean): void;
}

const TODO_MARK: Record<PlanTodoStatus, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
};

const TODO_COLOR: Record<PlanTodoStatus, (text: string) => string> = {
  pending: color.queue,
  in_progress: color.tool,
  completed: color.answer,
};

const renderTodos = (todos: readonly PlanTodo[]): string => {
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const lines = [
    color.plan(`\n=== Plan progress (${done}/${todos.length}) ===`),
  ];
  todos.forEach((todo, index) => {
    lines.push(
      TODO_COLOR[todo.status](
        `  ${TODO_MARK[todo.status]} ${index + 1}. ${todo.text}`
      )
    );
  });
  return lines.join('\n');
};

export interface PlanController {
  /** Plan-mode tools exposed to the model. */
  readonly tools: readonly Tool[];
  /** Returns true for tools owned by plan mode. */
  isPlanTool(name: string): boolean;
  /** Updates plan progress from a completed tool call. */
  observe(
    toolName: string,
    args: Record<string, unknown>,
    result: unknown
  ): void;
  /** Wraps a raw task in the plan-mode instruction. */
  wrapTask(task: string): string;
  /** Returns the user-visible task text. */
  displayTask(text: string): string;
  /** Syncs plan-mode state with the next turn. */
  syncTurn(texts: readonly string[]): void;
  /** Clears all active plan-mode state. */
  endTurn(): void;
  /** Returns true while a plan task is active. */
  isActive(): boolean;
  /** Returns true while waiting for plan approval. */
  isAwaitingApproval(): boolean;
  /** Returns a block result when a tool call is not allowed. */
  guard(
    toolName: string,
    args: Record<string, unknown>
  ): { error: string } | null;
  /** Routes an input line to the pending approval prompt. */
  routeInput(line: string): boolean;
}

/**
 * Build a controller for both CLI output and optional structured events.
 */
export function createPlanController(
  print: (message: string) => void,
  events: PlanEvents = {}
): PlanController {
  let active = false;
  let phase: PlanPhase = 'research';
  let todos: PlanTodo[] = [];
  const seenEditPaths = new Set<string>();
  let modelReportedProgress = false;
  let pendingApproval: ((answer: string) => void) | null = null;

  const isPlanPrompt = (text: string): boolean => text.startsWith(PLAN_MARKER);

  const formatPlan = (steps: string[], summary: string | null): string => {
    const lines: string[] = ['', '=== Proposed plan ==='];
    if (summary) {
      lines.push(summary, '');
    }
    steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
    lines.push('');
    lines.push(
      'Approve this plan? (y = approve / anything else = reject and send feedback)'
    );
    return lines.join('\n');
  };

  const awaitApproval = (): Promise<string> =>
    new Promise<string>((resolve) => {
      pendingApproval = resolve;
    });

  const presentPlanTool: Tool = {
    definition: {
      type: 'function',
      function: {
        name: PRESENT_PLAN_TOOL,
        description:
          'Present a step-by-step plan to the user for approval before making any changes. Use this in plan mode once you have investigated only the context needed for the task. A plan written as normal assistant text does not open the approval UI; you must call this tool. The user either approves the plan or returns feedback; on feedback, revise the plan and call present_plan again. Do not edit files until the plan is approved.',
        parameters: {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Ordered list of the concrete steps you will perform.',
            },
            summary: {
              type: 'string',
              description:
                'Optional one-sentence summary of the overall approach.',
            },
          },
          required: ['steps'],
        },
      },
    },
    handler: async (args) => {
      if (!active) {
        return { error: 'present_plan is only available in plan mode.' };
      }
      if (phase === 'approved') {
        return {
          status: 'approved',
          message:
            'The plan is already approved. Keep implementing it with your editing tools; do not present the plan again.',
        };
      }
      const steps = Array.isArray(args.steps)
        ? args.steps.filter((step): step is string => typeof step === 'string')
        : [];
      if (steps.length === 0) {
        return { error: 'steps must be a non-empty array of strings.' };
      }
      const summary = typeof args.summary === 'string' ? args.summary : null;

      print(color.plan(formatPlan(steps, summary)));
      events.onPlanPresented?.(steps, summary);
      const answer = (await awaitApproval()).trim();

      if (APPROVE_PATTERN.test(answer)) {
        phase = 'approved';
        seenEditPaths.clear();
        modelReportedProgress = false;
        todos = steps.map((text) => ({ text, status: 'pending' as const }));
        todos[0].status = 'in_progress';
        print(color.plan('[plan approved — editing tools unlocked]'));
        print(renderTodos(todos));
        emitProgress();
        events.onResolved?.(true);
        return {
          status: 'approved',
          message:
            'The user approved the plan. Implement it now using your editing tools (the write_file and str_replace tools are unlocked). If planning found a missing runtime/compiler/package manager, install it inside the sandbox now before build/run verification — do not ask the user to install it locally. As you finish each step — including steps that are shell commands such as installing dependencies, building, or running — call update_plan with that step number so the user can watch real progress, and mark the final step complete when you are done.',
        };
      }

      print(color.plan('[plan rejected — revising]'));
      events.onResolved?.(false);
      const hasFeedback =
        answer.length > 0 && !BARE_REJECT_PATTERN.test(answer);
      return {
        status: 'changes_requested',
        feedback: hasFeedback ? answer : '(no specific feedback given)',
        message:
          'The user did not approve the plan. Revise it to address the feedback, then call present_plan again. Do not edit any files yet.',
      };
    },
  };

  const updatePlanTool: Tool = {
    definition: {
      type: 'function',
      function: {
        name: UPDATE_PLAN_TOOL,
        description:
          'Mark progress on the approved plan so the user can watch it advance. Call this as you work — including for steps that are shell commands (install, build, run) that leave no file edit to detect. Pass the 1-based number of the step you just finished (status defaults to "completed"); steps before it are treated as done. Optionally pass status "in_progress" for a step you are starting.',
        parameters: {
          type: 'object',
          properties: {
            step: {
              type: 'number',
              description: '1-based index of the plan step.',
            },
            status: {
              type: 'string',
              enum: ['in_progress', 'completed'],
              description: 'Status for that step. Defaults to "completed".',
            },
          },
          required: ['step'],
        },
      },
    },
    handler: async (args) => {
      if (!active || phase !== 'approved' || todos.length === 0) {
        return {
          error: 'update_plan is only available after a plan is approved.',
        };
      }
      const raw = typeof args.step === 'number' ? args.step : Number(args.step);
      if (!Number.isFinite(raw)) {
        return { error: 'step must be a 1-based step number.' };
      }
      const index = Math.min(Math.max(Math.trunc(raw), 1), todos.length) - 1;
      const status: PlanTodoStatus =
        args.status === 'in_progress' ? 'in_progress' : 'completed';
      modelReportedProgress = true;
      applyTodoProgress(index, status, true);
      const done = todos.filter((todo) => todo.status === 'completed').length;
      return {
        status: 'ok',
        progress: `${done}/${todos.length} steps complete`,
      };
    },
  };

  const emitProgress = (): void => {
    if (!events.onProgress) {
      return;
    }
    events.onProgress(todos.map((todo) => ({ ...todo })));
  };

  const applyTodoProgress = (
    index: number,
    status: PlanTodoStatus,
    monotonic: boolean
  ): void => {
    if (index < 0 || index >= todos.length) {
      return;
    }
    if (monotonic) {
      for (let i = 0; i < index; i++) {
        todos[i].status = 'completed';
      }
    }
    todos[index].status = status;
    if (status === 'completed') {
      const next = todos.findIndex((todo) => todo.status !== 'completed');
      if (next !== -1) {
        todos[next].status = 'in_progress';
      }
    }
    print(renderTodos(todos));
    emitProgress();
  };

  const advanceForEdit = (filePath: string): void => {
    const file = filePath ? fileBasename(filePath) : '';
    const named = file
      ? todos.findIndex(
          (todo) =>
            todo.status !== 'completed' &&
            todo.text.toLowerCase().includes(file)
        )
      : -1;
    const target =
      named !== -1
        ? named
        : todos.findIndex((todo) => todo.status !== 'completed');
    if (target === -1) {
      return;
    }
    applyTodoProgress(target, 'completed', true);
  };

  return {
    tools: [presentPlanTool, updatePlanTool],

    isPlanTool: (name) =>
      name === PRESENT_PLAN_TOOL || name === UPDATE_PLAN_TOOL,

    observe: (toolName, args, result) => {
      if (!active || phase !== 'approved' || todos.length === 0) {
        return;
      }
      if (modelReportedProgress) {
        return;
      }
      if (!EDITING_TOOLS.has(toolName)) {
        return;
      }
      if (result !== null && typeof result === 'object' && 'error' in result) {
        return;
      }
      const filePath = typeof args.path === 'string' ? args.path : '';
      if (filePath && seenEditPaths.has(filePath)) {
        return;
      }
      if (filePath) {
        seenEditPaths.add(filePath);
      }
      advanceForEdit(filePath);
    },

    wrapTask: (task) => `${PLAN_INSTRUCTION}${TASK_SEPARATOR}${task}`,

    displayTask: (text) => displayTask(text),

    syncTurn: (texts) => {
      active = texts.some(isPlanPrompt);
      phase = 'research';
      todos = [];
      seenEditPaths.clear();
      modelReportedProgress = false;
    },

    endTurn: () => {
      active = false;
      phase = 'research';
      todos = [];
      seenEditPaths.clear();
      modelReportedProgress = false;
      pendingApproval = null;
    },

    isActive: () => active,

    isAwaitingApproval: () => active && phase === 'research',

    guard: (toolName, args) => {
      if (!active || phase !== 'research') {
        return null;
      }
      if (EDITING_TOOLS.has(toolName)) {
        return {
          error:
            'Plan mode: editing is blocked until your plan is approved. Investigate with read_file/bash, then call present_plan.',
        };
      }
      if (toolName === 'bash') {
        const command = typeof args.command === 'string' ? args.command : '';
        if (command && !isReadOnlyBash(command)) {
          return {
            error:
              'Plan mode: only read-only shell commands are allowed until the plan is approved. File inspection, command-existence checks, version checks, and package-metadata queries are OK; installs, writes, and edits are not.',
          };
        }
      }
      return null;
    },

    routeInput: (line) => {
      if (!pendingApproval) {
        return false;
      }
      const resolve = pendingApproval;
      pendingApproval = null;
      resolve(line);
      return true;
    },
  };
}
