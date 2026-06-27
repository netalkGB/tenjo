import express from 'express';
import path from 'node:path';
import { StatusCodes } from 'http-status-codes';
import { requireCsrfToken } from '../../middleware/csrf';
import { requireAuth } from '../../middleware/auth';
import {
  threadRepo,
  messageRepo,
  toolApprovalRuleRepo,
  imageAnalysisCacheRepo
} from '../../repositories/registry';
import {
  globalSettingService,
  mcpToolService,
  knowledgeService,
  fileUploadService,
  imageService,
  artifactAccessService
} from '../../services/registry';
import { systemPromptBuilder } from '../../factories/SystemPromptBuilder';
import { createImageAnalysisProvider } from '../../services/ImageAnalysisCacheService';
import {
  type ErrorResponse,
  type SessionUser,
  typedHandler
} from '../../types/api';
import { HttpError } from '../../errors/HttpError';
import type { Thread } from '../../repositories/ThreadRepository';
import type { ModelConfig } from '../../repositories/GlobalSettingRepository';
import {
  type McpClientManager,
  type MessageRequest,
  type ToolDefinitionRequest,
  type LocalToolHandler,
  type Tool,
  ImageAnalysisProcessor,
  bundleTools,
  codeExecutionTool,
  createBrowserDelegateTool
} from 'tenjo-chat-engine';
import { createBrowserSubAgent } from '../../factories/browserSubAgentFactory';
import {
  createChatClient,
  createChatApiClient
} from '../../factories/chatClientFactory';
import {
  createSubAgentActivityRelay,
  type SubAgentActivityWriter
} from '../../relays/SubAgentActivityRelay';
import { toolApprovalEmitter } from '../../events/ToolApprovalEmitter';
import { generationAbortRegistry } from '../../registries/GenerationAbortRegistry';
import {
  ThreadService,
  ThreadNotFoundError,
  ThreadValidationError,
  ThreadOperationError
} from '../../services/ThreadService';
import {
  MessageService,
  MessageNotFoundError,
  MessageValidationError,
  type StreamWriter,
  type ThreadMessage,
  type BranchStatusInfo
} from '../../services/MessageService';
import {
  ImageNotFoundError,
  ImageValidationError
} from '../../services/ImageService';
import { useSse } from '../../middleware/sse';
import logger from '../../logger';

export const chatRouter = express.Router();

/*
 * Creates a StreamWriter adapter from an Express Response.
 */
function createStreamWriter(res: express.Response): StreamWriter {
  return {
    write: (data: string) => {
      // Once the client has gone away the underlying socket is gone too;
      // writing would emit ERR_STREAM_DESTROYED. Generation continues and
      // we still want to drive it to completion so the answer is persisted.
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(data);
      } catch {
        // Swallow post-disconnect write errors — the response is gone.
      }
    },
    onClose: (handler: () => void) => res.on('close', handler)
  };
}

const threadService = new ThreadService(
  threadRepo,
  messageRepo,
  fileUploadService,
  imageAnalysisCacheRepo
);
const messageService = new MessageService(
  messageRepo,
  threadRepo,
  toolApprovalRuleRepo,
  fileUploadService
);

const CHAT_IMAGE_MAX_FILE_SIZE = 50 * 1024 * 1024;

interface UploadChatArtifactRequest {
  params: { threadId: string };
}

interface GetChatArtifactRequest {
  params: { threadId: string; filename: string };
}

chatRouter.post(
  '/threads/:threadId/artifacts',
  requireCsrfToken,
  requireAuth,
  express.raw({ type: '*/*', limit: CHAT_IMAGE_MAX_FILE_SIZE }),
  typedHandler<
    UploadChatArtifactRequest,
    { filename: string; url: string } | ErrorResponse
  >(async (req, res) => {
    try {
      const sessionUser = req.user as SessionUser;
      const { threadId } = req.params;
      await threadService.verifyThreadOwnership(threadId, sessionUser.id);
      const fileBuffer = req.body as Buffer;
      const result = await imageService.uploadImage(fileBuffer);
      res.json({
        filename: result.filename,
        url: `/api/chat/threads/${threadId}/artifacts/${result.filename}`
      });
    } catch (err) {
      if (err instanceof ThreadNotFoundError) {
        throw new HttpError(StatusCodes.NOT_FOUND, err.message);
      }
      if (err instanceof ImageValidationError) {
        throw new HttpError(StatusCodes.BAD_REQUEST, err.message);
      }
      throw err;
    }
  })
);

chatRouter.get(
  '/threads/:threadId/artifacts/:filename',
  requireAuth,
  typedHandler<GetChatArtifactRequest>(async (req, res) => {
    try {
      const sessionUser = req.user as SessionUser;
      const { threadId, filename } = req.params;
      if (path.basename(filename) !== filename || filename.includes('..')) {
        throw new HttpError(StatusCodes.BAD_REQUEST, 'Invalid filename');
      }
      await threadService.verifyThreadOwnership(threadId, sessionUser.id);

      const canRead = await artifactAccessService.canReadChatArtifact(
        threadId,
        filename,
        sessionUser.id
      );
      if (!canRead) {
        throw new HttpError(StatusCodes.NOT_FOUND, 'File not found');
      }

      const { data, contentType } = await imageService.getArtifact(filename);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.send(data);
    } catch (err) {
      if (err instanceof ThreadNotFoundError) {
        throw new HttpError(StatusCodes.NOT_FOUND, err.message);
      }
      if (err instanceof ImageNotFoundError) {
        throw new HttpError(StatusCodes.NOT_FOUND, err.message);
      }
      if (err instanceof ImageValidationError) {
        throw new HttpError(StatusCodes.BAD_REQUEST, err.message);
      }
      throw err;
    }
  })
);

/**
 * Replaces past image content with cached/extracted text descriptions.
 */
async function analyzeContextImages(
  contextMessages: MessageRequest[],
  threadId: string,
  modelConfig: ModelConfig,
  res: express.Response
): Promise<MessageRequest[]> {
  const provider = createImageAnalysisProvider(
    imageAnalysisCacheRepo,
    threadId,
    modelConfig.model
  );
  const processor = new ImageAnalysisProcessor(
    provider,
    () => createChatApiClient(modelConfig, []),
    (url) => messageService.resolveImageUrlToDataUri(url),
    (analyzing) => {
      if (analyzing) {
        res.write(`data: ${JSON.stringify({ analyzingImages: true })}\n\n`);
      }
    }
  );
  return processor.processContextMessages(contextMessages);
}

/**
 * Fetches and formats knowledge content for the given IDs.
 */
async function resolveKnowledgeContent(
  knowledgeIds: string[] | undefined,
  userId: string
): Promise<string | undefined> {
  if (!knowledgeIds || knowledgeIds.length === 0) return undefined;
  const entries = await knowledgeService.getContentsByIds(knowledgeIds, userId);
  if (entries.length === 0) return undefined;
  return entries.map((k) => `### ${k.name}\n${k.content}`).join('\n\n');
}

/*
 * Create a new thread without sending a message
 * POST /api/chat/threads/create
 */
interface CreateThreadResponse {
  threadId: string;
}

chatRouter.post(
  '/threads/create',
  requireCsrfToken,
  requireAuth,
  async (
    req: express.Request,
    res: express.Response<CreateThreadResponse | ErrorResponse>
  ) => {
    const sessionUser = req.user as SessionUser;

    const thread = await threadService.createThread(sessionUser.id);
    if (!thread) {
      throw new HttpError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Failed to create thread'
      );
    }

    res.json({ threadId: thread.id });
  }
);

/*
 * Send a message to an existing thread with SSE streaming
 * POST /api/chat/threads/:threadId/messages
 */
interface SendMessageRequest {
  params: { threadId: string };
  body: {
    message: string;
    parentMessageId?: string;
    modelId?: string;
    enabledTools?: string[];
    imageUrls?: string[];
    knowledgeIds?: string[];
    executeCodeEnabled?: boolean;
    webSearchEnabled?: boolean;
    webSearchExtendedTimeoutEnabled?: boolean;
  };
}

interface BuildLocalToolsResult {
  definitions: ToolDefinitionRequest[];
  handlers: Map<string, LocalToolHandler>;
  cleanup: () => Promise<void>;
}

interface BuildLocalToolsOptions {
  executeCodeEnabled?: boolean;
  webSearchEnabled?: boolean;
  webSearchExtendedTimeoutEnabled?: boolean;
  modelConfig: ModelConfig;
  /**
   * Called by the web-search sub-agent every time it kicks off / finishes a
   * tool whose target page we want to surface in the UI (search query or
   * navigated URL). Ignored when web search is disabled.
   */
  subAgentActivityWriter: SubAgentActivityWriter;
}

function buildLocalTools(
  options: BuildLocalToolsOptions
): BuildLocalToolsResult {
  const tools: Tool[] = [];
  const cleanups: Array<() => Promise<void>> = [];

  if (options.executeCodeEnabled) {
    tools.push(codeExecutionTool);
  }

  if (options.webSearchEnabled) {
    // Each request gets its own private Chromium so concurrent chats do not
    // share cookies / scroll position. Closed in `cleanup`.
    const subAgent = createBrowserSubAgent(options.modelConfig, {
      extendedTimeoutEnabled: options.webSearchExtendedTimeoutEnabled === true
    });
    createSubAgentActivityRelay(subAgent, options.subAgentActivityWriter);
    // Cap the delegate tool to ONE invocation per assistant turn — back-to-back
    // tenjo_browser_agent calls in the same response are wasteful (the
    // sub-agent already does its own internal multi-search loop) and confuse
    // the parent. The lock resets per request because `buildLocalTools` is
    // called fresh on every chat send.
    const delegateTool = createBrowserDelegateTool(subAgent);
    let delegateCallCount = 0;
    tools.push({
      definition: delegateTool.definition,
      handler: async (args) => {
        delegateCallCount++;
        if (delegateCallCount > 1) {
          return {
            error:
              'tenjo_browser_agent has already been called once this turn. Do NOT call it again. Use the answer from the previous call to reply to the user. If more research is needed, the user will follow up and you can call it again on the next turn.'
          };
        }
        return delegateTool.handler(args);
      }
    });
    cleanups.push(async () => {
      try {
        await subAgent.close();
      } catch (error) {
        logger.warn('Failed to close browser sub-agent cleanly', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  const bundle = bundleTools(tools);
  return {
    definitions: bundle.definitions,
    handlers: bundle.handlers,
    cleanup: async () => {
      await Promise.all(cleanups.map((fn) => fn()));
    }
  };
}

chatRouter.post(
  '/threads/:threadId/messages',
  requireCsrfToken,
  requireAuth,
  useSse,
  typedHandler<SendMessageRequest>(async (req, res) => {
    const { threadId } = req.params;
    const { body } = req;
    const sessionUser = req.user as SessionUser;

    let mcpClientManager: McpClientManager | undefined;
    let cleanupLocalTools: () => Promise<void> = async () => {};
    const abortController = new AbortController();
    generationAbortRegistry.register(threadId, abortController);

    try {
      const thread = await threadService.verifyThreadOwnership(
        threadId,
        sessionUser.id
      );

      await threadService.acquireGeneratingLock(thread.id);

      const modelConfig = await globalSettingService.resolveModelConfig(
        body.modelId
      );
      const mcpServers = await globalSettingService.getMcpServersConfig();

      const { mcpClientManager: mcpManager, tools: mcpTools } =
        await mcpToolService.initializeMcpConnection(
          mcpServers,
          body.enabledTools
        );
      mcpClientManager = mcpManager;

      const subAgentActivityWriter: SubAgentActivityWriter = {
        emit: (event) => {
          if (res.writableEnded || res.destroyed) return;
          res.write(`data: ${JSON.stringify({ subAgentActivity: event })}\n\n`);
        }
      };

      const localToolsResult = buildLocalTools({
        executeCodeEnabled: body.executeCodeEnabled,
        webSearchEnabled: body.webSearchEnabled,
        webSearchExtendedTimeoutEnabled:
          body.webSearchEnabled === true &&
          body.webSearchExtendedTimeoutEnabled === true,
        modelConfig,
        subAgentActivityWriter
      });
      cleanupLocalTools = localToolsResult.cleanup;
      const tools = [...mcpTools, ...localToolsResult.definitions];
      const localToolHandlers = localToolsResult.handlers;

      const knowledgeContent = await resolveKnowledgeContent(
        body.knowledgeIds,
        sessionUser.id
      );
      let contextMessages = body.parentMessageId
        ? await messageService.getContextMessages(
            sessionUser.id,
            body.parentMessageId
          )
        : undefined;

      if (contextMessages && contextMessages.length > 0) {
        contextMessages = await analyzeContextImages(
          contextMessages,
          thread.id,
          modelConfig,
          res
        );
      }

      const chatClient = createChatClient({
        config: modelConfig,
        tools,
        systemPrompt: systemPromptBuilder.build({
          knowledgeContent,
          executeCodeEnabled: body.executeCodeEnabled,
          webSearchEnabled: body.webSearchEnabled
        }),
        contextMessages
      });

      const shouldGenerateTitle = !body.parentMessageId;

      // Defer the title-generation request until the message stream has
      // started receiving output. Local model servers (e.g. LM Studio) load
      // a fresh model instance per concurrent connection, so firing both
      // requests at once would load the same model twice. Waiting for the
      // first chunk ensures the model is already resident when the title
      // request arrives, while still keeping title generation overlapped
      // with the remaining message stream.
      let triggerTitleStart: () => void = () => {};
      const titleStartGate = new Promise<void>((resolve) => {
        triggerTitleStart = resolve;
      });

      let titleSettled = false;
      const titlePromise: Promise<string | undefined> = shouldGenerateTitle
        ? titleStartGate
            .then(() => messageService.generateTitle(body.message, modelConfig))
            .catch((error) => {
              logger.warn('Title generation failed', {
                error: error instanceof Error ? error.message : String(error)
              });
              return undefined;
            })
            .finally(() => {
              titleSettled = true;
            })
        : Promise.resolve(undefined);

      const result = await messageService.processMessageStream({
        threadId: thread.id,
        message: body.message,
        imageUrls: body.imageUrls,
        parentMessageId: body.parentMessageId,
        userId: sessionUser.id,
        mcpClientManager,
        chatClient,
        writer: createStreamWriter(res),
        modelConfig,
        localToolHandlers,
        onFirstActivity: shouldGenerateTitle ? triggerTitleStart : undefined,
        abortSignal: abortController.signal
      });

      // Safety net: if the stream produced no chunks at all, still kick off
      // title generation so we don't leave a dangling promise.
      triggerTitleStart();

      // Emit `done` immediately so the client can release the input lock
      // and let the user start typing the next message — title generation
      // proceeds independently and is delivered as a separate event below.
      res.write(
        `data: ${JSON.stringify({ done: true, userMessageId: result.userMessageId, assistantMessageId: result.assistantMessageId, model: modelConfig.model, provider: modelConfig.type })}\n\n`
      );

      if (shouldGenerateTitle) {
        if (!titleSettled) {
          res.write(`data: ${JSON.stringify({ generatingTitle: true })}\n\n`);
        }
        const generatedTitle = await titlePromise;
        const updated = await threadRepo.update(thread.id, {
          title: generatedTitle || '-'
        });
        if (updated?.title) {
          res.write(`data: ${JSON.stringify({ title: updated.title })}\n\n`);
        }
      }

      res.end();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.debug('Chat stream aborted by client');
        res.end();
      } else {
        res.write(
          `data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`
        );
        res.end();
      }
    } finally {
      generationAbortRegistry.unregister(threadId, abortController);
      await threadService.releaseGeneratingLock(threadId);
      mcpClientManager?.close();
      await cleanupLocalTools();
    }
  })
);

/*
 * Edit and resend a message (creates a new branch from the parent of the edited message)
 * POST /api/chat/threads/:threadId/messages/:messageId/edit
 */
interface EditMessageRequest {
  params: { threadId: string; messageId: string };
  body: {
    message: string;
    modelId?: string;
    enabledTools?: string[];
    imageUrls?: string[];
    knowledgeIds?: string[];
    executeCodeEnabled?: boolean;
    webSearchEnabled?: boolean;
    webSearchExtendedTimeoutEnabled?: boolean;
  };
}

chatRouter.post(
  '/threads/:threadId/messages/:messageId/edit',
  requireCsrfToken,
  requireAuth,
  useSse,
  typedHandler<EditMessageRequest>(async (req, res) => {
    const { threadId, messageId } = req.params;
    const { body } = req;
    const sessionUser = req.user as SessionUser;

    let mcpClientManager:
      | Awaited<
          ReturnType<typeof mcpToolService.initializeMcpConnection>
        >['mcpClientManager']
      | undefined;
    let cleanupLocalTools: () => Promise<void> = async () => {};
    const abortController = new AbortController();
    generationAbortRegistry.register(threadId, abortController);

    try {
      await threadService.verifyThreadOwnership(threadId, sessionUser.id);
      await threadService.acquireGeneratingLock(threadId);

      const originalMessage = await messageService.verifyMessageOwnership(
        messageId,
        sessionUser.id
      );

      const modelConfig = await globalSettingService.resolveModelConfig(
        body.modelId
      );
      const mcpServers = await globalSettingService.getMcpServersConfig();

      const { mcpClientManager: mcpManager, tools: mcpTools } =
        await mcpToolService.initializeMcpConnection(
          mcpServers,
          body.enabledTools
        );
      mcpClientManager = mcpManager;

      const subAgentActivityWriter: SubAgentActivityWriter = {
        emit: (event) => {
          if (res.writableEnded || res.destroyed) return;
          res.write(`data: ${JSON.stringify({ subAgentActivity: event })}\n\n`);
        }
      };

      const localToolsResult = buildLocalTools({
        executeCodeEnabled: body.executeCodeEnabled,
        webSearchEnabled: body.webSearchEnabled,
        webSearchExtendedTimeoutEnabled:
          body.webSearchEnabled === true &&
          body.webSearchExtendedTimeoutEnabled === true,
        modelConfig,
        subAgentActivityWriter
      });
      cleanupLocalTools = localToolsResult.cleanup;
      const tools = [...mcpTools, ...localToolsResult.definitions];
      const localToolHandlers = localToolsResult.handlers;

      const knowledgeContent = await resolveKnowledgeContent(
        body.knowledgeIds,
        sessionUser.id
      );
      let contextMessages = originalMessage.parent_message_id
        ? await messageService.getContextMessages(
            sessionUser.id,
            originalMessage.parent_message_id
          )
        : undefined;

      if (contextMessages && contextMessages.length > 0) {
        contextMessages = await analyzeContextImages(
          contextMessages,
          threadId,
          modelConfig,
          res
        );
      }

      const chatClient = createChatClient({
        config: modelConfig,
        tools,
        systemPrompt: systemPromptBuilder.build({
          knowledgeContent,
          executeCodeEnabled: body.executeCodeEnabled,
          webSearchEnabled: body.webSearchEnabled
        }),
        contextMessages
      });

      const result = await messageService.processMessageStream({
        threadId,
        message: body.message,
        imageUrls: body.imageUrls,
        parentMessageId: originalMessage.parent_message_id,
        userId: sessionUser.id,
        mcpClientManager,
        chatClient,
        writer: createStreamWriter(res),
        modelConfig,
        localToolHandlers,
        abortSignal: abortController.signal
      });

      res.write(
        `data: ${JSON.stringify({ done: true, userMessageId: result.userMessageId, assistantMessageId: result.assistantMessageId, model: modelConfig.model, provider: modelConfig.type })}\n\n`
      );
      res.end();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.debug('Chat stream aborted by client');
        res.end();
      } else {
        res.write(
          `data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`
        );
        res.end();
      }
    } finally {
      generationAbortRegistry.unregister(threadId, abortController);
      await threadService.releaseGeneratingLock(threadId);
      mcpClientManager?.close();
      await cleanupLocalTools();
    }
  })
);

/*
 * POST /api/chat/threads/:threadId/stop
 * Broadcasts a stop request via Postgres NOTIFY so the instance running
 * the generation can abort it. Closing the SSE stream alone no longer
 * cancels — only this explicit call does.
 */
interface StopGenerationRequest {
  params: { threadId: string };
}

chatRouter.post(
  '/threads/:threadId/stop',
  requireCsrfToken,
  requireAuth,
  typedHandler<StopGenerationRequest, Record<string, never> | ErrorResponse>(
    async (req, res) => {
      const sessionUser = req.user as SessionUser;
      const { threadId } = req.params;

      try {
        await threadService.verifyThreadOwnership(threadId, sessionUser.id);
        await generationAbortRegistry.requestAbort(threadId);
        res.json({});
      } catch (err) {
        if (err instanceof ThreadNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        throw err;
      }
    }
  )
);

/*
 * GET /api/chat/threads
 * Retrieves paginated threads for the current user.
 */
interface ApiThread {
  id: string;
  title: string;
  created_at: Date | null;
  updated_at: Date | null;
  created_by: string | null;
  updated_by: string | null;
  current_leaf_message_id: string | null;
}

interface GetThreadsRequest {
  query: {
    pageSize?: string;
    pageNumber?: string;
    lastThreadId?: string;
    searchWord?: string;
  };
}

interface GetThreadsResponse {
  threads: ApiThread[];
  totalPages: number;
  currentPage: number;
  totalCount: number;
}

chatRouter.get(
  '/threads',
  requireCsrfToken,
  requireAuth,
  typedHandler<GetThreadsRequest, GetThreadsResponse | ErrorResponse>(
    async (req, res) => {
      const sessionUser = req.user as SessionUser;

      res.json(
        await threadService.findPaginated(
          sessionUser.id,
          parseInt(req.query.pageSize ?? '', 10) || 10,
          parseInt(req.query.pageNumber ?? '', 10) || 1,
          req.query.lastThreadId,
          req.query.searchWord
        )
      );
    }
  )
);

/*
 * GET /api/chat/threads/pinned
 * Retrieves the list of pinned threads.
 */
interface GetPinnedThreadsResponse {
  threads: Thread[];
}

chatRouter.get(
  '/threads/pinned',
  requireCsrfToken,
  requireAuth,
  async (
    req: express.Request,
    res: express.Response<GetPinnedThreadsResponse | ErrorResponse>
  ) => {
    const sessionUser = req.user as SessionUser;

    const pinnedThreads = await threadService.findPinned(sessionUser.id);

    res.json({ threads: pinnedThreads });
  }
);

/*
 * PATCH /api/chat/threads/:threadId/pin
 * Toggles the pin status of a thread.
 */
interface TogglePinRequest {
  params: { threadId: string };
  body: { pinned: boolean };
}

interface TogglePinResponse {
  thread: Thread;
}

chatRouter.patch(
  '/threads/:threadId/pin',
  requireCsrfToken,
  requireAuth,
  typedHandler<TogglePinRequest, TogglePinResponse | ErrorResponse>(
    async (req, res) => {
      try {
        const sessionUser = req.user as SessionUser;
        const { threadId } = req.params;
        const { pinned } = req.body;

        const updatedThread = await threadService.togglePin(
          threadId,
          sessionUser.id,
          pinned
        );
        res.json({ thread: updatedThread });
      } catch (err) {
        if (err instanceof ThreadNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        throw err;
      }
    }
  )
);

/*
 * Get messages for a specific thread
 * GET /api/chat/threads/:threadId/messages
 */
interface GetMessagesRequest {
  params: { threadId: string };
}

interface GetMessagesResponse {
  messages: ThreadMessage[];
  title: string;
  pinned: boolean;
  isGenerating: boolean;
}

chatRouter.get(
  '/threads/:threadId/messages',
  requireCsrfToken,
  requireAuth,
  typedHandler<GetMessagesRequest, GetMessagesResponse | ErrorResponse>(
    async (req, res) => {
      try {
        const sessionUser = req.user as SessionUser;
        const { threadId } = req.params;

        const thread = await threadService.verifyThreadOwnership(
          threadId,
          sessionUser.id
        );
        const messages = await messageService.getMessagesForThread(
          threadId,
          thread.current_leaf_message_id
        );

        const isGenerating = await threadService.isGeneratingLocked(threadId);
        logger.debug(
          `[GET messages] threadId=${threadId} isGenerating=${isGenerating}`
        );

        res.json({
          messages,
          title: thread.title,
          pinned: thread.pinned,
          isGenerating
        });
      } catch (err) {
        if (err instanceof ThreadNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        throw err;
      }
    }
  )
);

/*
 * POST /api/chat/threads/:threadId/messages/branch-status
 * Receives an array of message IDs and returns branch info for each message.
 */
interface GetBranchStatusRequest {
  params: { threadId: string };
  body: { messageIds: string[] };
}

interface GetBranchStatusResponse {
  branchStatuses: Record<string, BranchStatusInfo>;
}

chatRouter.post(
  '/threads/:threadId/messages/branch-status',
  requireCsrfToken,
  requireAuth,
  typedHandler<GetBranchStatusRequest, GetBranchStatusResponse | ErrorResponse>(
    async (req, res) => {
      try {
        const sessionUser = req.user as SessionUser;
        const { threadId } = req.params;
        const { messageIds } = req.body;

        if (!Array.isArray(messageIds)) {
          throw new HttpError(
            StatusCodes.BAD_REQUEST,
            'messageIds must be an array'
          );
        }

        await threadService.verifyThreadOwnership(threadId, sessionUser.id);
        const branchStatuses = await messageService.getBranchStatuses(
          sessionUser.id,
          messageIds
        );

        logger.debug('Final branchStatuses:', branchStatuses);
        res.json({ branchStatuses });
      } catch (err) {
        if (err instanceof ThreadNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        throw err;
      }
    }
  )
);

/*
 * POST /api/chat/threads/:threadId/messages/:messageId/switch-branch
 * Switches the active branch.
 */
interface SwitchBranchRequest {
  params: { threadId: string; messageId: string };
  body: { targetSiblingId: string };
}

interface SwitchBranchResponse {
  messages: ThreadMessage[];
  title: string;
  pinned: boolean;
}

chatRouter.post(
  '/threads/:threadId/messages/:messageId/switch-branch',
  requireCsrfToken,
  requireAuth,
  typedHandler<SwitchBranchRequest, SwitchBranchResponse | ErrorResponse>(
    async (req, res) => {
      try {
        const sessionUser = req.user as SessionUser;
        const { threadId, messageId } = req.params;
        const { targetSiblingId } = req.body;

        const thread = await threadService.verifyThreadOwnership(
          threadId,
          sessionUser.id
        );
        const { messages } = await messageService.switchBranch(
          threadId,
          sessionUser.id,
          messageId,
          targetSiblingId
        );

        res.json({
          messages,
          title: thread.title,
          pinned: thread.pinned,
          isGenerating: await threadService.isGeneratingLocked(threadId)
        });
      } catch (err) {
        if (err instanceof ThreadNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        if (err instanceof MessageNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        if (err instanceof MessageValidationError) {
          throw new HttpError(StatusCodes.BAD_REQUEST, err.message);
        }
        throw err;
      }
    }
  )
);

/*
 * GET /api/chat/threads/:threadId/messages/:messageId/user-prompt
 * Retrieves the user message prompt immediately preceding the specified assistant message.
 */
interface GetUserPromptRequest {
  params: { threadId: string; messageId: string };
}

interface GetUserPromptResponse {
  prompt: string;
}

chatRouter.get(
  '/threads/:threadId/messages/:messageId/user-prompt',
  requireCsrfToken,
  requireAuth,
  typedHandler<GetUserPromptRequest, GetUserPromptResponse | ErrorResponse>(
    async (req, res) => {
      try {
        const sessionUser = req.user as SessionUser;
        const { threadId, messageId } = req.params;

        await threadService.verifyThreadOwnership(threadId, sessionUser.id);
        const prompt = await messageService.getUserPrompt(
          sessionUser.id,
          messageId
        );

        res.json({ prompt });
      } catch (err) {
        if (err instanceof ThreadNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        if (err instanceof MessageNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        throw err;
      }
    }
  )
);

/*
 * PATCH /api/chat/threads/:threadId
 * Renames a thread's title.
 */
interface RenameThreadRequest {
  params: { threadId: string };
  body: { title: string };
}

interface RenameThreadResponse {
  thread: Thread;
}

chatRouter.patch(
  '/threads/:threadId',
  requireCsrfToken,
  requireAuth,
  typedHandler<RenameThreadRequest, RenameThreadResponse | ErrorResponse>(
    async (req, res) => {
      try {
        const sessionUser = req.user as SessionUser;
        const { threadId } = req.params;
        const { title } = req.body;

        const thread = await threadService.renameThread(
          threadId,
          sessionUser.id,
          title
        );
        res.json({ thread });
      } catch (err) {
        if (err instanceof ThreadNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        if (err instanceof ThreadValidationError) {
          throw new HttpError(StatusCodes.BAD_REQUEST, err.message);
        }
        throw err;
      }
    }
  )
);

/*
 * DELETE /api/chat/threads/:threadId
 * Deletes a thread and its associated messages.
 */
interface DeleteThreadRequest {
  params: { threadId: string };
}

interface DeleteThreadResponse {
  success: boolean;
}

chatRouter.delete(
  '/threads/:threadId',
  requireCsrfToken,
  requireAuth,
  typedHandler<DeleteThreadRequest, DeleteThreadResponse | ErrorResponse>(
    async (req, res) => {
      try {
        const sessionUser = req.user as SessionUser;
        const { threadId } = req.params;

        await threadService.deleteThread(threadId, sessionUser.id);
        res.json({ success: true });
      } catch (err) {
        if (err instanceof ThreadNotFoundError) {
          throw new HttpError(StatusCodes.NOT_FOUND, err.message);
        }
        if (err instanceof ThreadOperationError) {
          throw new HttpError(StatusCodes.INTERNAL_SERVER_ERROR, err.message);
        }
        throw err;
      }
    }
  )
);

/*
 * Approve or reject a pending tool execution
 * POST /api/chat/tools/:toolCallId/approve
 */
interface ApproveToolRequest {
  params: { toolCallId: string };
  body: { approved: boolean };
}

interface ApproveToolResponse {
  success: boolean;
}

chatRouter.post(
  '/tools/:toolCallId/approve',
  requireCsrfToken,
  requireAuth,
  typedHandler<ApproveToolRequest, ApproveToolResponse | ErrorResponse>(
    async (req, res) => {
      const { toolCallId } = req.params;
      const { approved } = req.body;

      if (typeof approved !== 'boolean') {
        throw new HttpError(
          StatusCodes.BAD_REQUEST,
          'approved must be a boolean'
        );
      }

      await toolApprovalEmitter.sendApproval(toolCallId, approved);
      res.json({ success: true });
    }
  )
);
