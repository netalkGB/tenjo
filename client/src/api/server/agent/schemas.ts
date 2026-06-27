import { z } from 'zod';
import type {
  AgentFileNode,
  AgentFileKind,
  AgentMode
} from '@/components/agent/types';

/**
 * Zod schemas for the Agent REST + WebSocket protocol. Mirrors the
 * server's agentProtocol.ts (the server is the source of truth; these validate
 * every inbound frame on the client).
 */

export const AGENT_FILE_KINDS = [
  'code',
  'pdf',
  'docx',
  'pptx',
  'xlsx',
  'json',
  'markdown',
  'image',
  'audio',
  'video',
  'archive',
  'config',
  'text'
] as const;

const AgentFileKindSchema = z.enum(
  AGENT_FILE_KINDS
) satisfies z.ZodType<AgentFileKind>;

export const AgentFileNodeSchema: z.ZodType<AgentFileNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['file', 'folder']),
    kind: AgentFileKindSchema.optional(),
    sizeLabel: z.string().optional(),
    updatedAtLabel: z.string(),
    children: z.array(AgentFileNodeSchema).optional()
  })
);

export const AgentFileChangeSchema = z.object({
  path: z.string(),
  kind: z.enum(['created', 'updated', 'deleted'])
});

const ToolCallSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  function: z.object({ name: z.string(), arguments: z.string() })
});

/** The persisted chat-engine MessageRequest. `content` is string | parts. */
export const MessageDataSchema = z.object({
  role: z.string(),
  content: z.unknown(),
  reasoning: z.string().optional(),
  tool_calls: z.array(ToolCallSchema).optional(),
  tool_call_id: z.string().optional()
});
export type MessageData = z.infer<typeof MessageDataSchema>;

export const AgentMessagePlanSchema = z.object({
  summary: z.string().nullable(),
  todos: z.array(
    z.object({
      text: z.string(),
      status: z.enum(['pending', 'in_progress', 'completed'])
    })
  ),
  status: z.enum(['proposed', 'running', 'done'])
});
export type AgentMessagePlan = z.infer<typeof AgentMessagePlanSchema>;

export const AgentMessageViewSchema = z.object({
  id: z.string(),
  role: z.string(),
  source: z.string(),
  data: MessageDataSchema,
  plan: AgentMessagePlanSchema.nullable(),
  createdAt: z.string().nullable()
});
export type AgentMessageView = z.infer<typeof AgentMessageViewSchema>;

export const AgentQueuedViewSchema = z.object({
  id: z.string(),
  text: z.string(),
  fileCount: z.number(),
  status: z.string()
});
export type AgentQueuedView = z.infer<typeof AgentQueuedViewSchema>;

export const AgentProjectModelSchema = z.object({
  id: z.string(),
  provider: z.string(),
  model: z.string(),
  baseUrl: z.string()
});
export type AgentProjectModel = z.infer<typeof AgentProjectModelSchema>;

const PlanTodoSchema = z.object({
  text: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed'])
});

/** Live progress of a sub-agent (browser-research delegate). Mirrors chat. */
export const SubAgentActivityEventSchema = z.object({
  agentId: z.string(),
  agentType: z.string(),
  activityId: z.string(),
  toolName: z.string(),
  detail: z.string().optional(),
  url: z.string().optional(),
  status: z.enum(['started', 'completed', 'failed']),
  timestamp: z.number()
});
export type SubAgentActivityEvent = z.infer<typeof SubAgentActivityEventSchema>;

/** Server → client events (discriminated union on `type`). */
export const AgentServerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message-added'),
    message: AgentMessageViewSchema
  }),
  z.object({ type: z.literal('chunk'), text: z.string() }),
  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({ type: z.literal('reasoning'), text: z.string() }),
  z.object({ type: z.literal('status'), status: z.string() }),
  z.object({
    type: z.literal('tool-stream'),
    toolCallId: z.string(),
    toolName: z.string(),
    argumentsDelta: z.string()
  }),
  z.object({
    type: z.literal('queue-changed'),
    queue: z.array(AgentQueuedViewSchema)
  }),
  z.object({
    type: z.literal('turn-start'),
    items: z.array(AgentQueuedViewSchema)
  }),
  z.object({ type: z.literal('turn-complete') }),
  z.object({ type: z.literal('idle') }),
  z.object({ type: z.literal('project-status'), status: z.string() }),
  z.object({
    type: z.literal('sandbox-status'),
    status: z.enum(['unavailable', 'preparing', 'ready']),
    detail: z.string().optional()
  }),
  z.object({
    type: z.literal('gui-status'),
    status: z.enum(['stopped', 'starting', 'running', 'stopping', 'error']),
    detail: z.string().optional()
  }),
  z.object({ type: z.literal('mode'), mode: z.enum(['plan', 'steer']) }),
  z.object({
    type: z.literal('project-model'),
    agentModel: AgentProjectModelSchema
  }),
  z.object({ type: z.literal('title'), title: z.string() }),
  z.object({
    type: z.literal('plan-presented'),
    steps: z.array(z.string()),
    summary: z.string().nullable()
  }),
  z.object({
    type: z.literal('plan-progress'),
    todos: z.array(PlanTodoSchema)
  }),
  z.object({ type: z.literal('plan-resolved'), approved: z.boolean() }),
  z.object({
    type: z.literal('tool-approval'),
    toolCallId: z.string(),
    toolName: z.string(),
    toolArgs: z.string()
  }),
  z.object({
    type: z.literal('tool-approval-resolved'),
    toolCallId: z.string(),
    approved: z.boolean()
  }),
  z.object({
    type: z.literal('question'),
    questionId: z.string(),
    question: z.string(),
    header: z.string().optional(),
    options: z.array(
      z.object({
        label: z.string(),
        description: z.string().optional()
      })
    ),
    multiSelect: z.boolean()
  }),
  z.object({
    type: z.literal('question-resolved'),
    questionId: z.string()
  }),
  z.object({
    type: z.literal('sub-agent-activity'),
    activity: SubAgentActivityEventSchema
  }),
  z.object({
    type: z.literal('file-tree'),
    nodes: z.array(AgentFileNodeSchema),
    contextNodes: z.array(AgentFileNodeSchema)
  }),
  z.object({
    type: z.literal('file-changed'),
    changes: z.array(AgentFileChangeSchema)
  }),
  z.object({
    type: z.literal('preview-available'),
    available: z.boolean(),
    kind: z.enum(['web', 'gui']).nullable()
  }),
  // The agent (via `restart_preview`) asked to (re)open the preview with the
  // current build. Sole auto-launch trigger; the client opens once the run idles.
  z.object({ type: z.literal('preview-open') }),
  z.object({
    type: z.literal('preview-launch-error'),
    message: z.string()
  }),
  z.object({ type: z.literal('error'), message: z.string() })
]);

export type AgentServerEvent = z.infer<typeof AgentServerEventSchema>;

/** Response of `GET /api/agent/sandbox-status` (initial fetch; SSE pushes updates). */
export const SandboxStatusResponseSchema = z.object({
  type: z.literal('sandbox-status'),
  status: z.enum(['unavailable', 'preparing', 'ready']),
  detail: z.string().optional()
});

/** Client → server commands. */
export type AgentClientCommand =
  | { type: 'subscribe'; projectId: string }
  | {
      type: 'submit';
      text: string;
      contextFiles?: ContextFileRef[];
      mode: AgentMode;
    }
  | { type: 'plan-approve' }
  | { type: 'plan-reject'; feedback?: string }
  | { type: 'queue-remove'; id: string }
  | { type: 'abort'; clearQueue?: boolean }
  | { type: 'request-file-tree' };

/** Response of `GET /api/agent/projects/:id/gui` (initial fetch; SSE pushes updates). */
export const AgentGuiStatusResponseSchema = z.object({
  status: z.enum(['stopped', 'starting', 'running', 'stopping', 'error'])
});

/** Result of uploading a context file: an artifact ref + the original name. */
export const ContextFileUploadResponseSchema = z.object({
  ref: z.string(),
  name: z.string()
});
export type ContextFileRef = z.infer<typeof ContextFileUploadResponseSchema>;

// ---- REST DTOs -------------------------------------------------------------

export const AgentProjectDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  mode: z.enum(['plan', 'steer']),
  pinned: z.boolean(),
  agentModel: AgentProjectModelSchema.nullable(),
  updatedAt: z.string().nullable()
});
export type AgentProjectDto = z.infer<typeof AgentProjectDtoSchema>;

export const CreateAgentProjectResponseSchema = z.object({
  projectId: z.string()
});

export const ListAgentProjectsParamsSchema = z.object({
  page: z.number().optional(),
  pageSize: z.number().optional(),
  search: z.string().optional()
});
export type ListAgentProjectsParams = z.infer<
  typeof ListAgentProjectsParamsSchema
>;

export const ListAgentProjectsResponseSchema = z.object({
  projects: z.array(AgentProjectDtoSchema),
  totalPages: z.number(),
  currentPage: z.number(),
  totalCount: z.number()
});
export type ListAgentProjectsResponse = z.infer<
  typeof ListAgentProjectsResponseSchema
>;

export const GetAgentProjectResponseSchema = z.object({
  project: AgentProjectDtoSchema,
  messages: z.array(AgentMessageViewSchema),
  queue: z.array(AgentQueuedViewSchema)
});
export type GetAgentProjectResponse = z.infer<
  typeof GetAgentProjectResponseSchema
>;

export const AgentFileTreeResponseSchema = z.object({
  nodes: z.array(AgentFileNodeSchema)
});

export type CreateAgentProjectInput = {
  mode?: AgentMode;
  modelId?: string;
};
