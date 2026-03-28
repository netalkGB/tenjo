import express from 'express';
import { StatusCodes } from 'http-status-codes';
import { requireCsrfToken } from '../../middleware/csrf';
import { requireAuth } from '../../middleware/auth';
import {
  threadRepo,
  messageRepo,
  toolApprovalRuleRepo
} from '../../repositories/registry';
import {
  globalSettingService,
  credentialStoreService
} from '../../services/registry';
import {
  type ErrorResponse,
  type SessionUser,
  typedHandler
} from '../../types/api';
import { HttpError } from '../../errors/HttpError';
import type { Thread } from '../../repositories/ThreadRepository';
import { McpToolService } from '../../services/McpToolService';
import type { McpClientManager } from 'tenjo-chat-engine';
import { createChatClient } from '../../factories/chatClientFactory';
import { toolApprovalEmitter } from '../../services/ToolApprovalEmitter';
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
import { useSse } from '../../middleware/sse';
import logger from '../../logger';

export const chatRouter = express.Router();

/*
 * Creates a StreamWriter adapter from an Express Response.
 */
function createStreamWriter(res: express.Response): StreamWriter {
  return {
    write: (data: string) => res.write(data),
    onClose: (handler: () => void) => res.on('close', handler)
  };
}

const mcpToolService = new McpToolService(credentialStoreService);
const threadService = new ThreadService(threadRepo, messageRepo);
const messageService = new MessageService(
  messageRepo,
  threadRepo,
  toolApprovalRuleRepo
);

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

    try {
      const thread = await threadService.verifyThreadOwnership(
        threadId,
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

      const tools = [...mcpTools];
      const chatClient = createChatClient(modelConfig, tools);

      if (body.parentMessageId) {
        const contextMessages = await messageService.getContextMessages(
          body.parentMessageId
        );
        chatClient.setMessages(contextMessages);
      }

      const shouldGenerateTitle = !body.parentMessageId;

      const result = await messageService.processMessageStream({
        threadId: thread.id,
        message: body.message,
        imageUrls: body.imageUrls,
        parentMessageId: body.parentMessageId,
        userId: sessionUser.id,
        mcpClientManager,
        chatClient,
        writer: createStreamWriter(res),
        modelConfig
      });

      // Generate title before sending done event (chat chunks are already sent)
      let title: string | undefined;
      if (shouldGenerateTitle) {
        res.write(`data: ${JSON.stringify({ generatingTitle: true })}\n\n`);
        const generatedTitle = await messageService.generateTitle(
          body.message,
          modelConfig
        );
        const updated = await threadRepo.update(thread.id, {
          title: generatedTitle || '-'
        });
        title = updated?.title;
      }

      res.write(
        `data: ${JSON.stringify({ done: true, title, userMessageId: result.userMessageId, assistantMessageId: result.assistantMessageId, model: modelConfig.model, provider: modelConfig.type })}\n\n`
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
      mcpClientManager?.close();
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

    try {
      await threadService.verifyThreadOwnership(threadId, sessionUser.id);
      const originalMessage =
        await messageService.verifyMessageExists(messageId);

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

      const tools = [...mcpTools];
      const chatClient = createChatClient(modelConfig, tools);

      if (originalMessage.parent_message_id) {
        const contextMessages = await messageService.getContextMessages(
          originalMessage.parent_message_id
        );
        chatClient.setMessages(contextMessages);
      }

      const result = await messageService.processMessageStream({
        threadId,
        message: body.message,
        parentMessageId: originalMessage.parent_message_id,
        userId: sessionUser.id,
        mcpClientManager,
        chatClient,
        writer: createStreamWriter(res),
        modelConfig
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
      mcpClientManager?.close();
    }
  })
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

        res.json({ messages, title: thread.title, pinned: thread.pinned });
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
        const branchStatuses =
          await messageService.getBranchStatuses(messageIds);

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
          messageId,
          targetSiblingId
        );

        res.json({ messages, title: thread.title, pinned: thread.pinned });
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
        const prompt = await messageService.getUserPrompt(messageId);

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
