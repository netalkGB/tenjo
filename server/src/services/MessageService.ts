import path from 'node:path';
import type {
  ChatClient,
  McpClientManager,
  MessageRequest,
  MessageContent,
  LocalToolHandler
} from 'tenjo-chat-engine';
import type {
  MessageRepository,
  Message
} from '../repositories/MessageRepository';
import type { ThreadRepository } from '../repositories/ThreadRepository';
import type { ToolApprovalRuleRepository } from '../repositories/ToolApprovalRuleRepository';
import type { ModelConfig } from '../repositories/GlobalSettingRepository';
import type { FileUploadService } from './FileUploadService';
import { toolApprovalEmitter } from '../events/ToolApprovalEmitter';
import { generateTitle } from './TitleGenerationService';
import { ServiceError } from '../errors/ServiceError';
import logger from '../logger';

function extractTextContent(
  content:
    | string
    | MessageContent[]
    | Array<{ type: string; text?: string }>
    | null
    | undefined
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  const textContent = (content as Array<{ type: string; text?: string }>).find(
    (c) => c.type === 'text'
  );
  return textContent?.text ?? '';
}

const EXTENSION_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png'
};

const LEGACY_ARTIFACT_URL_PATTERN =
  /\/api\/upload\/artifacts\/([^"'\\\s)<?#]+)([?#][^"'\\\s)<]*)?/g;

function normalizeLegacyArtifactUrls(data: unknown, threadId: string): unknown {
  // Backward compatibility for messages saved before scoped artifact URLs.
  if (typeof data === 'string') {
    return data.replace(
      LEGACY_ARTIFACT_URL_PATTERN,
      (_match, filename: string, suffix: string | undefined) =>
        `/api/chat/threads/${threadId}/artifacts/${filename}${suffix ?? ''}`
    );
  }

  if (Array.isArray(data)) {
    return data.map((item) => normalizeLegacyArtifactUrls(item, threadId));
  }

  if (data && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([key, value]) => [
        key,
        normalizeLegacyArtifactUrls(value, threadId)
      ])
    );
  }

  return data;
}

export class MessageNotFoundError extends ServiceError {
  constructor(message: string = 'Message not found') {
    super(message);
  }
}

export class MessageValidationError extends ServiceError {}

export interface StreamWriter {
  write(data: string): void;
  onClose(handler: () => void): void;
}

export interface ThreadMessage {
  id: string;
  thread_id: string;
  parent_message_id: string | null;
  data: MessageRequest;
  source: string;
  created_at: Date | null;
  updated_at: Date | null;
  created_by: string | null;
  updated_by: string | null;
  selected_child_id: string | null;
  model: string | null;
  provider: string | null;
  currentCount: number | null;
  totalCount: number | null;
}

export interface BranchStatusInfo {
  currentCount: number;
  totalCount: number;
  siblings: string[];
}

export type { LocalToolHandler };

export interface ProcessMessageStreamParams {
  threadId: string;
  message: string;
  imageUrls?: string[];
  parentMessageId: string | null | undefined;
  userId: string;
  mcpClientManager: McpClientManager;
  chatClient: ChatClient;
  writer: StreamWriter;
  modelConfig: ModelConfig;
  // Tool handlers that run locally inside this server process instead of
  // being dispatched to an MCP server. Looked up by tool name; takes
  // precedence over MCP tools with the same name.
  localToolHandlers?: Map<string, LocalToolHandler>;
  // Fires once when the LLM emits its first chunk/thinking/reasoning. Useful
  // to defer secondary requests (e.g. title generation) until the model is
  // loaded — local servers like LM Studio otherwise spin up duplicate
  // instances when two requests for the same model arrive concurrently.
  onFirstActivity?: () => void;
  // External signal used to cancel the in-flight LLM call. Driven by the
  // explicit /stop endpoint via GenerationAbortRegistry — *not* by SSE
  // socket close, so client navigation/reload no longer kills the answer.
  abortSignal: AbortSignal;
}

export interface ProcessMessageStreamResult {
  userMessageId?: string;
  assistantMessageId?: string;
}

export class MessageService {
  constructor(
    private messageRepo: MessageRepository,
    private threadRepo: ThreadRepository,
    private toolApprovalRuleRepo: ToolApprovalRuleRepository,
    private fileUploadService: FileUploadService
  ) {}

  async resolveImageUrlToDataUri(url: string): Promise<string> {
    logger.debug('Resolving image URL:', url);
    // Backward compatibility for image URLs saved by the removed upload API.
    const match = url.match(
      /^\/api\/(?:chat\/threads\/[^/]+\/artifacts|upload\/artifacts)\/([^/]+\.(jpg|png))$/
    );
    if (!match) {
      logger.debug('Not a local artifact URL, returning as-is');
      return url;
    }

    const filename = path.basename(match[1]);
    logger.debug('Reading file:', filename);
    try {
      const fileData = await this.fileUploadService.read(filename);
      const ext = path.extname(filename).toLowerCase();
      const mimeType = EXTENSION_TO_MIME[ext] ?? 'application/octet-stream';
      const base64 = fileData.toString('base64');
      const dataUri = `data:${mimeType};base64,${base64}`;
      logger.debug('Converted to data URI, length:', dataUri.length);
      return dataUri;
    } catch (error) {
      logger.error('Failed to read file:', error);
      return url;
    }
  }

  private async resolveImageUrlsToDataUri(urls: string[]): Promise<string[]> {
    return Promise.all(urls.map((url) => this.resolveImageUrlToDataUri(url)));
  }

  async verifyMessageExists(messageId: string): Promise<Message> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) {
      throw new MessageNotFoundError('Message not found');
    }
    return message;
  }

  async verifyMessageOwnership(
    messageId: string,
    userId: string
  ): Promise<Message> {
    const message = await this.messageRepo.findByIdAndUser(messageId, userId);
    if (!message) {
      throw new MessageNotFoundError('Message not found');
    }
    return message;
  }

  private async enrichWithBranchStatus(
    rawMessages: Message[]
  ): Promise<ThreadMessage[]> {
    return Promise.all(
      rawMessages.map(async (msg) => {
        const branchStatus = await this.messageRepo.getBranchStatus(
          msg.parent_message_id,
          msg.id
        );
        return {
          ...msg,
          data: normalizeLegacyArtifactUrls(
            msg.data,
            msg.thread_id
          ) as MessageRequest,
          currentCount: branchStatus?.current ?? null,
          totalCount: branchStatus?.total ?? null,
          siblings: branchStatus?.siblings ?? null
        };
      })
    );
  }

  async getMessagesForThread(
    threadId: string,
    leafMessageId: string | null
  ): Promise<ThreadMessage[]> {
    if (!leafMessageId) {
      return [];
    }
    const rawMessages = await this.messageRepo.findPath(leafMessageId);
    return this.enrichWithBranchStatus(rawMessages);
  }

  async getBranchStatuses(
    userId: string,
    messageIds: string[]
  ): Promise<Record<string, BranchStatusInfo>> {
    const branchStatuses: Record<string, BranchStatusInfo> = {};

    await Promise.all(
      messageIds.map(async (messageId) => {
        const message = await this.messageRepo.findByIdAndUser(
          messageId,
          userId
        );
        if (message) {
          const branchStatus = await this.messageRepo.getBranchStatus(
            message.parent_message_id,
            message.id
          );
          if (branchStatus) {
            branchStatuses[messageId] = {
              currentCount: branchStatus.current,
              totalCount: branchStatus.total,
              siblings: branchStatus.siblings
            };
          }
        }
      })
    );

    return branchStatuses;
  }

  async switchBranch(
    threadId: string,
    userId: string,
    messageId: string,
    targetSiblingId: string
  ): Promise<{ messages: ThreadMessage[]; leafMessageId: string | undefined }> {
    const message = await this.verifyMessageOwnership(messageId, userId);
    await this.verifyMessageOwnership(targetSiblingId, userId);

    const parentId = message.parent_message_id;
    if (parentId) {
      await this.messageRepo.switchBranch(parentId, targetSiblingId);
    }

    const rawMessages = await this.messageRepo.findPath(targetSiblingId);

    const leafMessageId = rawMessages[rawMessages.length - 1]?.id;
    if (leafMessageId) {
      await this.threadRepo.update(threadId, {
        current_leaf_message_id: leafMessageId
      });
    }

    const messages = await this.enrichWithBranchStatus(rawMessages);
    return { messages, leafMessageId };
  }

  /**
   * Returns the message path for the given message ID,
   * converted to context messages suitable for setting on a ChatClient.
   */
  async getContextMessages(
    userId: string,
    messageId: string
  ): Promise<MessageRequest[]> {
    await this.verifyMessageOwnership(messageId, userId);
    const messagePath = await this.messageRepo.findPath(messageId);
    return messagePath
      .filter((msg) => msg.data)
      .map(
        (msg) =>
          normalizeLegacyArtifactUrls(msg.data, msg.thread_id) as MessageRequest
      )
      .filter((msg) => msg.role !== 'system');
  }

  async getUserPrompt(userId: string, messageId: string): Promise<string> {
    const assistantMessage = await this.verifyMessageOwnership(
      messageId,
      userId
    );

    if (!assistantMessage.parent_message_id) {
      throw new MessageValidationError(
        'Assistant message has no parent user message'
      );
    }

    const userMessage = await this.messageRepo.findById(
      assistantMessage.parent_message_id
    );
    if (!userMessage) {
      throw new MessageNotFoundError('Parent user message not found');
    }

    const content = (userMessage.data as MessageRequest).content;
    return content ? extractTextContent(content) : '';
  }

  /**
   * Generate a thread title using the user's configured model.
   * Falls back to a message prefix if no model is configured or the LLM call fails.
   */
  async generateTitle(
    message: string,
    modelConfig: ModelConfig | null
  ): Promise<string | undefined> {
    // Shared with the coding-agent (see services/TitleGenerationService.ts) so both
    // title the same way.
    return generateTitle(message, modelConfig);
  }

  async processMessageStream(
    params: ProcessMessageStreamParams
  ): Promise<ProcessMessageStreamResult> {
    const {
      threadId,
      message,
      imageUrls,
      parentMessageId,
      userId,
      mcpClientManager,
      chatClient,
      writer,
      modelConfig,
      localToolHandlers,
      onFirstActivity,
      abortSignal
    } = params;

    let firstActivityFired = false;
    const fireFirstActivity = () => {
      if (firstActivityFired) return;
      firstActivityFired = true;
      onFirstActivity?.();
    };

    let userMessageId: string | undefined;
    let assistantMessageId: string | undefined;
    let lastSavedMessageId: string | undefined = parentMessageId ?? undefined;
    const messageAddedPromises: Promise<void>[] = [];
    const pendingToolCallIds = new Set<string>();
    // Serializes DB writes triggered by onMessageAdded. Without this, fast
    // local tools (e.g. tenjo_execute_code) can fire onMessageAdded for the
    // tool result before the preceding assistant-with-tool_calls insert has
    // resolved, leaving the tool message's parent_message_id pointing at the
    // wrong row and the message excluded from findPath on reload.
    let saveQueue: Promise<void> = Promise.resolve();

    // Cancel pending tool approvals on SSE disconnect so we don't sit
    // waiting forever for a user that's no longer there. The LLM call
    // itself keeps running — generation is driven by abortSignal, which
    // is only flipped when /stop is called explicitly.
    writer.onClose(() => {
      for (const id of pendingToolCallIds) {
        toolApprovalEmitter.cancelApproval(id);
      }
      pendingToolCallIds.clear();
    });

    // Mapping from data URIs (sent to LLM) to original URLs (for DB storage)
    const dataUriToOriginalUrl = new Map<string, string>();

    if (parentMessageId) {
      await this.verifyMessageOwnership(parentMessageId, userId);
    }

    // Save to DB when a message is added
    chatClient.onMessageAdded(async (msg: MessageRequest) => {
      logger.debug(`onMessageAdded called, role: ${msg.role}`);

      // Restore data URIs back to original relative URLs before DB save
      let messageToSave = msg;
      if (
        msg.role === 'user' &&
        Array.isArray(msg.content) &&
        dataUriToOriginalUrl.size > 0
      ) {
        const restoredContent = (msg.content as MessageContent[]).map((c) => {
          if (c.type === 'image_url') {
            const original = dataUriToOriginalUrl.get(c.image_url.url);
            if (original) {
              return { ...c, image_url: { ...c.image_url, url: original } };
            }
          }
          return c;
        });
        messageToSave = { ...msg, content: restoredContent };
      }

      const promise = saveQueue.then(async () => {
        const savedMessage = await this.messageRepo.addMessage({
          thread_id: threadId,
          parent_message_id: lastSavedMessageId ?? null,
          data: messageToSave,
          source: msg.role === 'user' ? 'user' : 'assistant',
          model: msg.role === 'assistant' ? modelConfig.model : null,
          provider: msg.role === 'assistant' ? modelConfig.type : null,
          created_by: userId,
          updated_by: userId
        });

        lastSavedMessageId = savedMessage.id;

        if (msg.role === 'user') {
          userMessageId = savedMessage.id;
          logger.debug(`User message saved, userMessageId: ${userMessageId}`);
        }

        if (msg.role === 'assistant') {
          assistantMessageId = savedMessage.id;
          logger.debug(
            `Assistant message saved, assistantMessageId: ${assistantMessageId}`
          );
        }

        await this.threadRepo.update(threadId, {
          current_leaf_message_id: savedMessage.id
        });
      });
      // Chain the next save behind this one. Swallow rejection on the queue
      // copy so a single failure can't permanently break the chain — the
      // original promise (with the rejection intact) is still tracked via
      // messageAddedPromises so errors bubble up through normal flow.
      saveQueue = promise.catch(() => {});
      messageAddedPromises.push(promise);
    });

    // Return messages via streaming
    chatClient.setMessageHandler((chunk: string) => {
      fireFirstActivity();
      writer.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    });

    chatClient.setThinkingHandler((chunk: string) => {
      fireFirstActivity();
      writer.write(`data: ${JSON.stringify({ thinking: chunk })}\n\n`);
    });

    chatClient.setReasoningHandler((chunk: string) => {
      fireFirstActivity();
      writer.write(`data: ${JSON.stringify({ reasoning: chunk })}\n\n`);
    });

    chatClient.setToolCallStreamHandler((event) => {
      fireFirstActivity();
      writer.write(`data: ${JSON.stringify({ toolCallStream: event })}\n\n`);
    });

    // Send message and handle tool calls (may be aborted via signal)
    try {
      const sendOptions = { signal: abortSignal };
      if (imageUrls && imageUrls.length > 0) {
        const resolvedImageUrls =
          await this.resolveImageUrlsToDataUri(imageUrls);
        for (let i = 0; i < imageUrls.length; i++) {
          dataUriToOriginalUrl.set(resolvedImageUrls[i], imageUrls[i]);
        }
        await chatClient.sendMessage(message, resolvedImageUrls, sendOptions);
      } else {
        await chatClient.sendMessage(message, undefined, sendOptions);
      }

      // If there are tool calls, execute them and continue
      const MAX_TOOL_ITERATIONS = 100;
      let iteration = 0;
      let toolCalls = chatClient.getToolCallPlan();
      while (
        toolCalls &&
        toolCalls.length > 0 &&
        iteration < MAX_TOOL_ITERATIONS
      ) {
        iteration++;

        const currentBatch = toolCalls;
        for (const toolCall of currentBatch) {
          try {
            const toolArgs = JSON.parse(toolCall.function.arguments) as Record<
              string,
              unknown
            >;

            // Local in-process tools (e.g. execute_code) bypass the approval
            // workflow entirely — they are gated by the toggle on the chat
            // input itself rather than per-call approval.
            const isLocalTool =
              localToolHandlers?.has(toolCall.function.name) ?? false;
            const autoApprove =
              isLocalTool ||
              (await this.toolApprovalRuleRepo.shouldAutoApprove(
                userId,
                toolCall.function.name
              ));

            let approved: boolean;

            if (autoApprove) {
              approved = true;
              writer.write(
                `data: ${JSON.stringify({
                  toolCall: {
                    type: 'calling',
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    toolArgs
                  }
                })}\n\n`
              );
            } else {
              writer.write(
                `data: ${JSON.stringify({
                  toolCall: {
                    type: 'approval_request',
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    toolArgs
                  }
                })}\n\n`
              );

              pendingToolCallIds.add(toolCall.id);
              approved = await toolApprovalEmitter.waitForApproval(toolCall.id);
              pendingToolCallIds.delete(toolCall.id);
            }

            if (!approved) {
              // Add rejected result for the current tool
              chatClient.addToolCallResult(toolCall.id, {
                error: 'Tool execution rejected by user'
              });
              writer.write(
                `data: ${JSON.stringify({
                  toolCall: {
                    type: 'result',
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    result: { error: 'Rejected by user' },
                    success: false
                  }
                })}\n\n`
              );

              // Add cancelled result for all remaining tools in this batch
              const currentIndex = currentBatch.indexOf(toolCall);
              for (let i = currentIndex + 1; i < currentBatch.length; i++) {
                const remaining = currentBatch[i];
                chatClient.addToolCallResult(remaining.id, {
                  error:
                    'Tool execution cancelled because a prior tool was rejected'
                });
                writer.write(
                  `data: ${JSON.stringify({
                    toolCall: {
                      type: 'result',
                      toolCallId: remaining.id,
                      toolName: remaining.function.name,
                      result: {
                        error:
                          'Tool execution cancelled because a prior tool was rejected'
                      },
                      success: false
                    }
                  })}\n\n`
                );
              }

              // Stop the entire tool execution loop
              toolCalls = null;
              break;
            }

            writer.write(
              `data: ${JSON.stringify({
                toolCall: {
                  type: 'calling',
                  toolCallId: toolCall.id,
                  toolName: toolCall.function.name,
                  toolArgs
                }
              })}\n\n`
            );

            const localHandler = localToolHandlers?.get(toolCall.function.name);
            const toolResult = localHandler
              ? await localHandler(toolArgs)
              : await mcpClientManager.callTool(
                  toolCall.function.name,
                  toolArgs
                );
            chatClient.addToolCallResult(toolCall.id, toolResult);

            writer.write(
              `data: ${JSON.stringify({
                toolCall: {
                  type: 'result',
                  toolCallId: toolCall.id,
                  toolName: toolCall.function.name,
                  result: toolResult,
                  success: true
                }
              })}\n\n`
            );
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            chatClient.addToolCallResult(toolCall.id, {
              error: errorMessage
            });

            writer.write(
              `data: ${JSON.stringify({
                toolCall: {
                  type: 'result',
                  toolCallId: toolCall.id,
                  toolName: toolCall.function.name,
                  result: { error: errorMessage },
                  success: false
                }
              })}\n\n`
            );
          }
        }

        // If toolCalls was set to null due to rejection, stop the loop
        if (!toolCalls) break;

        writer.write(`data: ${JSON.stringify({ processing: true })}\n\n`);
        await chatClient.validateToolCallResult(abortSignal);
        toolCalls = chatClient.getToolCallPlan();
      }
    } catch (error) {
      // On abort, wait for pending DB saves and return partial result
      if (error instanceof Error && error.name === 'AbortError') {
        logger.debug('Chat stream aborted, waiting for pending DB saves');
        if (messageAddedPromises.length > 0) {
          await Promise.all(messageAddedPromises);
        }
        return { userMessageId, assistantMessageId };
      }
      throw error;
    }

    // Wait until all onMessageAdded handlers have completed
    await Promise.all(messageAddedPromises);

    return { userMessageId, assistantMessageId };
  }
}
