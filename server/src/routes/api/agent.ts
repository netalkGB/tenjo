import express from 'express';
import path from 'node:path';
import { StatusCodes } from 'http-status-codes';
import { requireCsrfToken } from '../../middleware/csrf';
import { requireAuth } from '../../middleware/auth';
import { agentMessageRepo } from '../../repositories/registry';
import {
  AGENT_SANDBOX_UNAVAILABLE_MESSAGE,
  sandboxManager,
  isAgentSandboxUsable,
  getSandboxStatus,
  type SandboxStatusInfo
} from '../../services/AgentSandboxService';
import {
  agentGuiService,
  agentProjectService,
  fileUploadService,
  globalSettingService,
  knowledgeService,
  questionEmitter,
  toolApprovalEmitter
} from '../../services/registry';
import { ModelNotFoundError } from '../../services/GlobalSettingService';
import { agentSessionService } from '../../services/AgentSessionService';
import {
  toAgentMessageView,
  type AgentServerEvent
} from '../../types/agentProtocol';
import {
  CONTEXT_UPLOAD_DIR,
  contentTypeForAgentFile
} from '../../utils/agentFiles';
import { generateUuidV4 } from '../../utils/generateUuidV4';
import {
  type SessionUser,
  type TypedRequest,
  typedHandler
} from '../../types/api';
import { HttpError } from '../../errors/HttpError';
import type {
  AgentProject,
  AgentProjectMode,
  AgentProjectModelSnapshot
} from '../../repositories/AgentProjectRepository';
import {
  DockerUnavailableError,
  PathJailError,
  SandboxCommandError,
  SandboxConfigurationError,
  SandboxError,
  SandboxFileOperationError,
  SandboxGuiError,
  SandboxResourceExhaustedError,
  SandboxSetupError
} from 'tenjo-chat-engine';

// Verify the request's user owns the project, or throw 404.
async function ownProject(
  req: TypedRequest<{ params: { id: string } }>
): Promise<AgentProject> {
  const user = req.user as SessionUser;
  const project = await agentProjectService.findByIdAndUser(
    req.params.id,
    user.id
  );
  if (!project) {
    throw new HttpError(StatusCodes.NOT_FOUND, 'Project not found.');
  }
  return project;
}

function sandboxHttpError(error: unknown, fallbackMessage: string): HttpError {
  if (
    error instanceof PathJailError ||
    error instanceof SandboxConfigurationError
  ) {
    return new HttpError(StatusCodes.BAD_REQUEST, error.message);
  }
  if (error instanceof SandboxFileOperationError) {
    const status =
      error.operation === 'read' || error.operation === 'list'
        ? StatusCodes.NOT_FOUND
        : StatusCodes.BAD_REQUEST;
    return new HttpError(status, error.message);
  }
  if (error instanceof SandboxResourceExhaustedError) {
    return new HttpError(StatusCodes.CONFLICT, error.message);
  }
  if (error instanceof SandboxGuiError) {
    return new HttpError(StatusCodes.CONFLICT, error.message);
  }
  if (
    error instanceof DockerUnavailableError ||
    error instanceof SandboxCommandError ||
    error instanceof SandboxSetupError
  ) {
    return new HttpError(StatusCodes.SERVICE_UNAVAILABLE, error.message);
  }
  if (error instanceof SandboxError) {
    return new HttpError(StatusCodes.INTERNAL_SERVER_ERROR, error.message);
  }
  return new HttpError(
    StatusCodes.INTERNAL_SERVER_ERROR,
    error instanceof Error ? error.message : fallbackMessage
  );
}

export const agentRouter = express.Router();

agentRouter.use(requireAuth);

const CONTEXT_FILE_MAX_SIZE = 50 * 1024 * 1024;

interface ContextFileUploadResult {
  ref: string;
  name: string;
}

function decodeContextFileName(raw: string | undefined): string {
  if (!raw) {
    return 'file';
  }
  try {
    return path.basename(decodeURIComponent(raw)) || 'file';
  } catch {
    return path.basename(raw) || 'file';
  }
}

interface AgentProjectDto {
  id: string;
  title: string;
  status: string;
  mode: string;
  pinned: boolean;
  agentModel: AgentProjectModelSnapshot | null;
  updatedAt: string | null;
}

function toProjectDto(project: AgentProject): AgentProjectDto {
  const agentModel =
    project.model_id && project.model && project.provider
      ? {
          id: project.model_id,
          provider: project.provider,
          model: project.model,
          baseUrl: project.model_base_url ?? ''
        }
      : null;

  return {
    id: project.id,
    title: project.title,
    status: project.status,
    mode: project.mode,
    pinned: project.pinned,
    agentModel,
    updatedAt: project.updated_at ? project.updated_at.toISOString() : null
  };
}

// Wire form of the sandbox status (the internal `unknown` reads as `preparing`).
function toSandboxStatusEvent(
  info: SandboxStatusInfo
): Extract<AgentServerEvent, { type: 'sandbox-status' }> {
  return {
    type: 'sandbox-status',
    status: info.status === 'unknown' ? 'preparing' : info.status,
    detail: info.detail
  };
}

async function resolveAgentProjectModel(
  requestedModelId: string | undefined
): Promise<AgentProjectModelSnapshot> {
  const modelSettings = await globalSettingService.getModelSettings();
  const modelId = requestedModelId ?? modelSettings.activeId;
  try {
    const model = await globalSettingService.resolveModelReference(modelId);
    return {
      id: model.id,
      provider: model.type,
      model: model.model,
      baseUrl: model.baseUrl
    };
  } catch (error) {
    if (error instanceof ModelNotFoundError) {
      throw new HttpError(StatusCodes.BAD_REQUEST, error.message);
    }
    throw error;
  }
}

// Create a new agent project (one task = one sandbox, created lazily on submit).
agentRouter.post(
  '/projects',
  requireCsrfToken,
  typedHandler<{ body: { mode?: string; modelId?: string } }>(
    async (req, res) => {
      if (!isAgentSandboxUsable()) {
        throw new HttpError(
          StatusCodes.SERVICE_UNAVAILABLE,
          AGENT_SANDBOX_UNAVAILABLE_MESSAGE
        );
      }
      const user = req.user as SessionUser;
      const model = await resolveAgentProjectModel(
        typeof req.body.modelId === 'string' ? req.body.modelId : undefined
      );
      const project = await agentProjectService.createProject(
        user.id,
        req.body.mode,
        model
      );
      if (!project) {
        throw new HttpError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          'Failed to create project.'
        );
      }
      res.json({ projectId: project.id });
    }
  )
);

// List the current user's agent projects (recent first).
agentRouter.get(
  '/projects',
  requireCsrfToken,
  typedHandler<{
    query: { search?: string; page?: string; pageSize?: string };
  }>(async (req, res) => {
    const user = req.user as SessionUser;
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const pageSize =
      Number(req.query.pageSize) > 0 ? Number(req.query.pageSize) : 10;
    const result = await agentProjectService.listByUser(
      user.id,
      pageSize,
      page,
      req.query.search
    );
    res.json({
      projects: result.projects.map(toProjectDto),
      totalPages: result.totalPages,
      currentPage: result.currentPage,
      totalCount: result.totalCount
    });
  })
);

agentRouter.post(
  '/context-files',
  requireCsrfToken,
  express.raw({ type: '*/*', limit: CONTEXT_FILE_MAX_SIZE }),
  async (req, res: express.Response<ContextFileUploadResult>) => {
    const fileBuffer = req.body as Buffer;
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
      throw new HttpError(StatusCodes.BAD_REQUEST, 'No file data received.');
    }
    const name = decodeContextFileName(req.header('X-File-Name'));
    const ref = `${generateUuidV4()}${path.extname(name)}`;
    await fileUploadService.save(ref, fileBuffer);
    res.json({ ref, name });
  }
);

// Project meta + restored conversation/queue (history loads over REST, not WS).
agentRouter.get(
  '/projects/:id',
  requireCsrfToken,
  typedHandler<{ params: { id: string } }>(async (req, res) => {
    const user = req.user as SessionUser;
    const project = await agentProjectService.findByIdAndUser(
      req.params.id,
      user.id
    );
    if (!project) {
      throw new HttpError(StatusCodes.NOT_FOUND, 'Project not found.');
    }
    const messages = await agentMessageRepo.listByProject(project.id);
    res.json({
      project: toProjectDto(project),
      messages: messages.map(toAgentMessageView),
      queue: agentSessionService.buildQueueViews(project)
    });
  })
);

// Rename / pin / change mode.
agentRouter.patch(
  '/projects/:id',
  requireCsrfToken,
  typedHandler<{
    params: { id: string };
    body: { title?: string; pinned?: boolean; mode?: string };
  }>(async (req, res) => {
    const user = req.user as SessionUser;
    const project = await agentProjectService.findByIdAndUser(
      req.params.id,
      user.id
    );
    if (!project) {
      throw new HttpError(StatusCodes.NOT_FOUND, 'Project not found.');
    }
    const updated = await agentProjectService.updateProject(project.id, {
      title: req.body.title,
      pinned: req.body.pinned,
      mode: req.body.mode
    });
    res.json({ project: toProjectDto(updated ?? project) });
  })
);

// Delete a project, its messages (CASCADE) and its sandbox workspace.
agentRouter.delete(
  '/projects/:id',
  requireCsrfToken,
  typedHandler<{ params: { id: string } }>(async (req, res) => {
    const user = req.user as SessionUser;
    const project = await agentProjectService.findByIdAndUser(
      req.params.id,
      user.id
    );
    if (!project) {
      throw new HttpError(StatusCodes.NOT_FOUND, 'Project not found.');
    }
    await agentProjectService.deleteProject(project.id);
    try {
      await sandboxManager.destroy(project.id);
    } catch {
      // The workspace may not exist yet (sandbox never created) — ignore.
    }
    res.json({ ok: true });
  })
);

// Download a single artifact from the sandbox as binary.
agentRouter.get(
  '/projects/:id/files',
  requireCsrfToken,
  typedHandler<{ params: { id: string }; query: { path?: string } }>(
    async (req, res) => {
      const user = req.user as SessionUser;
      const project = await agentProjectService.findByIdAndUser(
        req.params.id,
        user.id
      );
      if (!project) {
        throw new HttpError(StatusCodes.NOT_FOUND, 'Project not found.');
      }
      const relPath = req.query.path;
      if (!relPath) {
        throw new HttpError(StatusCodes.BAD_REQUEST, 'Missing path.');
      }
      if (!isAgentSandboxUsable()) {
        throw new HttpError(
          StatusCodes.SERVICE_UNAVAILABLE,
          AGENT_SANDBOX_UNAVAILABLE_MESSAGE
        );
      }
      const sandbox = await sandboxManager.getSandbox(project.id);
      try {
        const buffer = await sandbox.readBinary(relPath);
        // RFC 5987: a non-ASCII filename put raw in
        // the Content-Disposition header throws "Invalid character in header
        // content" (HTTP headers are Latin-1), which previously surfaced to the
        // browser as a failed download. Provide an ASCII fallback for `filename`
        // and the UTF-8 percent-encoded real name in `filename*`.
        const fileName = path.basename(relPath);
        const asciiFallback = fileName
          .replace(/[^\x20-\x7e]/g, '_')
          .replace(/["\\]/g, '_');
        const contentType = contentTypeForAgentFile(fileName);
        const dispositionType =
          contentType === 'application/pdf' ? 'inline' : 'attachment';
        res.setHeader(
          'Content-Disposition',
          `${dispositionType}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(
            fileName
          )}`
        );
        res.setHeader('Content-Type', contentType);
        res.send(buffer);
      } catch (error) {
        throw sandboxHttpError(error, 'File not found.');
      }
    }
  )
);

// Download the whole workspace as a ZIP archive.
agentRouter.get(
  '/projects/:id/zip',
  requireCsrfToken,
  typedHandler<{ params: { id: string } }>(async (req, res) => {
    const project = await ownProject(req);
    if (!isAgentSandboxUsable()) {
      throw new HttpError(
        StatusCodes.SERVICE_UNAVAILABLE,
        AGENT_SANDBOX_UNAVAILABLE_MESSAGE
      );
    }
    const archive = await agentSessionService.buildWorkspaceZip(project.id);
    // Name the download after the project UUID (ASCII-only, so no RFC 5987
    // encoding is needed).
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${project.id}.zip"`
    );
    res.setHeader('Content-Type', 'application/zip');
    res.send(archive);
  })
);

// Delete an uploaded context file (and its image sidecar) from the sandbox.
agentRouter.delete(
  '/projects/:id/context-files',
  requireCsrfToken,
  typedHandler<{ params: { id: string }; query: { path?: string } }>(
    async (req, res) => {
      const project = await ownProject(req);
      const relPath = req.query.path;
      if (!relPath) {
        throw new HttpError(StatusCodes.BAD_REQUEST, 'Missing path.');
      }
      // Only files inside the uploaded-context dir may be removed here.
      const normalized = relPath.replace(/^\/+/, '');
      if (
        normalized !== CONTEXT_UPLOAD_DIR &&
        !normalized.startsWith(`${CONTEXT_UPLOAD_DIR}/`)
      ) {
        throw new HttpError(
          StatusCodes.BAD_REQUEST,
          'Only uploaded context files can be deleted here.'
        );
      }
      await agentSessionService.deleteContextFile(project.id, normalized);
      res.json({ ok: true });
    }
  )
);

/*
 * Start the project's GUI preview (VNC sidecar) in the background. The start
 * can take a while (first run builds the GUI image), so the response returns
 * immediately and progress flows as `gui-status` SSE events.
 */
agentRouter.post(
  '/projects/:id/gui/start',
  requireCsrfToken,
  typedHandler<{ params: { id: string }; body: { ime?: unknown } }>(
    async (req, res) => {
      const project = await ownProject(req);
      if (!isAgentSandboxUsable()) {
        throw new HttpError(
          StatusCodes.SERVICE_UNAVAILABLE,
          AGENT_SANDBOX_UNAVAILABLE_MESSAGE
        );
      }
      agentGuiService.start(project, req.body.ime !== false);
      res.json({ ok: true });
    }
  )
);

/*
 * Open the GUI preview on a page: makes sure the project's dev server is
 * running (restarting it from the agent-recorded manifest when it died), then
 * starts the GUI with that page open — or hands the URL to the running browser.
 * `url` must be a localhost URL from the agent's answer; without it the most
 * recently recorded dev server is used. Background like gui/start.
 */
agentRouter.post(
  '/projects/:id/gui/open',
  requireCsrfToken,
  typedHandler<{
    params: { id: string };
    body: { url?: unknown; ime?: unknown };
  }>(async (req, res) => {
    const project = await ownProject(req);
    if (!isAgentSandboxUsable()) {
      throw new HttpError(
        StatusCodes.SERVICE_UNAVAILABLE,
        AGENT_SANDBOX_UNAVAILABLE_MESSAGE
      );
    }
    const url = typeof req.body.url === 'string' ? req.body.url : undefined;
    agentGuiService.open(project, url, req.body.ime !== false);
    res.json({ ok: true });
  })
);

/*
 * Toggle the GUI's IME (direct input ⇄ Mozc). A UI button calls this because
 * the in-session trigger key (Ctrl+Space) is frequently captured by the
 * user's LOCAL IME before the browser ever sees it.
 */
agentRouter.post(
  '/projects/:id/gui/ime-toggle',
  requireCsrfToken,
  typedHandler<{ params: { id: string } }>(async (req, res) => {
    const project = await ownProject(req);
    try {
      await agentGuiService.toggleIme(project);
    } catch (error) {
      const httpError = sandboxHttpError(error, 'Failed to toggle the IME.');
      throw httpError.statusCode === StatusCodes.INTERNAL_SERVER_ERROR
        ? new HttpError(StatusCodes.CONFLICT, httpError.message)
        : httpError;
    }
    res.json({ ok: true });
  })
);

// Stop the project's GUI preview.
agentRouter.post(
  '/projects/:id/gui/stop',
  requireCsrfToken,
  typedHandler<{ params: { id: string } }>(async (req, res) => {
    const project = await ownProject(req);
    await agentGuiService.stop(project);
    res.json({ ok: true });
  })
);

// Current GUI preview status (initial fetch; SSE pushes updates).
agentRouter.get(
  '/projects/:id/gui',
  requireCsrfToken,
  typedHandler<{ params: { id: string } }>(async (req, res) => {
    const project = await ownProject(req);
    res.json({ status: await agentGuiService.status(project) });
  })
);

// Current shared-sandbox lifecycle status (initial fetch; WebSocket pushes updates).
agentRouter.get(
  '/sandbox-status',
  requireCsrfToken,
  typedHandler(async (_req, res) => {
    res.json(toSandboxStatusEvent(getSandboxStatus()));
  })
);

// Snapshot the sandbox file tree as JSON (used for manual refreshes).
agentRouter.get(
  '/projects/:id/files/tree',
  requireCsrfToken,
  typedHandler<{ params: { id: string } }>(async (req, res) => {
    const project = await ownProject(req);
    const { nodes } = await agentSessionService.buildTree(project.id);
    res.json({ nodes });
  })
);

// Submit a prompt (plan mode wraps it; steer mode queues it).
agentRouter.post(
  '/projects/:id/messages',
  requireCsrfToken,
  typedHandler<{
    params: { id: string };
    body: {
      text?: string;
      mode?: string;
      contextFiles?: { ref?: unknown; name?: unknown }[];
      knowledgeIds?: unknown[];
      webSearchEnabled?: unknown;
      webSearchExtendedTimeoutEnabled?: unknown;
    };
  }>(async (req, res) => {
    const project = await ownProject(req);
    const user = req.user as SessionUser;
    const text = typeof req.body.text === 'string' ? req.body.text : '';
    const mode: AgentProjectMode = req.body.mode === 'steer' ? 'steer' : 'plan';
    const uploadedFiles = Array.isArray(req.body.contextFiles)
      ? req.body.contextFiles.flatMap((f) =>
          f && typeof f.ref === 'string' && typeof f.name === 'string'
            ? [{ ref: f.ref, name: f.name }]
            : []
        )
      : [];
    // Selected knowledge entries join the same context-file pipeline: their
    // content is copied into transient artifacts HERE (the only place the
    // requesting user is known — the submit command may travel the NOTIFY bus,
    // whose payload is too small to carry the content itself) and materialized
    // into the sandbox `_uploads/` dir like any other attachment.
    const knowledgeIds = Array.isArray(req.body.knowledgeIds)
      ? req.body.knowledgeIds.filter(
          (id): id is string => typeof id === 'string'
        )
      : [];
    const knowledgeFiles = knowledgeIds.length
      ? await knowledgeService.copyToArtifacts(knowledgeIds, user.id)
      : [];
    const contextFiles = [...uploadedFiles, ...knowledgeFiles];
    await agentSessionService.dispatchCommand(project.id, user.id, {
      type: 'submit',
      text,
      mode,
      contextFiles: contextFiles.length ? contextFiles : undefined,
      webSearchEnabled: req.body.webSearchEnabled === true,
      webSearchExtendedTimeoutEnabled:
        req.body.webSearchEnabled === true &&
        req.body.webSearchExtendedTimeoutEnabled === true
    });
    res.json({ ok: true });
  })
);

// Approve or reject (with optional feedback) the pending plan.
agentRouter.post(
  '/projects/:id/plan',
  requireCsrfToken,
  typedHandler<{
    params: { id: string };
    body: { action?: string; feedback?: string };
  }>(async (req, res) => {
    const project = await ownProject(req);
    const user = req.user as SessionUser;
    if (req.body.action === 'approve') {
      await agentSessionService.dispatchCommand(project.id, user.id, {
        type: 'plan-approve'
      });
    } else {
      await agentSessionService.dispatchCommand(project.id, user.id, {
        type: 'plan-reject',
        feedback:
          typeof req.body.feedback === 'string' ? req.body.feedback : undefined
      });
    }
    res.json({ ok: true });
  })
);

/*
 * Approve or reject a pending MCP tool call. Mirrors the chat flow's
 * POST /api/chat/tools/:toolCallId/approve: the decision travels through
 * ToolApprovalEmitter's Postgres NOTIFY channel, so it reaches the instance
 * running the agent even when this request landed elsewhere.
 */
agentRouter.post(
  '/projects/:id/tools/:toolCallId/approve',
  requireCsrfToken,
  typedHandler<{
    params: { id: string; toolCallId: string };
    body: { approved?: unknown };
  }>(async (req, res) => {
    await ownProject(req);
    if (typeof req.body.approved !== 'boolean') {
      throw new HttpError(
        StatusCodes.BAD_REQUEST,
        'approved must be a boolean'
      );
    }
    await toolApprovalEmitter.sendApproval(
      req.params.toolCallId,
      req.body.approved
    );
    res.json({ ok: true });
  })
);

/*
 * Answer a pending ask_user_question. Like the approve route, the answer travels
 * through QuestionEmitter's NOTIFY channel so it reaches whichever instance owns
 * the agent. The answer is capped to keep it under the NOTIFY payload limit.
 */
const QUESTION_ANSWER_MAX_LENGTH = 2000;
agentRouter.post(
  '/projects/:id/questions/:questionId/answer',
  requireCsrfToken,
  typedHandler<{
    params: { id: string; questionId: string };
    body: { answer?: unknown };
  }>(async (req, res) => {
    await ownProject(req);
    if (typeof req.body.answer !== 'string' || !req.body.answer.trim()) {
      throw new HttpError(
        StatusCodes.BAD_REQUEST,
        'answer must be a non-empty string'
      );
    }
    await questionEmitter.sendAnswer(
      req.params.questionId,
      req.body.answer.slice(0, QUESTION_ANSWER_MAX_LENGTH)
    );
    res.json({ ok: true });
  })
);

// Abort the running turn (optionally clearing the queue).
agentRouter.post(
  '/projects/:id/abort',
  requireCsrfToken,
  typedHandler<{ params: { id: string }; body: { clearQueue?: boolean } }>(
    async (req, res) => {
      const project = await ownProject(req);
      const user = req.user as SessionUser;
      await agentSessionService.dispatchCommand(project.id, user.id, {
        type: 'abort',
        clearQueue: req.body.clearQueue === true
      });
      res.json({ ok: true });
    }
  )
);

// Remove a still-queued prompt.
agentRouter.delete(
  '/projects/:id/queue/:itemId',
  requireCsrfToken,
  typedHandler<{ params: { id: string; itemId: string } }>(async (req, res) => {
    const project = await ownProject(req);
    const user = req.user as SessionUser;
    await agentSessionService.dispatchCommand(project.id, user.id, {
      type: 'queue-remove',
      id: req.params.itemId
    });
    res.json({ ok: true });
  })
);
