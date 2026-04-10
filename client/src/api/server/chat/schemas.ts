import { z } from 'zod';

export const NewChatRequestSchema = z.object({
  message: z.string(),
  parentMessageId: z.string().optional(),
  modelId: z.string().optional(),
  enabledTools: z.array(z.string()).optional(),
  imageUrls: z.array(z.string()).optional(),
  knowledgeIds: z.array(z.string()).optional()
});

export const ToolCallEventSchema = z.object({
  type: z.enum(['calling', 'result', 'approval_request']),
  toolCallId: z.string(),
  toolName: z.string(),
  toolArgs: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  success: z.boolean().optional()
});

export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;

export const SSEChunkSchema = z.object({
  chunk: z.string().optional(),
  thinking: z.string().optional(),
  reasoning: z.string().optional(),
  done: z.boolean().optional(),
  generatingTitle: z.boolean().optional(),
  processing: z.boolean().optional(),
  analyzingImages: z.boolean().optional(),
  threadId: z.string().optional(),
  title: z.string().optional(),
  userMessageId: z.string().optional(),
  assistantMessageId: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  toolCall: ToolCallEventSchema.optional(),
  error: z.string().optional()
});

export type SSEChunk = z.infer<typeof SSEChunkSchema>;

export const ApiThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  pinned: z.boolean(),
  created_at: z
    .string()
    .nullable()
    .transform(val => (val ? new Date(val) : null)),
  updated_at: z
    .string()
    .nullable()
    .transform(val => (val ? new Date(val) : null)),
  created_by: z.string().nullable(),
  updated_by: z.string().nullable(),
  current_leaf_message_id: z.string().nullable()
});

export const GetThreadsResponseSchema = z.object({
  threads: z.array(ApiThreadSchema),
  totalPages: z.number(),
  currentPage: z.number(),
  totalCount: z.number()
});

export type ApiThread = z.infer<typeof ApiThreadSchema>;
export type GetThreadsResponse = z.infer<typeof GetThreadsResponseSchema>;

export const GetThreadsParamsSchema = z.object({
  pageSize: z.number().optional(),
  pageNumber: z.number().optional(),
  lastThreadId: z.string().optional(),
  searchWord: z.string().optional()
});

export type GetThreadsParams = z.infer<typeof GetThreadsParamsSchema>;

export const ToolCallResponseSchema = z.object({
  type: z.string(),
  id: z.string(),
  function: z.object({
    name: z.string(),
    arguments: z.string()
  })
});

export const ChatCompletionMessageContentSchema = z.union([
  z.object({
    type: z.literal('text'),
    text: z.string()
  }),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({
      url: z.string(),
      detail: z.enum(['auto', 'high', 'low']).optional()
    })
  })
]);

export const ThreadMessageSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  parent_message_id: z.string().nullable(),
  data: z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z
      .union([z.string(), z.array(ChatCompletionMessageContentSchema)])
      .nullable()
      .optional(),
    reasoning: z.string().optional(),
    tool_calls: z.array(ToolCallResponseSchema).optional(),
    tool_call_id: z.string().optional()
  }),
  source: z.string(),
  model: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  created_at: z
    .string()
    .nullable()
    .transform(val => (val ? new Date(val) : null)),
  updated_at: z
    .string()
    .nullable()
    .transform(val => (val ? new Date(val) : null)),
  created_by: z.string().nullable(),
  updated_by: z.string().nullable(),
  selected_child_id: z.string().nullable(),
  currentCount: z.number().nullable(),
  totalCount: z.number().nullable(),
  siblings: z.array(z.string()).nullable().optional()
});

export const ThreadMessagesResponseSchema = z.object({
  messages: z.array(ThreadMessageSchema),
  title: z.string(),
  pinned: z.boolean(),
  isGenerating: z.boolean()
});

export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;
export type ThreadMessagesResponse = z.infer<
  typeof ThreadMessagesResponseSchema
>;

export const BranchStatusResponseSchema = z.object({
  branchStatuses: z.record(
    z.string(),
    z.object({
      currentCount: z.number(),
      totalCount: z.number(),
      siblings: z.array(z.string())
    })
  )
});

export type BranchStatusResponse = z.infer<typeof BranchStatusResponseSchema>;

export interface SendMessageCallbacks {
  onChunk?: (chunk: string) => void;
  onThinking?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  onGeneratingTitle?: () => void;
  onProcessing?: () => void;
  onAnalyzingImages?: () => void;
  onComplete?: (
    title?: string,
    userMessageId?: string,
    assistantMessageId?: string,
    model?: string,
    provider?: string
  ) => void;
  onToolCall?: (toolCall: ToolCallEvent) => void;
  onError?: (error: string) => void;
  signal?: AbortSignal;
}

export const CreateThreadResponseSchema = z.object({
  threadId: z.string()
});

export type CreateThreadResponse = z.infer<typeof CreateThreadResponseSchema>;

export const UploadResponseSchema = z.object({
  filename: z.string(),
  url: z.string()
});

export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}
