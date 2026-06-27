import { displayTask } from 'tenjo-chat-engine';
import type {
  MessageContent,
  MessageRequest,
  PlanTodoView
} from 'tenjo-chat-engine';
import type {
  AgentProjectStatus,
  AgentProjectMode,
  AgentProjectModelSnapshot
} from '../repositories/AgentProjectRepository';
import type {
  AgentMessage,
  AgentMessagePlan
} from '../repositories/AgentMessageRepository';
import type { SubAgentActivityEvent } from '../relays/SubAgentActivityRelay';

/**
 * Shared wire protocol for the Agent WebSocket. The server emits
 * AgentServerEvents; the client sends AgentClientCommands. The client
 * re-declares these as Zod schemas independently.
 */

/** File-kind enum mirrored 1:1 with the client's AgentFileKind. */
export type AgentFileKind =
  | 'code'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'json'
  | 'markdown'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'config'
  | 'text';

/** A node in the file tree, mirrored 1:1 with the client's AgentFileNode. */
export interface AgentFileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  kind?: AgentFileKind;
  sizeLabel?: string;
  updatedAtLabel: string;
  children?: AgentFileNode[];
}

/** An option shown by an agent question event. */
export interface AgentQuestionOption {
  label: string;
  description?: string;
}

/** A live file-system change reported by the sandbox watcher. */
export interface AgentFileChange {
  path: string;
  kind: 'created' | 'updated' | 'deleted';
}

/** A persisted message projected for the client. */
export interface AgentMessageView {
  id: string;
  role: string;
  source: string;
  data: MessageRequest;
  plan: AgentMessagePlan | null;
  createdAt: string | null;
}

/** A queued prompt shown in the agent UI. */
export interface AgentQueuedView {
  id: string;
  text: string;
  fileCount: number;
  status: string;
}

/** File tree payload sent to the client. */
export interface AgentFileTreeEvent {
  type: 'file-tree';
  nodes: AgentFileNode[];
  // Uploaded context files shown separately from workspace files.
  contextNodes: AgentFileNode[];
}

/** Shared-sandbox lifecycle used to explain slow first-run setup. */
export interface AgentSandboxStatusEvent {
  type: 'sandbox-status';
  status: 'unavailable' | 'preparing' | 'ready';
  detail?: string;
}

/** GUI sidecar lifecycle used by the preview panel. */
export interface AgentGuiStatusEvent {
  type: 'gui-status';
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  detail?: string;
}

/** Whether the agent recorded a preview manifest. */
export interface AgentPreviewAvailableEvent {
  type: 'preview-available';
  available: boolean;
  // `gui` is a native app; `web` is a dev server.
  kind: 'web' | 'gui' | null;
}

/** Request to open or relaunch the recorded preview. */
export interface AgentPreviewOpenEvent {
  type: 'preview-open';
}

/** Non-blocking preview launch failure shown inline in the preview panel. */
export interface AgentPreviewLaunchErrorEvent {
  type: 'preview-launch-error';
  message: string;
}

export type AgentServerEvent =
  | { type: 'message-added'; message: AgentMessageView }
  | { type: 'chunk'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'status'; status: string }
  | {
      type: 'tool-stream';
      toolCallId: string;
      toolName: string;
      argumentsDelta: string;
    }
  | { type: 'queue-changed'; queue: AgentQueuedView[] }
  | { type: 'turn-start'; items: AgentQueuedView[] }
  | { type: 'turn-complete' }
  | { type: 'idle' }
  | { type: 'project-status'; status: AgentProjectStatus }
  | { type: 'mode'; mode: AgentProjectMode }
  | { type: 'project-model'; agentModel: AgentProjectModelSnapshot }
  | { type: 'title'; title: string }
  | { type: 'plan-presented'; steps: string[]; summary: string | null }
  | { type: 'plan-progress'; todos: PlanTodoView[] }
  | { type: 'plan-resolved'; approved: boolean }
  // An MCP tool call is waiting for the user's approval (args as JSON text).
  | {
      type: 'tool-approval';
      toolCallId: string;
      toolName: string;
      toolArgs: string;
    }
  | { type: 'tool-approval-resolved'; toolCallId: string; approved: boolean }
  /*
   * The agent asked the user a multiple-choice question and is blocked until
   * they answer. `questionId` equals the originating tool-call id.
   */
  | {
      type: 'question';
      questionId: string;
      question: string;
      header?: string;
      options: AgentQuestionOption[];
      multiSelect: boolean;
    }
  | { type: 'question-resolved'; questionId: string }
  /*
   * Live progress of a sub-agent. Mirrors chat's sub-agent activity stream.
   */
  | { type: 'sub-agent-activity'; activity: SubAgentActivityEvent }
  | AgentFileTreeEvent
  | { type: 'file-changed'; changes: AgentFileChange[] }
  | AgentSandboxStatusEvent
  | AgentGuiStatusEvent
  | AgentPreviewAvailableEvent
  | AgentPreviewOpenEvent
  | AgentPreviewLaunchErrorEvent
  | { type: 'error'; message: string };

export type AgentClientCommand =
  | { type: 'subscribe'; projectId: string }
  | {
      type: 'submit';
      text: string;
      // Files the user attached, already stored as artifacts.
      contextFiles?: { ref: string; name: string }[];
      mode: AgentProjectMode;
      // Whether the browser-driving web-search sub-agent tool is available.
      webSearchEnabled?: boolean;
      // Whether web search may run for up to 600 seconds instead of 200.
      webSearchExtendedTimeoutEnabled?: boolean;
    }
  | { type: 'plan-approve' }
  | { type: 'plan-reject'; feedback?: string }
  | { type: 'queue-remove'; id: string }
  | { type: 'abort'; clearQueue?: boolean }
  | { type: 'request-file-tree' };

/**
 * Internal bus payload on the `agent_event` channel. `message-added` is fanned
 * out as a lightweight id reference so large tool results do not hit the 8 KB
 * NOTIFY payload limit.
 */
export type AgentBusEvent =
  | { kind: 'event'; event: AgentServerEvent }
  | { kind: 'message-ref'; messageId: string };

/*
 * Markers framing the auto-injected context-file note in a user message. The
 * note is for the model and is stripped from the display projection.
 */
const CONTEXT_NOTE_START = '<<<TENJO_CONTEXT_FILES>>>';
const CONTEXT_NOTE_END = '<<<TENJO_CONTEXT_FILES_END>>>';

/** Wrap a model-only context note so it can be stripped from the UI projection. */
export function wrapContextNote(note: string): string {
  return `${CONTEXT_NOTE_START}\n${note}\n${CONTEXT_NOTE_END}`;
}

/** Remove the marker-framed upload note for display. */
export function stripContextNote(text: string): string {
  const start = text.indexOf(CONTEXT_NOTE_START);
  if (start === -1) {
    return text;
  }
  const end = text.indexOf(CONTEXT_NOTE_END);
  if (end === -1) {
    return text;
  }
  const before = text.slice(0, start);
  const after = text.slice(end + CONTEXT_NOTE_END.length);
  return `${before}${after}`.replace(/^\s+/, '');
}

// Strip both the plan-mode wrapper and the injected upload note for display.
function displayUserText(text: string): string {
  return stripContextNote(displayTask(text));
}

/*
 * Strip model-only text from user messages for display. Stored rows keep the
 * full text because the model still needs it.
 */
function displayData(data: MessageRequest): MessageRequest {
  if (data.role !== 'user') {
    return data;
  }
  if (typeof data.content === 'string') {
    const stripped = displayUserText(data.content);
    return stripped === data.content ? data : { ...data, content: stripped };
  }
  let changed = false;
  const content: MessageContent[] = data.content.map((part) => {
    if (part.type !== 'text') {
      return part;
    }
    const stripped = displayUserText(part.text);
    if (stripped === part.text) {
      return part;
    }
    changed = true;
    return { ...part, text: stripped };
  });
  return changed ? { ...data, content } : data;
}

/** Convert a persisted agent message row to the client-facing view. */
export function toAgentMessageView(row: AgentMessage): AgentMessageView {
  return {
    id: row.id,
    role: row.role,
    source: row.source,
    data: displayData(row.data),
    plan: row.plan,
    createdAt: row.created_at ? row.created_at.toISOString() : null
  };
}
