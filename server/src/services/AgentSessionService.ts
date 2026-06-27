import path from 'node:path';
import type { PoolClient } from 'pg';
import {
  ChatClient,
  ChatAgent,
  CHAT_AGENT_EMPTY_RESPONSE_NUDGE,
  LocalChatApiClient,
  type Tool,
  bundleTools,
  createCodingTools,
  createPlanController,
  summarizeIncremental,
  applySummaryToMessages,
  compactMessages,
  stripThinkingFromMessages,
  CODING_AGENT_COMPACT_SYSTEM_PROMPT,
  CODING_AGENT_ACT_NUDGE,
  PLAN_MODE_PRESENT_PLAN_NUDGE,
  ASK_USER_QUESTION_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_DEFINITION,
  ASK_USER_QUESTION_COMPACT_HINT,
  parseAskUserQuestionArgs,
  buildCompactDevServerHint,
  buildCompactHostPrivatePreviewHint,
  SANDBOX_COMPACT_COMMON_TOOLCHAIN_HINT,
  SANDBOX_COMPACT_DOCUMENT_TOOLCHAIN_HINT,
  SANDBOX_COMPACT_WORKSPACE_HINT,
  createSandboxDocumentWorkspace,
  DEFAULT_SNAPSHOT_EXCLUDE,
  createBrowserDelegateTool,
  BROWSER_DELEGATE_TOOL_NAME,
  BROWSER_DELEGATE_TOOL_DEFINITION,
  classifyIntent,
  type Sandbox,
  type SandboxDocumentWorkspace,
  type SandboxWatcher,
  type MessageRequest,
  type QueuedItem,
  type AgentToolCall,
  type LocalToolHandler,
  type McpClientManager,
  type ToolDefinitionRequest,
  type PlanController,
  type PlanTodoView,
  type TurnResult
} from 'tenjo-chat-engine';
import { pool } from '../db/client';
import logger from '../logger';
import {
  agentProjectRepo,
  agentMessageRepo,
  toolApprovalRuleRepo
} from '../repositories/registry';
import type {
  AgentProject,
  AgentProjectMode,
  AgentProjectModelSnapshot,
  AgentProjectStatus
} from '../repositories/AgentProjectRepository';
import type { AgentMessagePlan } from '../repositories/AgentMessageRepository';
import { createChatApiClient } from '../factories/chatClientFactory';
import { createBrowserSubAgent } from '../factories/browserSubAgentFactory';
import { agentEventBus } from '../events/AgentEventBus';
import { questionEmitter } from '../events/QuestionEmitter';
import { toolApprovalEmitter } from '../events/ToolApprovalEmitter';
import { createSubAgentActivityRelay } from '../relays/SubAgentActivityRelay';
import { touch as touchIdle } from './AgentIdleReaperService';
import { agentGuiService } from './AgentGuiService';
import type { ModelConfig } from '../repositories/GlobalSettingRepository';
import { ModelNotFoundError } from './GlobalSettingService';
import {
  globalSettingService,
  fileUploadService,
  mcpToolService,
  userService
} from './registry';
import { generateTitle, createFallbackTitle } from './TitleGenerationService';
import {
  describeImageToText,
  isImageFileName,
  imageMimeType
} from './ImageDescriptionService';
import {
  AGENT_SANDBOX_UNAVAILABLE_MESSAGE,
  sandboxManager,
  isAgentSandboxUsable
} from './AgentSandboxService';
import {
  splitFileTrees,
  coalesceChanges,
  isHiddenAgentPath,
  CONTEXT_UPLOAD_DIR
} from '../utils/agentFiles';
import { ZipUtils, type ZipEntry } from '../utils/zipUtils';
import {
  wrapContextNote,
  stripContextNote,
  type AgentClientCommand,
  type AgentFileNode,
  type AgentQueuedView,
  type AgentServerEvent
} from '../types/agentProtocol';

type PendingQuestion = Extract<AgentServerEvent, { type: 'question' }>;
type PreviewAvailableEvent = Extract<
  AgentServerEvent,
  { type: 'preview-available' }
>;

/** Tokens reserved for the model reply and tool schemas during compaction. */
const RESERVED_OUTPUT_TOKENS = 4096;
export const MAX_AGENT_SYSTEM_PROMPT_CHARS = 3300;
const STREAM_GUARD = {
  maxReasoningCharsWithoutOutput: 60000,
  maxDurationMs: 300000
} as const;
const SUMMARY_THRESHOLD_RATIO = 0.7;
const SUMMARY_RECENT_KEEP = 12;
const STREAM_FLUSH_MS = 60;
const STREAM_FLUSH_BYTES = 6000;
const STREAM_EMIT_MAX_BYTES = 3500;
const FILE_CHANGES_MAX_BYTES = 6000;
const WATCH_DEBOUNCE_MS = 400;
const TREE_SNAPSHOT_EXCLUDE = DEFAULT_SNAPSHOT_EXCLUDE.filter(
  (name) => name !== 'node_modules'
);
/** Dependency lockfiles imply node_modules may need a full tree refresh. */
const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb'
]);

function isLockfilePath(filePath: string): boolean {
  return LOCKFILE_NAMES.has(filePath.split('/').pop() ?? '');
}

function messageContentText(message: MessageRequest): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return '';
  }
  return message.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n');
}

function agentTaskText(
  project: AgentProject,
  messages: MessageRequest[]
): string {
  return [
    project.title,
    ...messages
      .filter((message) => message.role === 'user')
      .map(messageContentText)
  ].join('\n');
}

function isDocumentGenerationTask(
  project: AgentProject,
  messages: MessageRequest[]
): boolean {
  return classifyIntent(agentTaskText(project, messages)).kind === 'document';
}

function isDocumentTaskText(text: string): boolean {
  return classifyIntent(text).kind === 'document';
}

export async function buildPreviewAvailableEvent(
  sandbox: Sandbox
): Promise<PreviewAvailableEvent> {
  const { available, kind } = await agentGuiService.previewInfo(sandbox);
  return {
    type: 'preview-available',
    available,
    kind
  };
}

function sessionLocalDefinitions(
  session: AgentSession
): ToolDefinitionRequest[] {
  const definitions = session.documentPromptEnabled
    ? session.localDefinitions.filter(
        (definition) => definition.function.name !== RESTART_PREVIEW_TOOL
      )
    : session.localDefinitions;
  return session.webSearchEnabled
    ? [...definitions, BROWSER_DELEGATE_TOOL_DEFINITION]
    : definitions;
}

/** Builds the compact system prompt used by sandboxed coding-agent sessions. */
export function buildAgentSystemPromptContent(options: {
  sandbox: Pick<Sandbox, 'devPorts'>;
  documentTask: boolean;
}): string {
  const previewHint = options.documentTask
    ? ''
    : options.sandbox.devPorts === undefined
      ? buildCompactHostPrivatePreviewHint('all')
      : buildCompactDevServerHint(options.sandbox.devPorts);
  const toolchainHint = [
    SANDBOX_COMPACT_COMMON_TOOLCHAIN_HINT,
    options.documentTask ? SANDBOX_COMPACT_DOCUMENT_TOOLCHAIN_HINT : ''
  ]
    .filter(Boolean)
    .join('\n\n');
  const sandboxHint = [
    SANDBOX_COMPACT_WORKSPACE_HINT,
    previewHint,
    toolchainHint,
    ASK_USER_QUESTION_COMPACT_HINT
  ]
    .filter(Boolean)
    .join('\n\n');
  const prompt = sandboxHint
    ? `${CODING_AGENT_COMPACT_SYSTEM_PROMPT}\n\n${sandboxHint}`
    : CODING_AGENT_COMPACT_SYSTEM_PROMPT;
  return prompt;
}

/** Resolves the effective context window for an agent session. */
export async function resolveAgentSessionMaxContext(
  storedMaxContext: number | null,
  apiClient: unknown
): Promise<number | null> {
  if (apiClient instanceof LocalChatApiClient) {
    try {
      const liveMaxContext = await apiClient.getMaxContextLength();
      if (liveMaxContext !== null) {
        return liveMaxContext;
      }
    } catch {
      // Keep the configured value.
    }
  }

  return storedMaxContext;
}

const RESTART_PREVIEW_TOOL = 'restart_preview';

/** Tool that records preview-launch intent for turn-complete handling. */
function createRestartPreviewTool(
  sandbox: Sandbox,
  onCalled: () => void
): Tool {
  return {
    definition: {
      type: 'function',
      function: {
        name: RESTART_PREVIEW_TOOL,
        description:
          'Required final step for runnable web/native GUI apps. Before calling, ' +
          'start/build the app, verify it, and write `.tenjo/dev-servers.json` ' +
          'with the exact launch command. Call this after the first working build ' +
          'and after every rebuild; otherwise the GUI preview will not open or will ' +
          'show an old copy. Do not use for documents/files/CLI-only tasks.',
        parameters: { type: 'object', properties: {} }
      }
    },
    handler: async () => {
      const previewSignature = await agentGuiService.previewSignature(sandbox);
      if (!previewSignature) {
        return [
          'Cannot restart the GUI preview yet: `.tenjo/dev-servers.json` does not exist.',
          'Create it first with the exact runnable app launch entry, then call `restart_preview` again.'
        ].join('\n');
      }
      onCalled();
      return 'The GUI preview will (re)launch after this turn finishes if this is a runnable app.';
    }
  };
}

/** Splits UTF-8 text into byte-bounded chunks without cutting a code point. */
function sliceByByteLength(text: string, maxBytes: number): string[] {
  if (Buffer.byteLength(text) <= maxBytes) {
    return [text];
  }
  const pieces: string[] = [];
  let buf = Buffer.from(text, 'utf8');
  while (buf.length > 0) {
    let end = Math.min(maxBytes, buf.length);
    while (end < buf.length && (buf[end] & 0xc0) === 0x80) {
      end--;
    }
    pieces.push(buf.subarray(0, end).toString('utf8'));
    buf = buf.subarray(end);
  }
  return pieces;
}

/** Truncates UTF-8 text to a byte budget without cutting a code point. */
function truncateToByteLength(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) {
    return text;
  }
  const sliced = Buffer.from(text, 'utf8').subarray(0, maxBytes);
  return new TextDecoder('utf-8').decode(sliced).replace(/�$/, '');
}

const IDLE_EVICT_MS = 10 * 60 * 1000;
const APPROVAL_ARGS_MAX_BYTES = 4000;

const SUMMARY_SYSTEM_PROMPT = [
  "You compress an agent's conversation history into a compact summary.",
  'Produce a SELF-CONTAINED summary (merging the existing summary, if any, with',
  'the new transcript) that the agent can rely on to keep working on the task.',
  'Preserve, concisely: the user goals/requirements, decisions made, files',
  'created or edited and the key changes, important identifiers (functions,',
  'paths, symbols), commands run and their outcomes, what was tried and failed',
  'and why, and any open problems or next steps. Drop chit-chat and verbose tool',
  'output. Be strictly factual — do not invent. Keep it under ~400 words.'
].join('\n');

interface StreamBuffer {
  message: string;
  thinking: string;
  reasoning: string;
}

type PendingToolApproval = Extract<AgentServerEvent, { type: 'tool-approval' }>;

/** Mutable state owned by one server process for a live agent project. */
interface AgentSession {
  projectId: string;
  userId: string;
  agent: ChatAgent;
  sandbox: Sandbox;
  plan: PlanController;
  modelConfig: ModelConfig;
  maxContext: number | null;
  apiClient: ReturnType<typeof createChatApiClient>;
  localDefinitions: ToolDefinitionRequest[];
  mcp: McpClientManager | null;
  mcpTools: ToolDefinitionRequest[];
  mcpToolNames: Set<string>;
  documentPromptEnabled: boolean;
  webSearchEnabled: boolean;
  webSearchExtendedTimeoutEnabled: boolean;
  pendingApprovals: Map<string, PendingToolApproval>;
  pendingQuestions: Map<string, PendingQuestion>;
  lastPreviewSig: string;
  restartPreviewCalledThisTurn: boolean;
  watcher: SandboxWatcher | null;
  saveQueue: Promise<void>;
  stream: StreamBuffer;
  flushTimer: NodeJS.Timeout | null;
  watchTimer: NodeJS.Timeout | null;
  watchPending: { path: string; kind: 'created' | 'updated' | 'deleted' }[];
  currentPlan: AgentMessagePlan | null;
  workspace: SandboxDocumentWorkspace;
  lastActiveAt: number;
}

/** Owns live ChatAgent instances for this server process. */
class AgentSessionService {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly pendingCreate = new Map<
    string,
    Promise<AgentSession | null>
  >();
  private lockClient: PoolClient | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  /** Starts command routing and idle sweeping for live agent sessions. */
  async start(): Promise<void> {
    if (!this.lockClient) {
      this.lockClient = await pool.connect();
    }
    agentEventBus.onCommand((projectId, command) => {
      this.applyCommandIfOwned(projectId, command);
    });
    if (!this.sweepTimer) {
      this.sweepTimer = setInterval(() => this.sweepIdle(), 60_000);
      this.sweepTimer.unref?.();
    }
  }

  /** Stops local live sessions and releases resources. */
  async stop(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const session of this.sessions.values()) {
      session.watcher?.stop();
      void session.mcp?.close().catch(() => {});
    }
    this.sessions.clear();
    if (this.lockClient) {
      this.lockClient.release();
      this.lockClient = null;
    }
  }

  /** Returns true when this process currently owns the live session. */
  owns(projectId: string): boolean {
    return this.sessions.has(projectId);
  }

  // ---- command dispatch ----------------------------------------------------

  /** Applies or routes a client command for an agent project. */
  async dispatchCommand(
    projectId: string,
    userId: string,
    command: AgentClientCommand
  ): Promise<void> {
    try {
      const existing = this.sessions.get(projectId);
      if (existing) {
        await this.apply(existing, command);
        return;
      }
      if (command.type === 'submit') {
        const session = await this.ensureSession(projectId, userId);
        if (session) {
          await this.apply(session, command);
          return;
        }
      }
      if (command.type === 'queue-remove') {
        await this.removeQueuedFromDb(projectId, command.id);
      }
      agentEventBus.publishCommand(projectId, command);
    } catch (error) {
      logger.error('[agent] dispatchCommand failed', { projectId, error });
      agentEventBus.emit(projectId, {
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private applyCommandIfOwned(
    projectId: string,
    command: AgentClientCommand
  ): void {
    const session = this.sessions.get(projectId);
    if (!session) {
      return;
    }
    void this.apply(session, command).catch((error) => {
      logger.error('[agent] routed command failed', { projectId, error });
    });
  }

  private async apply(
    session: AgentSession,
    command: AgentClientCommand
  ): Promise<void> {
    session.lastActiveAt = Date.now();
    touchIdle(session.projectId);
    switch (command.type) {
      case 'submit':
        await this.applySubmit(session, command);
        break;
      case 'plan-approve':
        session.plan.routeInput('y');
        break;
      case 'plan-reject': {
        const feedback = command.feedback?.trim();
        session.plan.routeInput(feedback ? feedback : 'no');
        break;
      }
      case 'queue-remove':
        session.agent.removeFromQueue(command.id);
        break;
      case 'abort':
        session.agent.abort({ clearQueue: command.clearQueue ?? false });
        break;
      default:
        break;
    }
  }

  private async applySubmit(
    session: AgentSession,
    command: AgentClientCommand & { type: 'submit' }
  ): Promise<void> {
    const mode: AgentProjectMode = command.mode;
    session.webSearchEnabled = command.webSearchEnabled === true;
    session.webSearchExtendedTimeoutEnabled =
      session.webSearchEnabled &&
      command.webSearchExtendedTimeoutEnabled === true;
    const note = command.contextFiles?.length
      ? await this.materializeContextFiles(session, command.contextFiles)
      : '';
    const hiddenNotes = [note]
      .filter((value) => value.trim().length > 0)
      .join('\n\n');
    const baseText = hiddenNotes
      ? `${wrapContextNote(hiddenNotes)}\n\n${command.text}`
      : command.text;
    const text = mode === 'plan' ? session.plan.wrapTask(baseText) : baseText;
    await agentProjectRepo.update(session.projectId, { mode });
    agentEventBus.emit(session.projectId, { type: 'mode', mode });
    this.maybeSetTitle(session.projectId, command.text, session.modelConfig);
    session.agent.submit(text);
  }

  /** Copies uploaded context files into the sandbox. */
  private async materializeContextFiles(
    session: AgentSession,
    files: { ref: string; name: string }[]
  ): Promise<string> {
    const { sandbox } = session;
    const writeBinary = sandbox.writeBinary?.bind(sandbox);
    const root = sandbox.getWorkspaceDir?.() ?? null;
    const abs = (rel: string): string => (root ? `${root}/${rel}` : rel);
    const lines: string[] = [];

    for (const file of files) {
      const safeName = path.basename(file.name).replace(/^\.+/, '') || 'file';
      const target = abs(`${CONTEXT_UPLOAD_DIR}/${safeName}`);
      let bytes: Buffer;
      try {
        bytes = await fileUploadService.read(file.ref);
      } catch (error) {
        logger.warn('[agent] context file artifact missing, skipping', {
          ref: file.ref,
          error
        });
        continue;
      }
      try {
        if (writeBinary) {
          await writeBinary(target, bytes);
        } else {
          await sandbox.writeFile(target, bytes.toString('utf-8'));
        }
      } catch (error) {
        logger.warn('[agent] failed to write context file to sandbox', {
          target,
          error
        });
        continue;
      }

      if (isImageFileName(safeName)) {
        const sidecar = `${target}._context.txt`;
        const mime = imageMimeType(safeName);
        const { text: description, ok } = await describeImageToText(
          bytes,
          mime,
          session.modelConfig
        );
        await sandbox.writeFile(sidecar, description).catch(() => {});
        if (ok) {
          lines.push(
            `- ${target} (image). When your output needs the actual picture, ` +
              `embed/reference THIS file by its path — do NOT paste the ` +
              `description into code. Plain-text description of the image ` +
              `(also in ${sidecar}):`,
            '"""',
            description,
            '"""'
          );
        } else {
          lines.push(
            `- ${target} (image). It could NOT be read as text — no ` +
              `vision-capable model is available. You cannot see this image and ` +
              `no tool can recover its contents, so do NOT analyze it with code ` +
              `or search the web for it. If the picture is essential to the ` +
              `task, ask the user to describe it; otherwise proceed using their ` +
              `text. Reference it by the path above only when your OUTPUT must ` +
              `embed the file itself.`
          );
        }
      } else {
        lines.push(`- ${target}`);
      }

      void fileUploadService.delete(file.ref);
    }

    if (lines.length === 0) {
      return '';
    }
    void this.resendTree(session.projectId);
    return [
      'The user attached context files (absolute paths below):',
      ...lines,
      'Guidance:',
      '- If a program or document you build should load/embed a file at runtime, ' +
        'just reference it by its ABSOLUTE path above (or copy it next to your ' +
        'output first, e.g. `cp <abs path> .`). Do NOT read the file into the ' +
        'conversation to use it from code — the path is enough. A relative path ' +
        `like ${CONTEXT_UPLOAD_DIR}/... will NOT resolve from a document scratch ` +
        'directory.',
      '- To confirm a file exists, use `ls` or `test -f` — never `cat`/read it ' +
        'just to check. Only read a file into context when you genuinely need ' +
        'its contents to decide what to do, since dumping a file bloats the ' +
        'context and hurts quality.',
      '- Never `cat` a binary file (image, PDF): it only fills the context with ' +
        'garbage. For an uploaded image, a plain-text description is already ' +
        'provided inline above — use it directly; you do NOT need to read the ' +
        'file to understand the picture.'
    ].join('\n');
  }

  /** Generates a project title in the background. */
  private maybeSetTitle(
    projectId: string,
    prompt: string,
    modelConfig: ModelConfig
  ): void {
    void (async () => {
      const project = await agentProjectRepo.findById(projectId);
      if (!project || (project.title && project.title !== '-')) {
        return;
      }
      const title =
        (await generateTitle(prompt, modelConfig)) ||
        createFallbackTitle(prompt) ||
        '-';
      await agentProjectRepo.update(projectId, { title });
      agentEventBus.emit(projectId, { type: 'title', title });
    })().catch((error) =>
      logger.warn('[agent] failed to set title', { projectId, error })
    );
  }

  // ---- ownership -----------------------------------------------------------

  private async tryClaim(projectId: string): Promise<boolean> {
    if (!this.lockClient) {
      this.lockClient = await pool.connect();
    }
    const result = await this.lockClient.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [projectId]
    );
    return result.rows[0]?.locked === true;
  }

  private async release(projectId: string): Promise<void> {
    if (!this.lockClient) {
      return;
    }
    await this.lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [
      projectId
    ]);
  }

  // ---- session lifecycle ---------------------------------------------------

  /** Gets or creates the live session for this process. */
  private ensureSession(
    projectId: string,
    userId: string
  ): Promise<AgentSession | null> {
    const existing = this.sessions.get(projectId);
    if (existing) {
      return Promise.resolve(existing);
    }
    const pending = this.pendingCreate.get(projectId);
    if (pending) {
      return pending;
    }
    const creation = (async (): Promise<AgentSession | null> => {
      if (!(await this.tryClaim(projectId))) {
        return null;
      }
      try {
        return await this.createOwnedSession(projectId, userId);
      } catch (error) {
        await this.release(projectId);
        throw error;
      }
    })().finally(() => this.pendingCreate.delete(projectId));
    this.pendingCreate.set(projectId, creation);
    return creation;
  }

  private async ensureProjectModelLocked(
    project: AgentProject
  ): Promise<{ project: AgentProject; modelId: string }> {
    if (project.model_id) {
      return { project, modelId: project.model_id };
    }

    const activeModelId = (await globalSettingService.getModelSettings())
      .activeId;
    const model =
      await globalSettingService.resolveModelReference(activeModelId);
    const agentModel: AgentProjectModelSnapshot = {
      id: model.id,
      provider: model.type,
      model: model.model,
      baseUrl: model.baseUrl
    };
    const updated =
      (await agentProjectRepo.update(project.id, {
        model_id: agentModel.id,
        model: agentModel.model,
        provider: agentModel.provider,
        model_base_url: agentModel.baseUrl
      })) ?? project;

    agentEventBus.emit(project.id, {
      type: 'project-model',
      agentModel
    });

    return { project: updated, modelId: agentModel.id };
  }

  private async recoverProjectModel(
    project: AgentProject
  ): Promise<{ project: AgentProject; modelId: string } | null> {
    if (!project.provider || !project.model || !project.model_base_url) {
      return null;
    }

    const model = await globalSettingService.findModelReference({
      provider: project.provider,
      model: project.model,
      baseUrl: project.model_base_url
    });
    if (!model) {
      return null;
    }

    const agentModel: AgentProjectModelSnapshot = {
      id: model.id,
      provider: model.type,
      model: model.model,
      baseUrl: model.baseUrl
    };
    const updated =
      (await agentProjectRepo.update(project.id, {
        model_id: agentModel.id,
        model: agentModel.model,
        provider: agentModel.provider,
        model_base_url: agentModel.baseUrl
      })) ?? project;

    agentEventBus.emit(project.id, {
      type: 'project-model',
      agentModel
    });

    return { project: updated, modelId: agentModel.id };
  }

  /** Creates a fully wired project session. */
  private async createOwnedSession(
    projectId: string,
    userId: string
  ): Promise<AgentSession> {
    if (!isAgentSandboxUsable()) {
      throw new Error(AGENT_SANDBOX_UNAVAILABLE_MESSAGE);
    }
    let project = await agentProjectRepo.findById(projectId);
    if (!project) {
      throw new Error('Agent project not found.');
    }

    const { project: lockedProject, modelId: lockedModelId } =
      await this.ensureProjectModelLocked(project);
    project = lockedProject;
    let resolvedModelId = lockedModelId;
    let modelConfig: ModelConfig;
    try {
      modelConfig =
        await globalSettingService.resolveModelConfig(resolvedModelId);
    } catch (error) {
      if (error instanceof ModelNotFoundError) {
        const recovered = await this.recoverProjectModel(project);
        if (recovered) {
          project = recovered.project;
          resolvedModelId = recovered.modelId;
          modelConfig =
            await globalSettingService.resolveModelConfig(resolvedModelId);
        } else {
          const label = project.model ?? resolvedModelId;
          throw new Error(
            `The model configured for this agent task has been deleted: ${label}. Add the same model configuration again to continue this task.`
          );
        }
      } else {
        throw error;
      }
    }

    const sandbox = await sandboxManager.getSandbox(projectId);

    const workspace = createSandboxDocumentWorkspace({
      sandbox
    });
    await workspace.init();

    const plan = createPlanController(() => {}, {
      onPlanPresented: (steps, summary) =>
        this.onPlanPresented(projectId, steps, summary),
      onProgress: (todos) => this.onPlanProgress(projectId, todos),
      onResolved: (approved) =>
        agentEventBus.emit(projectId, { type: 'plan-resolved', approved })
    });

    const { definitions, handlers } = bundleTools([
      ...createCodingTools(sandbox),
      ...plan.tools,
      createRestartPreviewTool(sandbox, () => {
        const live = this.sessions.get(projectId);
        if (live) {
          live.restartPreviewCalledThisTurn = true;
        }
      })
    ]);
    definitions.push(ASK_USER_QUESTION_TOOL_DEFINITION);

    handlers.set(
      BROWSER_DELEGATE_TOOL_NAME,
      this.createWebSearchHandler(projectId)
    );

    const { mcp, mcpTools } = await this.connectMcpTools(projectId, handlers);
    try {
      return await this.finishOwnedSession({
        project,
        userId,
        resolvedModelId,
        modelConfig,
        sandbox,
        workspace,
        plan,
        definitions,
        handlers,
        mcp,
        mcpTools
      });
    } catch (error) {
      await mcp?.close().catch(() => {});
      throw error;
    }
  }

  /** Completes project session creation. */
  private async finishOwnedSession({
    project,
    userId,
    resolvedModelId,
    modelConfig,
    sandbox,
    workspace,
    plan,
    definitions,
    handlers,
    mcp,
    mcpTools
  }: {
    project: AgentProject;
    userId: string;
    resolvedModelId: string;
    modelConfig: ModelConfig;
    sandbox: Sandbox;
    workspace: SandboxDocumentWorkspace;
    plan: PlanController;
    definitions: ToolDefinitionRequest[];
    handlers: Map<string, LocalToolHandler>;
    mcp: McpClientManager | null;
    mcpTools: ToolDefinitionRequest[];
  }): Promise<AgentSession> {
    const projectId = project.id;
    const localToolNames = new Set(
      definitions.map((definition) => definition.function.name)
    );
    const enabledMcpTools = await this.filterMcpTools(
      userId,
      mcpTools,
      localToolNames
    );
    const apiClient = createChatApiClient(
      modelConfig,
      [...definitions, ...enabledMcpTools],
      STREAM_GUARD
    );

    const storedMaxContext =
      await globalSettingService.resolveModelMaxContext(resolvedModelId);
    const maxContext = await resolveAgentSessionMaxContext(
      storedMaxContext,
      apiClient
    );
    logger.info('[agent] context window resolved', {
      projectId,
      modelId: resolvedModelId,
      maxContext,
      compactionEnabled: maxContext !== null
    });
    const client = new ChatClient(apiClient);
    const persistedMessages = await agentMessageRepo.listByProject(projectId);
    const persistedMessageData = persistedMessages.map((row) => row.data);
    const documentPromptEnabled = isDocumentGenerationTask(
      project,
      persistedMessageData
    );
    const systemPrompt: MessageRequest = {
      role: 'system',
      content: buildAgentSystemPromptContent({
        sandbox,
        documentTask: documentPromptEnabled
      })
    };
    client.setSystemPrompt(systemPrompt);

    const initialPreviewSig = await agentGuiService
      .previewSignature(sandbox)
      .catch(() => '');

    const session: AgentSession = {
      projectId,
      userId,
      agent: undefined as unknown as ChatAgent,
      sandbox,
      workspace,
      plan,
      modelConfig,
      maxContext,
      apiClient,
      localDefinitions: definitions,
      mcp,
      mcpTools,
      mcpToolNames: new Set(mcpTools.map((tool) => tool.function.name)),
      documentPromptEnabled,
      webSearchEnabled: false,
      webSearchExtendedTimeoutEnabled: false,
      pendingApprovals: new Map(),
      pendingQuestions: new Map(),
      lastPreviewSig: initialPreviewSig,
      restartPreviewCalledThisTurn: false,
      watcher: null,
      saveQueue: Promise.resolve(),
      stream: { message: '', thinking: '', reasoning: '' },
      flushTimer: null,
      watchTimer: null,
      watchPending: [],
      currentPlan: null,
      lastActiveAt: Date.now()
    };

    client.setOutgoingMessageTransform((messages) => {
      const condensed = applySummaryToMessages(
        stripThinkingFromMessages(messages),
        session.agent.getCompactionState()
      );
      if (maxContext === null) {
        return condensed;
      }
      return compactMessages(condensed, {
        maxContextTokens: maxContext,
        reservedOutputTokens: RESERVED_OUTPUT_TOKENS,
        compactThresholdRatio: 0.8,
        targetRatio: 0.6,
        recentMessagesToKeep: 12
      }).messages;
    });

    const agent = new ChatAgent(client, {
      drainStrategy: 'sequential',
      drainQueuedAtToolBoundary: true,
      autoContinueOnEmpty: 3,
      nudgeOnTextOnlyTurn: {
        maxNudges: 1,
        instruction: () =>
          session.plan.isAwaitingApproval()
            ? PLAN_MODE_PRESENT_PLAN_NUDGE
            : CODING_AGENT_ACT_NUDGE,
        actionToolNames: ['str_replace', 'write_file']
      },
      beforeTurn: (c) => this.runBeforeTurn(session, c),
      executeTool: async (toolCall: AgentToolCall, context) =>
        this.executeTool(session, handlers, toolCall, context.signal)
    });
    session.agent = agent;

    this.wireAgentEvents(session);

    agent.restoreState({
      messages: persistedMessageData,
      queue: project.queue ?? [],
      compaction: project.compaction
    });

    client.setMessages([
      systemPrompt,
      ...client.getMessages().filter((message) => message.role !== 'system')
    ]);

    this.sessions.set(projectId, session);
    touchIdle(projectId);
    this.wireWatcher(session);
    return session;
  }

  /** Connects configured MCP servers. */
  private async connectMcpTools(
    projectId: string,
    localHandlers: ReadonlyMap<string, LocalToolHandler>
  ): Promise<{
    mcp: McpClientManager | null;
    mcpTools: ToolDefinitionRequest[];
  }> {
    try {
      const mcpServers = await globalSettingService.getMcpServersConfig();
      if (Object.keys(mcpServers).length === 0) {
        return { mcp: null, mcpTools: [] };
      }
      const { mcpClientManager, tools } =
        await mcpToolService.initializeMcpConnection(mcpServers);
      const mcpTools = tools.filter(
        (tool) => !localHandlers.has(tool.function.name)
      );
      if (mcpTools.length === 0) {
        await mcpClientManager.close().catch(() => {});
        return { mcp: null, mcpTools: [] };
      }
      logger.info('[agent] MCP tools connected', {
        projectId,
        toolCount: mcpTools.length
      });
      return { mcp: mcpClientManager, mcpTools };
    } catch (error) {
      logger.warn(
        '[agent] failed to connect MCP servers; continuing without MCP tools',
        { projectId, error }
      );
      return { mcp: null, mcpTools: [] };
    }
  }

  /** Applies per-user MCP bans and disabled-tool preferences. */
  private async filterMcpTools(
    userId: string,
    mcpTools: ToolDefinitionRequest[],
    localToolNames: ReadonlySet<string> = new Set()
  ): Promise<ToolDefinitionRequest[]> {
    if (mcpTools.length === 0) {
      return [];
    }
    const [rules, preferences] = await Promise.all([
      toolApprovalRuleRepo.findByUserId(userId),
      userService.getUserPreferences(userId)
    ]);
    const excluded = new Set([
      ...rules
        .filter((rule) => rule.approve === 'banned')
        .map((rule) => rule.tool_name),
      ...(preferences.disabledMcpTools ?? [])
    ]);
    return mcpTools.filter((tool) => {
      const name = tool.function.name;
      if (excluded.has(name)) {
        return false;
      }
      if (localToolNames.has(name)) {
        logger.info('[agent] MCP tool shadowed by built-in tool of same name', {
          tool: name
        });
        return false;
      }
      return true;
    });
  }

  /** Refreshes advertised tools for a session. */
  private async refreshAgentTools(session: AgentSession): Promise<void> {
    try {
      const local = sessionLocalDefinitions(session);
      const localToolNames = new Set(
        local.map((definition) => definition.function.name)
      );
      const enabledMcp =
        session.mcpTools.length > 0
          ? await this.filterMcpTools(
              session.userId,
              session.mcpTools,
              localToolNames
            )
          : [];
      session.apiClient.setTools([...local, ...enabledMcp]);
    } catch (error) {
      logger.warn('[agent] failed to refresh tool selection', {
        projectId: session.projectId,
        error
      });
    }
  }

  /** Creates the web-search delegate handler. */
  private createWebSearchHandler(projectId: string): LocalToolHandler {
    return async (args, context) => {
      const session = this.sessions.get(projectId);
      if (!session?.webSearchEnabled) {
        return { error: 'Web search is currently disabled.' };
      }
      const subAgent = createBrowserSubAgent(session.modelConfig, {
        extendedTimeoutEnabled: session.webSearchExtendedTimeoutEnabled
      });
      createSubAgentActivityRelay(subAgent, {
        emit: (activity) => {
          agentEventBus.emit(projectId, {
            type: 'sub-agent-activity',
            activity
          });
        }
      });
      const closeOnAbort = (): void => {
        void subAgent.close().catch(() => {});
      };
      context?.signal?.addEventListener('abort', closeOnAbort, { once: true });
      const delegate = createBrowserDelegateTool(subAgent);
      try {
        return await delegate.handler(args, context);
      } finally {
        context?.signal?.removeEventListener('abort', closeOnAbort);
        await subAgent.close().catch((error) => {
          logger.warn('[agent] failed to close browser sub-agent cleanly', {
            projectId,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    };
  }

  /** Executes a model tool call. */
  private async executeTool(
    session: AgentSession,
    handlers: Map<string, LocalToolHandler>,
    toolCall: AgentToolCall,
    signal?: AbortSignal
  ): Promise<{ approved: boolean; result?: unknown }> {
    const { name, arguments: rawArgs } = toolCall.function;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      return {
        approved: true,
        result: { error: `Invalid JSON arguments: ${rawArgs}` }
      };
    }
    if (name === ASK_USER_QUESTION_TOOL_NAME) {
      return this.askUserQuestion(session, toolCall.id, parsed, signal);
    }
    if (session.documentPromptEnabled && name === RESTART_PREVIEW_TOOL) {
      return {
        approved: true,
        result: {
          error:
            'This is a document task. Do not open the GUI preview; link the generated file in Markdown instead.'
        }
      };
    }
    const handler = handlers.get(name);
    if (!handler) {
      if (session.mcp && session.mcpToolNames.has(name)) {
        return this.executeMcpTool(session, toolCall.id, name, parsed, signal);
      }
      return { approved: true, result: { error: `Unknown tool: ${name}` } };
    }
    const blocked = session.plan.guard(name, parsed);
    if (blocked) {
      return { approved: true, result: blocked };
    }
    const result = await handler(parsed, { signal });
    session.plan.observe(name, parsed, result);
    return { approved: true, result };
  }

  /** Executes an MCP tool call. */
  private async executeMcpTool(
    session: AgentSession,
    toolCallId: string,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ approved: boolean; result?: unknown }> {
    const rule = await toolApprovalRuleRepo.findByUserIdAndToolName(
      session.userId,
      name
    );
    if (rule?.approve === 'banned') {
      return {
        approved: true,
        result: { error: `Tool is banned by the user: ${name}` }
      };
    }
    if (rule?.approve !== 'auto_approve') {
      const approved = await this.waitForToolApproval(
        session,
        toolCallId,
        name,
        args,
        signal
      );
      if (!approved) {
        return { approved: false };
      }
    }
    if (!session.mcp) {
      return { approved: true, result: { error: 'MCP is not connected.' } };
    }
    const result = await session.mcp.callTool(name, args);
    return { approved: true, result };
  }

  /** Waits for a tool-approval decision. */
  private async waitForToolApproval(
    session: AgentSession,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<boolean> {
    const json = JSON.stringify(args);
    const truncated = truncateToByteLength(json, APPROVAL_ARGS_MAX_BYTES);
    const toolArgs = truncated === json ? json : `${truncated}…`;
    const request: PendingToolApproval = {
      type: 'tool-approval',
      toolCallId,
      toolName,
      toolArgs
    };
    session.pendingApprovals.set(toolCallId, request);
    agentEventBus.emit(session.projectId, request);
    let approved = false;
    try {
      approved = await toolApprovalEmitter.waitForDecision(toolCallId, signal);
      return approved;
    } finally {
      session.pendingApprovals.delete(toolCallId);
      agentEventBus.emit(session.projectId, {
        type: 'tool-approval-resolved',
        toolCallId,
        approved
      });
    }
  }

  /** Lists pending tool-approval requests. */
  listPendingToolApprovals(projectId: string): PendingToolApproval[] {
    const session = this.sessions.get(projectId);
    return session ? [...session.pendingApprovals.values()] : [];
  }

  /** Asks the user a question from a tool call. */
  private async askUserQuestion(
    session: AgentSession,
    questionId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ approved: boolean; result?: unknown }> {
    const parsed = parseAskUserQuestionArgs(args);
    if (!parsed.ok) {
      logger.warn('[agent] ask_user_question rejected (bad args)', {
        projectId: session.projectId,
        error: parsed.error,
        args
      });
      return { approved: true, result: { error: parsed.error } };
    }
    const { question, header, options, multiSelect } = parsed.value;
    logger.info('[agent] ask_user_question waiting for answer', {
      projectId: session.projectId,
      questionId,
      optionCount: options.length,
      multiSelect
    });
    const request: PendingQuestion = {
      type: 'question',
      questionId,
      question,
      ...(header ? { header } : {}),
      options,
      multiSelect
    };
    session.pendingQuestions.set(questionId, request);
    agentEventBus.emit(session.projectId, request);
    let answer: string | null = null;
    try {
      answer = await questionEmitter.waitForAnswer(questionId, signal);
    } finally {
      session.pendingQuestions.delete(questionId);
      agentEventBus.emit(session.projectId, {
        type: 'question-resolved',
        questionId
      });
    }
    if (answer === null) {
      return {
        approved: true,
        result: {
          answered: false,
          note: 'The user did not answer (the turn was aborted or it timed out). Proceed with a reasonable default.'
        }
      };
    }
    return { approved: true, result: { answer } };
  }

  /** Lists pending user questions. */
  listPendingQuestions(projectId: string): PendingQuestion[] {
    const session = this.sessions.get(projectId);
    return session ? [...session.pendingQuestions.values()] : [];
  }

  // ---- agent event wiring (persist + publish) ------------------------------

  /** Wires ChatAgent event handlers. */
  private wireAgentEvents(session: AgentSession): void {
    const { agent, projectId } = session;

    agent.onMessageAdded((message) => this.persistMessage(session, message));

    agent.onMessage((text) => this.bufferStream(session, 'message', text));
    agent.onThinking((text) => this.bufferStream(session, 'thinking', text));
    agent.onReasoning((text) => this.bufferStream(session, 'reasoning', text));

    agent.onStatus((status) => {
      this.flushStream(session);
      agentEventBus.emit(projectId, { type: 'status', status });
    });
    agent.onQueueChanged((queue) => {
      this.persistQueue(session, queue);
      agentEventBus.emit(projectId, {
        type: 'queue-changed',
        queue: queue.map((item) => this.queueView(session, item))
      });
    });

    agent.onTurnStart((items) => {
      const displayTasks = items.map((item) =>
        session.plan.displayTask(item.text)
      );
      session.plan.syncTurn(items.map((item) => item.text));
      if (isDocumentTaskText(displayTasks.join('\n'))) {
        session.documentPromptEnabled = true;
      }
      session.workspace.onTurnStart(displayTasks);
      this.setStatus(session, 'running');
      agentEventBus.emit(projectId, {
        type: 'turn-start',
        items: items.map((item) => this.queueView(session, item))
      });
    });

    agent.onTurnComplete(async (_items, result) => {
      session.plan.endTurn();
      this.flushStream(session);
      await this.finishWorkspaceAndPreview(session, result);
      const status: AgentProjectStatus = session.agent.isRunning()
        ? 'running'
        : 'completed';
      this.setStatus(session, status);
      agentEventBus.emit(projectId, { type: 'turn-complete' });
    });

    agent.onError((error) => {
      logger.error('[agent] turn failed', {
        projectId,
        error: error.stack ?? error.message
      });
      session.plan.endTurn();
      this.flushStream(session);
      this.setStatus(session, 'failed');
      agentEventBus.emit(projectId, {
        type: 'error',
        message: error.message
      });
    });

    agent.onAbort(() => {
      session.plan.endTurn();
      this.flushStream(session);
    });

    agent.onIdle(() => {
      this.setStatus(session, 'idle');
      agentEventBus.emit(projectId, { type: 'idle' });
    });

    agent.onCompactionChanged((state) => {
      void agentProjectRepo.update(projectId, { compaction: state });
    });
  }

  /** Detects internal control prompts. */
  private isInternalNudge(message: MessageRequest): boolean {
    if (message.role !== 'user') {
      return false;
    }
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .map((part) => (part.type === 'text' ? part.text : ''))
            .join('');
    const trimmedText = text.trim();
    return (
      trimmedText === CODING_AGENT_ACT_NUDGE ||
      trimmedText === CHAT_AGENT_EMPTY_RESPONSE_NUDGE
    );
  }

  /** Detects blank assistant messages. */
  private isBlankAssistantMessage(message: MessageRequest): boolean {
    if (message.role !== 'assistant') {
      return false;
    }
    if (message.tool_calls && message.tool_calls.length > 0) {
      return false;
    }
    const content: unknown = message.content;
    if (typeof content === 'string') {
      return content.trim().length === 0;
    }
    if (Array.isArray(content)) {
      return (
        content.length === 0 ||
        content.every(
          (part) => part.type === 'text' && part.text.trim().length === 0
        )
      );
    }
    return true;
  }

  /** Persists a completed message. */
  private persistMessage(session: AgentSession, message: MessageRequest): void {
    if (
      this.isInternalNudge(message) ||
      this.isBlankAssistantMessage(message)
    ) {
      return;
    }
    this.flushStream(session);
    session.saveQueue = session.saveQueue
      .then(async () => {
        const role = message.role;
        const source = role === 'user' ? 'user' : 'assistant';
        const saved = await agentMessageRepo.append({
          project_id: session.projectId,
          role,
          source,
          data: message,
          model: session.modelConfig.model,
          provider: session.modelConfig.type,
          created_by: session.userId
        });
        agentEventBus.emitMessageRef(session.projectId, saved.id);
      })
      .catch((error) => {
        logger.error('[agent] failed to persist message', {
          projectId: session.projectId,
          error
        });
      });
  }

  /** Persists queued items. */
  private persistQueue(
    session: AgentSession,
    queue: readonly QueuedItem[]
  ): void {
    const queued = queue.filter(
      (item) => item.status === 'queued'
    ) as QueuedItem[];
    session.saveQueue = session.saveQueue
      .then(() => agentProjectRepo.update(session.projectId, { queue: queued }))
      .then(() => undefined)
      .catch((error) => {
        logger.warn('[agent] failed to persist queue', {
          projectId: session.projectId,
          error
        });
      });
  }

  /** Emits and persists project status. */
  private setStatus(session: AgentSession, status: AgentProjectStatus): void {
    agentEventBus.emit(session.projectId, { type: 'project-status', status });
    session.saveQueue = session.saveQueue
      .then(() => agentProjectRepo.update(session.projectId, { status }))
      .then(() => undefined)
      .catch((error) => {
        logger.warn('[agent] failed to set status', {
          projectId: session.projectId,
          error
        });
      });
  }

  /** Builds a queue item view. */
  private queueView(session: AgentSession, item: QueuedItem): AgentQueuedView {
    return {
      id: item.id,
      text: stripContextNote(session.plan.displayTask(item.text)),
      fileCount: item.imageUrls?.length ?? 0,
      status: item.status
    };
  }

  // ---- streaming coalescer -------------------------------------------------

  /** Buffers streamed text. */
  private bufferStream(
    session: AgentSession,
    kind: keyof StreamBuffer,
    text: string
  ): void {
    session.stream[kind] += text;
    if (Buffer.byteLength(session.stream[kind]) >= STREAM_FLUSH_BYTES) {
      this.flushStream(session);
      return;
    }
    if (!session.flushTimer) {
      session.flushTimer = setTimeout(() => {
        session.flushTimer = null;
        this.flushStream(session);
      }, STREAM_FLUSH_MS);
      session.flushTimer.unref?.();
    }
  }

  /** Emits buffered stream text. */
  private flushStream(session: AgentSession): void {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    const emitKind = (
      kind: keyof StreamBuffer,
      type: AgentServerEvent['type']
    ) => {
      const text = session.stream[kind];
      if (!text) {
        return;
      }
      session.stream[kind] = '';
      for (const piece of sliceByByteLength(text, STREAM_EMIT_MAX_BYTES)) {
        agentEventBus.emit(session.projectId, {
          type,
          text: piece
        } as AgentServerEvent);
      }
    };
    emitKind('message', 'chunk');
    emitKind('thinking', 'thinking');
    emitKind('reasoning', 'reasoning');
  }

  // ---- plan events ---------------------------------------------------------

  /** Persists a plan snapshot. */
  private persistPlan(session: AgentSession, plan: AgentMessagePlan): void {
    const snapshot: AgentMessagePlan = {
      summary: plan.summary,
      todos: plan.todos.map((todo) => ({ ...todo })),
      status: plan.status
    };
    session.saveQueue = session.saveQueue
      .then(async () => {
        await agentMessageRepo.setPlanForLatestAssistant(
          session.projectId,
          snapshot,
          session.userId
        );
      })
      .catch((error) => {
        logger.error('[agent] failed to persist plan', {
          projectId: session.projectId,
          error
        });
      });
  }

  /** Stores and broadcasts a presented plan. */
  private onPlanPresented(
    projectId: string,
    steps: string[],
    summary: string | null
  ): void {
    const session = this.sessions.get(projectId);
    const plan: AgentMessagePlan = {
      summary,
      todos: steps.map((text) => ({ text, status: 'pending' })),
      status: 'proposed'
    };
    if (session) {
      session.currentPlan = plan;
      this.persistPlan(session, plan);
    }
    agentEventBus.emit(projectId, { type: 'plan-presented', steps, summary });
  }

  /** Stores and broadcasts plan progress. */
  private onPlanProgress(projectId: string, todos: PlanTodoView[]): void {
    const session = this.sessions.get(projectId);
    const allDone =
      todos.length > 0 && todos.every((t) => t.status === 'completed');
    if (session?.currentPlan) {
      session.currentPlan.todos = todos.map((t) => ({ ...t }));
      session.currentPlan.status = allDone ? 'done' : 'running';
      this.persistPlan(session, session.currentPlan);
    }
    agentEventBus.emit(projectId, { type: 'plan-progress', todos });
  }

  // ---- compaction ----------------------------------------------------------

  /** Refreshes the session system prompt. */
  private refreshSystemPrompt(session: AgentSession, client: ChatClient): void {
    const systemPrompt: MessageRequest = {
      role: 'system',
      content: buildAgentSystemPromptContent({
        sandbox: session.sandbox,
        documentTask: session.documentPromptEnabled
      })
    };
    client.setMessages([
      systemPrompt,
      ...client.getMessages().filter((message) => message.role !== 'system')
    ]);
  }

  /** Runs pre-turn session preparation. */
  private async runBeforeTurn(
    session: AgentSession,
    client: ChatClient
  ): Promise<void> {
    this.refreshSystemPrompt(session, client);
    await session.workspace.prepareTurn();
    await this.refreshAgentTools(session);
    if (session.maxContext === null) {
      return;
    }
    const state = session.agent.getCompactionState();
    const result = await summarizeIncremental(client.getMessages(), {
      maxContextTokens: session.maxContext,
      compactThresholdRatio: SUMMARY_THRESHOLD_RATIO,
      recentMessagesToKeep: SUMMARY_RECENT_KEEP,
      previousSummary: state.summary,
      coveredCount: state.coveredCount,
      summarize: ({ previousSummary, conversationText }) =>
        this.runSummarize(session, previousSummary, conversationText)
    });
    if (!result.summarized) {
      return;
    }
    logger.info('[agent] context summarized (compaction fired)', {
      projectId: session.projectId,
      coveredCount: result.coveredCount,
      summaryChars: result.summary.length
    });
    session.agent.setCompactionState({
      summary: result.summary,
      coveredCount: result.coveredCount
    });
  }

  /** Summarizes conversation history. */
  private async runSummarize(
    session: AgentSession,
    previousSummary: string,
    conversationText: string
  ): Promise<string> {
    try {
      const summarizer = createChatApiClient(
        session.modelConfig,
        [],
        STREAM_GUARD
      );
      const userPrompt = [
        previousSummary
          ? `Existing summary so far:\n${previousSummary}`
          : 'There is no existing summary yet.',
        '',
        'New conversation transcript to fold in:',
        conversationText,
        '',
        'Return ONLY the updated summary.'
      ].join('\n');
      const res = await summarizer.chatStream([
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]);
      return typeof res.content === 'string' ? res.content.trim() : '';
    } catch {
      return '';
    }
  }

  // ---- file watcher --------------------------------------------------------

  /** Wires sandbox file watching. */
  private wireWatcher(session: AgentSession): void {
    const { sandbox } = session;
    const watch = sandbox.watch?.bind(sandbox);
    if (!watch) {
      return;
    }
    session.watcher = watch((event) => {
      session.watchPending.push(event);
      if (!session.watchTimer) {
        session.watchTimer = setTimeout(() => {
          session.watchTimer = null;
          const batch = session.watchPending;
          session.watchPending = [];
          const changes = coalesceChanges(batch);
          if (changes.length > 0) {
            this.emitFileChanges(session.projectId, changes);
            if (changes.some((change) => isLockfilePath(change.path))) {
              void this.resendTree(session.projectId);
            }
          }
        }, WATCH_DEBOUNCE_MS);
        session.watchTimer.unref?.();
      }
    });
  }

  /** Emits file-change events. */
  private emitFileChanges(
    projectId: string,
    changes: ReturnType<typeof coalesceChanges>
  ): void {
    let batch: ReturnType<typeof coalesceChanges> = [];
    let bytes = 0;
    const flush = (): void => {
      if (batch.length === 0) {
        return;
      }
      agentEventBus.emit(projectId, { type: 'file-changed', changes: batch });
      batch = [];
      bytes = 0;
    };
    for (const change of changes) {
      const size = Buffer.byteLength(JSON.stringify(change)) + 1;
      if (batch.length > 0 && bytes + size > FILE_CHANGES_MAX_BYTES) {
        flush();
      }
      batch.push(change);
      bytes += size;
    }
    flush();
  }

  // ---- file tree (served locally; large payloads stay off NOTIFY) ----------

  /** Builds the project file trees. */
  async buildTree(
    projectId: string
  ): Promise<{ nodes: AgentFileNode[]; contextNodes: AgentFileNode[] }> {
    const sandbox = await sandboxManager.getSandbox(projectId);
    const snapshot = await sandbox.snapshot({ exclude: TREE_SNAPSHOT_EXCLUDE });
    void this.emitPreviewAvailability(projectId, sandbox);
    return splitFileTrees(snapshot);
  }

  /** Builds a workspace ZIP archive. */
  async buildWorkspaceZip(projectId: string): Promise<Buffer> {
    const sandbox = await sandboxManager.getSandbox(projectId);
    const snapshot = await sandbox.snapshot();
    const paths = [...snapshot.keys()].filter(
      (filePath) => !isHiddenAgentPath(filePath)
    );

    const entries: ZipEntry[] = new Array(paths.length);
    const CONCURRENCY = 8;
    let cursor = 0;
    const readNext = async (): Promise<void> => {
      for (let i = cursor++; i < paths.length; i = cursor++) {
        const filePath = paths[i];
        const content = await sandbox.readBinary(filePath);
        const mtimeMs = snapshot.get(filePath)?.mtimeMs;
        entries[i] = {
          path: filePath,
          content,
          mtime: mtimeMs ? new Date(mtimeMs) : undefined
        };
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, paths.length) }, readNext)
    );

    return ZipUtils.createArchive(entries);
  }

  /** Finishes workspace and preview updates after a turn. */
  private async finishWorkspaceAndPreview(
    session: AgentSession,
    result?: TurnResult
  ): Promise<void> {
    try {
      await session.workspace.onTurnComplete(result);
    } catch (error) {
      logger.warn('[agent] workspace finalization failed', {
        projectId: session.projectId,
        error
      });
    }

    await this.resendTree(session.projectId);

    await this.emitPreviewAvailability(session.projectId, session.sandbox);
    await this.maybeAutoOpenPreview(session);
  }

  /** Auto-opens the GUI preview after a turn. */
  private async maybeAutoOpenPreview(session: AgentSession): Promise<void> {
    const calledRestart = session.restartPreviewCalledThisTurn;
    session.restartPreviewCalledThisTurn = false;
    if (session.documentPromptEnabled) {
      return;
    }
    try {
      const recordedSig = await agentGuiService.previewSignature(
        session.sandbox
      );
      let sig = recordedSig;
      if (!recordedSig) {
        if (await agentGuiService.ensureStaticHtmlPreview(session.sandbox)) {
          await this.emitPreviewAvailability(
            session.projectId,
            session.sandbox
          );
          sig = await agentGuiService.previewSignature(session.sandbox);
        }
      }
      if (!sig) {
        return;
      }
      const changed = sig !== session.lastPreviewSig;
      session.lastPreviewSig = sig;
      if (calledRestart || (recordedSig !== '' && changed)) {
        logger.info('[agent] opening preview after turn completion', {
          projectId: session.projectId,
          changed,
          calledRestart
        });
        agentEventBus.emit(session.projectId, { type: 'preview-open' });
      }
    } catch (error) {
      logger.warn('[agent] preview auto-open check failed', {
        projectId: session.projectId,
        error
      });
    }
  }

  /** Emits preview availability. */
  private async emitPreviewAvailability(
    projectId: string,
    sandbox: Sandbox
  ): Promise<void> {
    try {
      agentEventBus.emit(projectId, await buildPreviewAvailableEvent(sandbox));
    } catch (error) {
      logger.warn('[agent] failed to check preview availability', {
        projectId,
        error
      });
    }
  }

  /** Deletes an uploaded context file. */
  async deleteContextFile(projectId: string, name: string): Promise<void> {
    const base = path.basename(name).replace(/^\.+/, '');
    if (!base) {
      return;
    }
    const sandbox = await sandboxManager.getSandbox(projectId);
    const root = sandbox.getWorkspaceDir?.() ?? null;
    const rel = `${CONTEXT_UPLOAD_DIR}/${base}`;
    const target = root ? `${root}/${rel}` : rel;
    const quote = (value: string): string =>
      `'${value.replace(/'/g, `'\\''`)}'`;
    await sandbox.exec(
      `rm -f -- ${quote(target)} ${quote(`${target}._context.txt`)}`
    );
    await this.resendTree(projectId);
  }

  /** Sends a fresh file tree to subscribers. */
  private async resendTree(projectId: string): Promise<void> {
    try {
      const { nodes, contextNodes } = await this.buildTree(projectId);
      agentEventBus.sendToProjectSubscribers(projectId, {
        type: 'file-tree',
        nodes,
        contextNodes
      });
    } catch (error) {
      logger.warn('[agent] failed to resend file tree after lockfile change', {
        projectId,
        error
      });
    }
  }

  /** Checks whether a project is active. */
  isProjectActive(projectId: string): boolean {
    const session = this.sessions.get(projectId);
    if (!session) {
      return false;
    }
    return (
      session.agent.isRunning() ||
      session.agent.getQueue().length > 0 ||
      agentEventBus.localSubscriberCount(projectId) > 0
    );
  }

  // ---- idle eviction -------------------------------------------------------

  private sweepIdle(): void {
    const now = Date.now();
    for (const session of [...this.sessions.values()]) {
      const idle = now - session.lastActiveAt > IDLE_EVICT_MS;
      if (idle && !this.isProjectActive(session.projectId)) {
        void this.evict(session.projectId);
      }
    }
  }

  private async evict(projectId: string): Promise<void> {
    const session = this.sessions.get(projectId);
    if (!session) {
      return;
    }
    session.watcher?.stop();
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
    }
    if (session.watchTimer) {
      clearTimeout(session.watchTimer);
    }
    await session.mcp?.close().catch(() => {});
    this.sessions.delete(projectId);
    await this.release(projectId);
    logger.info('[agent] evicted idle session', { projectId });
  }

  /** Removes a queued item from persisted state. */
  private async removeQueuedFromDb(
    projectId: string,
    itemId: string
  ): Promise<void> {
    const project = await agentProjectRepo.findById(projectId);
    if (!project) {
      return;
    }
    const queue = project.queue ?? [];
    const next = queue.filter((item) => item.id !== itemId);
    if (next.length === queue.length) {
      return;
    }
    await agentProjectRepo.update(projectId, { queue: next });
    agentEventBus.emit(projectId, {
      type: 'queue-changed',
      queue: this.buildQueueViews({ ...project, queue: next })
    });
  }

  /** Builds queue views for a project. */
  buildQueueViews(project: AgentProject): AgentQueuedView[] {
    return (project.queue ?? []).map((item) => ({
      id: item.id,
      text: stripContextNote(item.text),
      fileCount: item.imageUrls?.length ?? 0,
      status: item.status
    }));
  }
}

export const agentSessionService = new AgentSessionService();
