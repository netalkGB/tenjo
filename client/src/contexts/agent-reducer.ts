import type {
  AgentFileNode,
  AgentFileKind,
  AgentMode,
  AgentPlan,
  AgentPlanStep
} from '@/components/agent/types';
import type { AgentQueuedMessage } from '@/components/agent/agent-message-queue';
import type { SubAgentActivityInfo } from '@/components/chat/sub-agent-activity';
import type {
  AgentConnection,
  AgentMessageView,
  AgentMessagePlan,
  AgentProjectModel,
  AgentQueuedView,
  MessageData
} from '@/api/server/agent';

export type FileHighlight = 'edited' | 'added' | 'deleted';

/*
 * The server prunes this from snapshots, but live file-changed events can still
 * carry `.tenjo/...` paths before the next snapshot arrives.
 */
const HIDDEN_TREE_DIR = '.tenjo';
function isHiddenTreePath(path: string): boolean {
  return path === HIDDEN_TREE_DIR || path.startsWith(`${HIDDEN_TREE_DIR}/`);
}

/*
 * Client-side backstop for internal plan steps that may appear in live or
 * persisted plans.
 */
const INTERNAL_PLAN_STEP = /\.tenjo\b|dev[-_]?servers?\.json/i;
export function isInternalPlanStep(text: string): boolean {
  return INTERNAL_PLAN_STEP.test(text);
}

export interface SandboxStatus {
  status: 'unknown' | 'unavailable' | 'preparing' | 'ready';
  detail?: string;
}

export interface GuiStatus {
  status: 'unknown' | 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  detail?: string;
}

export interface PendingToolApproval {
  toolCallId: string;
  toolName: string;
  args: string;
}

export interface AgentQuestionOption {
  label: string;
  description?: string;
}

export interface PendingAgentQuestion {
  questionId: string;
  question: string;
  header?: string;
  options: AgentQuestionOption[];
  multiSelect: boolean;
}

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string;
  plan?: AgentPlan;
  toolCalls?: { id: string; name: string; args: string }[];
  toolResult?: { toolCallId: string; content: string };
}

/*
 * A frozen plan snapshot recorded when a step newly completed, anchored after
 * the message that was latest at that moment so it flows into the timeline.
 */
export interface PlanFlowEntry {
  id: string;
  afterMessageId: string | null;
  plan: AgentPlan;
}

export interface AgentState {
  messages: AgentChatMessage[];
  streaming: { content: string; thinking: string } | null;
  queue: AgentQueuedMessage[];
  plan: AgentPlan | null;
  planFlow: PlanFlowEntry[];
  fileTree: AgentFileNode[];
  // Whether the server has delivered the file tree at least once.
  fileTreeLoaded: boolean;
  contextFiles: AgentFileNode[];
  highlights: Record<string, FileHighlight>;
  pendingApprovals: PendingToolApproval[];
  pendingQuestions: PendingAgentQuestion[];
  // Live activity of the currently-running browser-research sub-agent.
  subAgentActivities: SubAgentActivityInfo[];
  status: string;
  mode: AgentMode;
  agentModel: AgentProjectModel | null;
  title: string | null;
  connection: AgentConnection;
  sandboxStatus: SandboxStatus;
  guiStatus: GuiStatus;
  // Whether the agent recorded a preview manifest.
  previewAvailable: boolean;
  previewKind: 'web' | 'gui' | null;
  // Counter bumped when the agent asks the client to auto-open the preview.
  autoPreviewLaunchSeq: number;
  // Non-blocking preview launch failure shown in the preview panel.
  previewLaunchError: string | null;
  // True while the agent is automatically repairing a failed preview launch.
  previewRepairActive: boolean;
}

export const initialAgentState: AgentState = {
  messages: [],
  streaming: null,
  queue: [],
  plan: null,
  planFlow: [],
  fileTree: [],
  fileTreeLoaded: false,
  contextFiles: [],
  highlights: {},
  pendingApprovals: [],
  pendingQuestions: [],
  subAgentActivities: [],
  status: 'idle',
  mode: 'plan',
  agentModel: null,
  title: null,
  connection: 'connecting',
  sandboxStatus: { status: 'unknown' },
  guiStatus: { status: 'unknown' },
  previewAvailable: false,
  previewKind: null,
  autoPreviewLaunchSeq: 0,
  previewLaunchError: null,
  previewRepairActive: false
};

export function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is { type: string; text: string } =>
          typeof part === 'object' &&
          part !== null &&
          (part as { type?: unknown }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string'
      )
      .map(part => part.text)
      .join('');
  }
  return '';
}

const TODO_TO_STEP: Record<string, AgentPlanStep['status']> = {
  pending: 'pending',
  in_progress: 'running',
  completed: 'done'
};

export function mapPlanTodosToSteps(
  todos: AgentMessagePlan['todos']
): AgentPlanStep[] {
  return todos
    .filter(todo => !isInternalPlanStep(todo.text))
    .map((todo, index) => ({
      id: `s${index}`,
      title: todo.text,
      status: TODO_TO_STEP[todo.status] ?? 'pending'
    }));
}

export function mapPlan(plan: AgentMessagePlan): AgentPlan {
  const steps = mapPlanTodosToSteps(plan.todos);
  return { id: 'plan', status: plan.status, steps };
}

/*
 * Freeze a progress snapshot: the first `done` steps are checked, the rest stay
 * pending (no step marked running, so a flowed past card never spins forever).
 */
function snapshotPlan(steps: AgentPlanStep[], done: number): AgentPlan {
  return {
    id: 'plan',
    status: steps.length > 0 && done >= steps.length ? 'done' : 'running',
    steps: steps.map((step, index) => ({
      ...step,
      status: index < done ? 'done' : 'pending'
    }))
  };
}

/*
 * Rebuild the per-step flow from a loaded message list: each message carries the
 * persisted plan snapshot as of when it was latest, so wherever the completed
 * count grows we flow a snapshot anchored to that message. This restores the
 * step-by-step flow when a task is reopened (live events aren't replayed).
 */
export function buildPlanFlowFromMessages(
  messages: AgentChatMessage[]
): PlanFlowEntry[] {
  const flow: PlanFlowEntry[] = [];
  let prevDone = 0;
  for (const message of messages) {
    const plan = message.plan;
    if (!plan) {
      continue;
    }
    const done = plan.steps.filter(step => step.status === 'done').length;
    if (done > prevDone) {
      flow.push({
        id: `pf-load-${flow.length}`,
        afterMessageId: message.id,
        plan: snapshotPlan(plan.steps, done)
      });
      prevDone = done;
    }
  }
  return flow;
}

function roleOf(role: string): AgentChatMessage['role'] {
  if (role === 'user') {
    return 'user';
  }
  if (role === 'tool') {
    return 'tool';
  }
  return 'assistant';
}

function hasVisibleText(text: string): boolean {
  return text.trim().length > 0;
}

export function mapMessageView(view: AgentMessageView): AgentChatMessage {
  const data: MessageData = view.data;
  const message: AgentChatMessage = {
    id: view.id,
    role: roleOf(data.role),
    content: extractText(data.content)
  };
  if (data.reasoning && hasVisibleText(data.reasoning)) {
    message.thinking = data.reasoning;
  }
  if (data.tool_calls && data.tool_calls.length > 0) {
    message.toolCalls = data.tool_calls.map(call => ({
      id: call.id,
      name: call.function.name,
      args: call.function.arguments
    }));
  }
  if (data.role === 'tool') {
    message.toolResult = {
      toolCallId: data.tool_call_id ?? '',
      content: extractText(data.content)
    };
  }
  if (view.plan) {
    message.plan = mapPlan(view.plan);
  }
  return message;
}

export function mapQueue(queue: AgentQueuedView[]): AgentQueuedMessage[] {
  return queue
    .filter(item => item.status === 'queued')
    .map(item => ({
      id: item.id,
      text: item.text,
      fileCount: item.fileCount
    }));
}

const KIND_BY_EXT: Record<string, AgentFileKind> = {
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  py: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  c: 'code',
  cpp: 'code',
  cs: 'code',
  rb: 'code',
  php: 'code',
  sh: 'code',
  html: 'code',
  css: 'code',
  json: 'json',
  md: 'markdown',
  pdf: 'pdf',
  doc: 'docx',
  docx: 'docx',
  ppt: 'pptx',
  pptx: 'pptx',
  xls: 'xlsx',
  xlsx: 'xlsx',
  csv: 'xlsx',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  ico: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  flac: 'audio',
  mp4: 'video',
  m4v: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  bz2: 'archive',
  xz: 'archive',
  '7z': 'archive',
  rar: 'archive',
  yml: 'config',
  yaml: 'config',
  toml: 'config',
  ini: 'config',
  txt: 'text'
};

function kindFor(name: string): AgentFileKind {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return 'text';
  }
  return KIND_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? 'text';
}

function sortNodes(nodes: AgentFileNode[]): AgentFileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function insertFileNode(
  tree: AgentFileNode[],
  path: string
): AgentFileNode[] {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) {
    return tree;
  }

  const build = (nodes: AgentFileNode[], depth: number): AgentFileNode[] => {
    const name = segments[depth];
    const id = segments.slice(0, depth + 1).join('/');
    const isLeaf = depth === segments.length - 1;
    const existing = nodes.find(node => node.id === id);

    if (isLeaf) {
      if (existing) {
        return nodes;
      }
      return sortNodes([
        ...nodes,
        { id, name, type: 'file', kind: kindFor(name), updatedAtLabel: '' }
      ]);
    }

    if (existing) {
      // Upgrade a stale file node so the same path never appears as both file
      // and folder.
      return nodes.map(node =>
        node.id === id
          ? {
              id,
              name,
              type: 'folder',
              updatedAtLabel: node.updatedAtLabel,
              children: build(
                node.type === 'folder' ? (node.children ?? []) : [],
                depth + 1
              )
            }
          : node
      );
    }
    return sortNodes([
      ...nodes,
      {
        id,
        name,
        type: 'folder',
        updatedAtLabel: '',
        children: build([], depth + 1)
      }
    ]);
  };

  return build(tree, 0);
}

export function removeFileNode(
  tree: AgentFileNode[],
  id: string
): AgentFileNode[] {
  return tree
    .filter(node => node.id !== id)
    .map(node =>
      node.children
        ? { ...node, children: removeFileNode(node.children, id) }
        : node
    );
}

export type AgentAction =
  | {
      type: 'load';
      messages: AgentChatMessage[];
      // null = keep the live queue (a fresher queue-changed event already arrived).
      queue: AgentQueuedMessage[] | null;
      plan: AgentPlan | null;
      status: string;
      mode: AgentMode;
      agentModel: AgentProjectModel | null;
      title: string | null;
    }
  | { type: 'message-added'; message: AgentChatMessage }
  | { type: 'chunk'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'status'; status: string }
  | { type: 'queue'; queue: AgentQueuedMessage[] }
  | { type: 'plan-presented'; steps: string[] }
  | { type: 'plan-progress'; steps: AgentPlanStep[] }
  | { type: 'plan-resolved'; approved: boolean }
  | { type: 'mode'; mode: AgentMode }
  | { type: 'project-model'; agentModel: AgentProjectModel }
  | { type: 'title'; title: string }
  | {
      type: 'file-tree';
      nodes: AgentFileNode[];
      contextNodes: AgentFileNode[];
    }
  | { type: 'file-changed'; changes: { path: string; kind: FileHighlight }[] }
  | { type: 'highlight-end'; id: string }
  | { type: 'tool-approval'; approval: PendingToolApproval }
  | { type: 'tool-approval-resolved'; toolCallId: string }
  | { type: 'question'; question: PendingAgentQuestion }
  | { type: 'question-resolved'; questionId: string }
  | { type: 'sub-agent-activity'; activity: SubAgentActivityInfo }
  | { type: 'connection'; connection: AgentConnection }
  | { type: 'sandbox-status'; sandboxStatus: SandboxStatus }
  | { type: 'gui-status'; guiStatus: GuiStatus }
  | {
      type: 'preview-available';
      available: boolean;
      kind: 'web' | 'gui' | null;
    }
  | { type: 'auto-preview-launch' }
  | { type: 'preview-launch-error'; message: string }
  | { type: 'preview-launch-error-clear' }
  | { type: 'preview-repair-start' }
  | { type: 'preview-repair-end' };

export function agentReducer(
  state: AgentState,
  action: AgentAction
): AgentState {
  switch (action.type) {
    case 'load':
      return {
        ...state,
        messages: action.messages,
        streaming: null,
        queue: action.queue ?? state.queue,
        plan: action.plan,
        // Rebuild the per-step flow from the persisted per-message plan
        // snapshots so reopening a task restores it (live events aren't replayed).
        planFlow: buildPlanFlowFromMessages(action.messages),
        subAgentActivities: [],
        status: action.status,
        mode: action.mode,
        agentModel: action.agentModel,
        title: action.title
      };
    case 'message-added':
      return {
        ...state,
        messages: [...state.messages, action.message],
        plan: action.message.plan ?? state.plan,
        streaming: null
      };
    case 'chunk':
      return {
        ...state,
        streaming: {
          content: (state.streaming?.content ?? '') + action.text,
          thinking: state.streaming?.thinking ?? ''
        }
      };
    case 'thinking':
      if (!state.streaming && !hasVisibleText(action.text)) {
        return state;
      }
      return {
        ...state,
        streaming: {
          content: state.streaming?.content ?? '',
          thinking: (state.streaming?.thinking ?? '') + action.text
        }
      };
    case 'status':
      // A stop mid-stream never produces a final message-added (which is what
      // normally clears the streaming bubble), so drop the partial bubble once
      // the agent settles to idle — otherwise it lingers as a stale message.
      // Pending approvals can't outlive the turn either; clear them the same way
      // in case a tool-approval-resolved event was lost.
      return {
        ...state,
        status: action.status,
        streaming: action.status === 'idle' ? null : state.streaming,
        pendingApprovals:
          action.status === 'idle' ? [] : state.pendingApprovals,
        pendingQuestions: action.status === 'idle' ? [] : state.pendingQuestions
      };
    case 'queue':
      return { ...state, queue: action.queue };
    case 'plan-presented':
      return {
        ...state,
        // A fresh (re-)plan resets the flow history.
        planFlow: [],
        plan: {
          id: 'plan',
          status: 'proposed',
          steps: action.steps.map((title, index) => ({
            id: `s${index}`,
            title,
            status: 'pending'
          }))
        }
      };
    case 'plan-progress': {
      const steps = action.steps;
      const allDone =
        steps.length > 0 && steps.every(step => step.status === 'done');
      const done = steps.filter(step => step.status === 'done').length;
      const last = state.planFlow[state.planFlow.length - 1];
      const prevDone = last
        ? last.plan.steps.filter(step => step.status === 'done').length
        : 0;
      // Flow a snapshot only when the completed count grows — never on the mere
      // "next step is now in progress" updates, which carry the same done count.
      let planFlow = state.planFlow;
      if (done > prevDone) {
        const snapshot = snapshotPlan(steps, done);
        // Anchor to the last NON-tool message: progress usually fires right
        // after a tool result, but those rows are hidden (folded into the call
        // card), so anchoring there would never render. The latest assistant/
        // user message is shown, so the snapshot flows just below it.
        const anchor = [...state.messages]
          .reverse()
          .find(message => message.role !== 'tool');
        planFlow = [
          ...state.planFlow,
          {
            id: `pf-${state.planFlow.length}`,
            afterMessageId: anchor?.id ?? null,
            plan: snapshot
          }
        ];
      }
      return {
        ...state,
        plan: { id: 'plan', status: allDone ? 'done' : 'running', steps },
        planFlow
      };
    }
    case 'plan-resolved':
      return {
        ...state,
        mode: action.approved ? 'steer' : state.mode,
        plan: state.plan
          ? {
              ...state.plan,
              status: action.approved ? 'running' : state.plan.status
            }
          : null
      };
    case 'mode':
      return { ...state, mode: action.mode };
    case 'project-model':
      return { ...state, agentModel: action.agentModel };
    case 'title':
      return { ...state, title: action.title };
    case 'file-tree':
      return {
        ...state,
        fileTree: action.nodes.filter(node => !isHiddenTreePath(node.id)),
        fileTreeLoaded: true,
        contextFiles: action.contextNodes
      };
    case 'file-changed': {
      let tree = state.fileTree;
      const highlights = { ...state.highlights };
      for (const change of action.changes) {
        // Never surface the internal bookkeeping dir in the file manager.
        if (isHiddenTreePath(change.path)) {
          continue;
        }
        if (change.kind === 'added') {
          tree = insertFileNode(tree, change.path);
          highlights[change.path] = 'added';
        } else if (change.kind === 'edited') {
          tree = insertFileNode(tree, change.path);
          highlights[change.path] = 'edited';
        } else {
          highlights[change.path] = 'deleted';
        }
      }
      return { ...state, fileTree: tree, highlights };
    }
    case 'highlight-end': {
      const highlights = { ...state.highlights };
      const kind = highlights[action.id];
      delete highlights[action.id];
      const tree =
        kind === 'deleted'
          ? removeFileNode(state.fileTree, action.id)
          : state.fileTree;
      return { ...state, highlights, fileTree: tree };
    }
    case 'tool-approval':
      // Re-sent on reconnect — keep the list deduplicated by toolCallId.
      return {
        ...state,
        pendingApprovals: [
          ...state.pendingApprovals.filter(
            approval => approval.toolCallId !== action.approval.toolCallId
          ),
          action.approval
        ]
      };
    case 'tool-approval-resolved':
      return {
        ...state,
        pendingApprovals: state.pendingApprovals.filter(
          approval => approval.toolCallId !== action.toolCallId
        )
      };
    case 'question':
      // Re-sent on reconnect — keep the list deduplicated by questionId.
      return {
        ...state,
        pendingQuestions: [
          ...state.pendingQuestions.filter(
            question => question.questionId !== action.question.questionId
          ),
          action.question
        ]
      };
    case 'question-resolved':
      return {
        ...state,
        pendingQuestions: state.pendingQuestions.filter(
          question => question.questionId !== action.questionId
        )
      };
    case 'sub-agent-activity': {
      const event = action.activity;
      // A fresh delegation (new agentId) starts a clean activity list so a prior
      // browser call's pages don't bleed into the one now running.
      const base =
        state.subAgentActivities.length > 0 &&
        state.subAgentActivities[0].agentId !== event.agentId
          ? []
          : state.subAgentActivities;
      const index = base.findIndex(a => a.activityId === event.activityId);
      if (index !== -1) {
        const next = [...base];
        next[index] = {
          ...next[index],
          status: event.status,
          detail: event.detail ?? next[index].detail,
          url: event.url ?? next[index].url
        };
        return { ...state, subAgentActivities: next };
      }
      return { ...state, subAgentActivities: [...base, event] };
    }
    case 'connection':
      return { ...state, connection: action.connection };
    case 'sandbox-status':
      return { ...state, sandboxStatus: action.sandboxStatus };
    case 'gui-status':
      return {
        ...state,
        guiStatus: action.guiStatus,
        // A fresh launch attempt supersedes a previous failure notice.
        previewLaunchError:
          action.guiStatus.status === 'starting'
            ? null
            : state.previewLaunchError
      };
    case 'preview-available':
      return {
        ...state,
        previewAvailable: action.available,
        previewKind: action.kind
      };
    case 'auto-preview-launch':
      return {
        ...state,
        autoPreviewLaunchSeq: state.autoPreviewLaunchSeq + 1,
        // A new auto-launch (the agent rewrote the manifest) clears any stale
        // failure notice from the previous attempt.
        previewLaunchError: null
      };
    case 'preview-launch-error':
      return {
        ...state,
        previewLaunchError: action.message,
        previewRepairActive: false
      };
    case 'preview-launch-error-clear':
      return { ...state, previewLaunchError: null };
    case 'preview-repair-start':
      return {
        ...state,
        previewLaunchError: null,
        previewRepairActive: true
      };
    case 'preview-repair-end':
      return { ...state, previewRepairActive: false };
    default:
      return state;
  }
}
