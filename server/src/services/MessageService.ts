import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ChatClient,
  McpClientManager,
  MessageRequest,
  MessageContent
} from 'tenjo-chat-engine';
import type {
  MessageRepository,
  Message
} from '../repositories/MessageRepository';
import type { ThreadRepository } from '../repositories/ThreadRepository';
import type { ToolApprovalRuleRepository } from '../repositories/ToolApprovalRuleRepository';
import type { ModelConfig } from '../repositories/GlobalSettingRepository';
import { toolApprovalEmitter } from './ToolApprovalEmitter';
import { createChatClient } from '../factories/chatClientFactory';
import { ServiceError } from '../errors/ServiceError';
import { getDataDir } from '../utils/env';
import logger from '../logger';

function getArtifactsDir(): string {
  return path.join(getDataDir(), 'artifacts');
}

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

function stripImagesFromMessage(message: MessageRequest): MessageRequest {
  if (Array.isArray(message.content)) {
    const textContent = message.content
      .filter((c) => c.type === 'text')
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('');
    return { ...message, content: textContent || '' } as MessageRequest;
  }
  return message;
}

const EXTENSION_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png'
};

async function resolveImageUrlsToDataUri(urls: string[]): Promise<string[]> {
  return Promise.all(
    urls.map(async (url) => {
      logger.debug('Resolving image URL:', url);
      const match = url.match(/^\/api\/upload\/artifacts\/([^/]+\.(jpg|png))$/);
      if (!match) {
        logger.debug('Not a local artifact URL, returning as-is');
        return url;
      }

      const filename = path.basename(match[1]);
      const filePath = path.join(getArtifactsDir(), filename);
      logger.debug('Reading file from:', filePath);
      try {
        const fileData = await fs.readFile(filePath);
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
    })
  );
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
}

export interface ProcessMessageStreamResult {
  userMessageId?: string;
  assistantMessageId?: string;
}

export class MessageService {
  constructor(
    private messageRepo: MessageRepository,
    private threadRepo: ThreadRepository,
    private toolApprovalRuleRepo: ToolApprovalRuleRepository
  ) {}

  async verifyMessageExists(messageId: string): Promise<Message> {
    const message = await this.messageRepo.findById(messageId);
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
          data: msg.data as MessageRequest,
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
    messageIds: string[]
  ): Promise<Record<string, BranchStatusInfo>> {
    const branchStatuses: Record<string, BranchStatusInfo> = {};

    await Promise.all(
      messageIds.map(async (messageId) => {
        const message = await this.messageRepo.findById(messageId);
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
    messageId: string,
    targetSiblingId: string
  ): Promise<{ messages: ThreadMessage[]; leafMessageId: string | undefined }> {
    const message = await this.verifyMessageExists(messageId);

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
  async getContextMessages(messageId: string): Promise<MessageRequest[]> {
    const messagePath = await this.messageRepo.findPath(messageId);
    return messagePath
      .filter((msg) => msg.data)
      .map((msg) => stripImagesFromMessage(msg.data as MessageRequest));
  }

  async getUserPrompt(messageId: string): Promise<string> {
    const assistantMessage = await this.verifyMessageExists(messageId);

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
    if (!modelConfig) {
      return this.createFallbackTitle(message);
    }

    try {
      const chatClient = createChatClient(modelConfig);
      chatClient.setSystemPrompt({
        role: 'system',
        content: [
          {
            type: 'text',
            text: 'Do not use <think> tags. Respond directly. Summarize.'
          }
        ]
      });

      // Abort after enough characters or timeout to avoid long waits
      const MAX_TITLE_CHARS = 50;
      const TIMEOUT_MS = 30000;
      const abortController = new AbortController();
      let collected = '';

      const timeout = setTimeout(() => {
        abortController.abort();
      }, TIMEOUT_MS);

      // Ignore thinking chunks — only collect actual response text
      chatClient.setThinkingHandler(() => {});
      chatClient.setMessageHandler((chunk: string) => {
        collected += chunk;
        if (collected.length >= MAX_TITLE_CHARS) {
          abortController.abort();
        }
      });

      try {
        await chatClient.sendMessage(
          `Summarize the following in ~15 characters, preserving the original language: ${message}`,
          undefined,
          { signal: abortController.signal }
        );
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          throw error;
        }
      } finally {
        clearTimeout(timeout);
      }

      const title = collected.trim();
      if (!title) return this.createFallbackTitle(message);
      return title.slice(0, 150) || undefined;
    } catch (error) {
      logger.warn('Failed to generate title via LLM, using fallback', {
        error: error instanceof Error ? error.message : String(error)
      });
      return this.createFallbackTitle(message);
    }
  }

  private createFallbackTitle(message: string): string {
    const trimmed = message.trim();
    if (trimmed.length <= 30) {
      return trimmed;
    }
    return `${trimmed.slice(0, 30)}...`;
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
      modelConfig
    } = params;

    let userMessageId: string | undefined;
    let assistantMessageId: string | undefined;
    let lastSavedMessageId: string | undefined = parentMessageId ?? undefined;
    const contextAddedPromises: Promise<void>[] = [];
    const pendingToolCallIds = new Set<string>();

    // AbortController to cancel LLM requests on SSE disconnect
    const abortController = new AbortController();

    // Clean up pending approval listeners and abort LLM on SSE disconnect
    writer.onClose(() => {
      abortController.abort();
      for (const id of pendingToolCallIds) {
        toolApprovalEmitter.cancelApproval(id);
      }
      pendingToolCallIds.clear();
    });

    // Mapping from data URIs (sent to LLM) to original URLs (for DB storage)
    const dataUriToOriginalUrl = new Map<string, string>();

    // Save to DB when context is added
    chatClient.onContextAdded(async (msg: MessageRequest) => {
      logger.debug('onContextAdded called, role:', msg.role);

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

      const promise = (async () => {
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
          logger.debug('User message saved, userMessageId:', userMessageId);
        }

        if (msg.role === 'assistant') {
          assistantMessageId = savedMessage.id;
          logger.debug(
            'Assistant message saved, assistantMessageId:',
            assistantMessageId
          );
        }

        await this.threadRepo.update(threadId, {
          current_leaf_message_id: savedMessage.id
        });
      })();
      contextAddedPromises.push(promise);
    });

    // Return messages via streaming
    chatClient.setMessageHandler((chunk: string) => {
      writer.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    });

    chatClient.setThinkingHandler((chunk: string) => {
      writer.write(`data: ${JSON.stringify({ thinking: chunk })}\n\n`);
    });

    chatClient.setReasoningHandler((chunk: string) => {
      writer.write(`data: ${JSON.stringify({ reasoning: chunk })}\n\n`);
    });

    // Send message and handle tool calls (may be aborted via signal)
    try {
      const sendOptions = { signal: abortController.signal };
      if (imageUrls && imageUrls.length > 0) {
        const resolvedImageUrls = await resolveImageUrlsToDataUri(imageUrls);
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

        for (const toolCall of toolCalls) {
          try {
            const toolArgs = JSON.parse(toolCall.function.arguments) as Record<
              string,
              unknown
            >;

            const autoApprove =
              await this.toolApprovalRuleRepo.shouldAutoApprove(
                userId,
                toolCall.function.name
              );

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
              continue;
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

            const toolResult = await mcpClientManager.callTool(
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

        await chatClient.validateToolCallResult(abortController.signal);
        toolCalls = chatClient.getToolCallPlan();
      }
    } catch (error) {
      // On abort, wait for pending DB saves and return partial result
      if (error instanceof Error && error.name === 'AbortError') {
        logger.debug('Chat stream aborted, waiting for pending DB saves');
        if (contextAddedPromises.length > 0) {
          await Promise.all(contextAddedPromises);
        }
        return { userMessageId, assistantMessageId };
      }
      throw error;
    }

    // Wait until all onContextAdded handlers have completed
    await Promise.all(contextAddedPromises);

    return { userMessageId, assistantMessageId };
  }
}
