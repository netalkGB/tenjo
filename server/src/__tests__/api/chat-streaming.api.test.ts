import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi
} from 'vitest';
import {
  setupApiTestSchema,
  teardownApiTestSchema,
  createApiAgent,
  seedTestUser,
  loginAgent,
  cleanAllTables,
  TEST_ADMIN
} from '../../test-utils/apiTestHelper';
import type supertest from 'supertest';

// Mock the chat client factory to avoid real LLM API calls
vi.mock('../../factories/chatClientFactory', () => ({
  createChatApiClient: vi.fn(),
  createChatClient: vi.fn(() => {
    type Handler = (...args: unknown[]) => void;
    const handlers: Record<string, Handler> = {};
    return {
      onContextAdded: vi.fn((cb: Handler) => {
        handlers.onContextAdded = cb;
      }),
      setMessageHandler: vi.fn((cb: Handler) => {
        handlers.onMessage = cb;
      }),
      setThinkingHandler: vi.fn(),
      setReasoningHandler: vi.fn(),
      setToolCallHandler: vi.fn(),
      setMessages: vi.fn(),
      setSystemPrompt: vi.fn(),
      getToolCallPlan: vi.fn().mockReturnValue([]),
      addToolCallResult: vi.fn(),
      validateToolCallResult: vi.fn(),
      sendMessage: vi.fn(async (msg: string) => {
        // Simulate: context added for user, stream chunk, context added for assistant
        if (handlers.onContextAdded) {
          await handlers.onContextAdded({
            role: 'user',
            content: msg
          });
        }
        if (handlers.onMessage) {
          handlers.onMessage('Hello from mock');
        }
        if (handlers.onContextAdded) {
          await handlers.onContextAdded({
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello from mock' }]
          });
        }
      })
    };
  })
}));

// Mock MCP tool service to avoid real MCP connections
vi.mock('../../services/McpToolService', () => {
  class MockMcpToolService {
    initializeMcpConnection = vi.fn().mockResolvedValue({
      mcpClientManager: { close: vi.fn() },
      tools: []
    });
    validateAndGetToolsByServer = vi.fn().mockResolvedValue({
      tools: {},
      errors: {}
    });
  }
  return { McpToolService: MockMcpToolService };
});

let agent: supertest.Agent;

/**
 * Inserts a model entry directly into global_settings so that
 * resolveModelConfig can find it without external API calls.
 */
async function seedModelConfig(modelId: string): Promise<void> {
  const { pool } = await import('../../db/client');
  const settings = JSON.stringify({
    model: {
      activeId: modelId,
      models: [
        {
          id: modelId,
          type: 'openai',
          baseUrl: 'http://localhost:1234',
          model: 'test-model'
        }
      ]
    }
  });

  // Upsert into global_settings
  const existing = await pool.query('SELECT id FROM "global_settings" LIMIT 1');
  if (existing.rows.length > 0) {
    await pool.query('UPDATE "global_settings" SET "settings" = $1::jsonb', [
      settings
    ]);
  } else {
    await pool.query(
      'INSERT INTO "global_settings" ("settings") VALUES ($1::jsonb)',
      [settings]
    );
  }
}

/**
 * Parse SSE response text into an array of parsed data events.
 */
function parseSseEvents(text: string): unknown[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
}

beforeAll(async () => {
  await setupApiTestSchema();
  agent = await createApiAgent();
});

afterAll(async () => {
  await teardownApiTestSchema();
});

beforeEach(async () => {
  await cleanAllTables();
  await seedTestUser(TEST_ADMIN);
  await loginAgent(agent, TEST_ADMIN.userName, TEST_ADMIN.password);
  await seedModelConfig('test-model-id');
});

describe('POST /api/chat/threads/:threadId/messages (SSE)', () => {
  it('streams a response with SSE events', async () => {
    // Create a thread
    const threadRes = await agent.post('/api/chat/threads/create').expect(200);
    const { threadId } = threadRes.body;

    const res = await agent
      .post(`/api/chat/threads/${threadId}/messages`)
      .send({
        message: 'Hello',
        modelId: 'test-model-id'
      })
      .expect(200);

    expect(res.headers['content-type']).toContain('text/event-stream');

    const events = parseSseEvents(res.text);
    expect(events.length).toBeGreaterThan(0);

    // Should contain a chunk event and a done event
    const chunkEvent = events.find(
      (e) => typeof e === 'object' && e !== null && 'chunk' in e
    );
    expect(chunkEvent).toBeDefined();

    const doneEvent = events.find(
      (e) => typeof e === 'object' && e !== null && 'done' in e
    );
    expect(doneEvent).toBeDefined();
    expect(doneEvent).toMatchObject({
      done: true,
      model: 'test-model',
      provider: 'openai'
    });
  });

  it('generates a title for the first message', async () => {
    const threadRes = await agent.post('/api/chat/threads/create').expect(200);
    const { threadId } = threadRes.body;

    const res = await agent
      .post(`/api/chat/threads/${threadId}/messages`)
      .send({
        message: 'Hello',
        modelId: 'test-model-id'
      })
      .expect(200);

    const events = parseSseEvents(res.text);

    // Should have a generatingTitle event
    const titleEvent = events.find(
      (e) => typeof e === 'object' && e !== null && 'generatingTitle' in e
    );
    expect(titleEvent).toBeDefined();

    // Done event should include a title
    const doneEvent = events.find(
      (e) => typeof e === 'object' && e !== null && 'done' in e
    ) as Record<string, unknown> | undefined;
    expect(doneEvent?.title).toBeDefined();
  });

  it('accepts parentMessageId for follow-up messages', async () => {
    const threadRes = await agent.post('/api/chat/threads/create').expect(200);
    const { threadId } = threadRes.body;

    // Send first message
    const firstRes = await agent
      .post(`/api/chat/threads/${threadId}/messages`)
      .send({
        message: 'First message',
        modelId: 'test-model-id'
      })
      .expect(200);

    const firstEvents = parseSseEvents(firstRes.text);
    const firstDone = firstEvents.find(
      (e) => typeof e === 'object' && e !== null && 'done' in e
    ) as Record<string, unknown> | undefined;

    // Send follow-up
    const res = await agent
      .post(`/api/chat/threads/${threadId}/messages`)
      .send({
        message: 'Follow up',
        modelId: 'test-model-id',
        parentMessageId: firstDone?.assistantMessageId
      })
      .expect(200);

    const events = parseSseEvents(res.text);
    const doneEvent = events.find(
      (e) => typeof e === 'object' && e !== null && 'done' in e
    );
    expect(doneEvent).toBeDefined();

    // Follow-up should NOT generate a title event
    const titleEvent = events.find(
      (e) => typeof e === 'object' && e !== null && 'generatingTitle' in e
    );
    expect(titleEvent).toBeUndefined();
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .post('/api/chat/threads/some-thread-id/messages')
      .send({ message: 'hello', modelId: 'test-model-id' })
      .expect(401);
  });

  it('returns 404 for non-existent thread', async () => {
    const res = await agent
      .post('/api/chat/threads/00000000-0000-0000-0000-000000000000/messages')
      .send({ message: 'hello', modelId: 'test-model-id' });

    // SSE endpoint returns error via SSE event, not HTTP status
    // The error is sent as an SSE data event
    if (res.status === 200) {
      const events = parseSseEvents(res.text);
      const errorEvent = events.find(
        (e) => typeof e === 'object' && e !== null && 'error' in e
      );
      expect(errorEvent).toBeDefined();
    } else {
      expect(res.status).toBe(404);
    }
  });
});

describe('POST /api/chat/threads/:threadId/messages/:messageId/edit (SSE)', () => {
  it('edits a message and streams a new response', async () => {
    // Create thread and send initial message
    const threadRes = await agent.post('/api/chat/threads/create').expect(200);
    const { threadId } = threadRes.body;

    const sendRes = await agent
      .post(`/api/chat/threads/${threadId}/messages`)
      .send({
        message: 'Original',
        modelId: 'test-model-id'
      })
      .expect(200);

    const sendEvents = parseSseEvents(sendRes.text);
    const sendDone = sendEvents.find(
      (e) => typeof e === 'object' && e !== null && 'done' in e
    ) as Record<string, unknown> | undefined;
    const userMessageId = sendDone?.userMessageId as string;

    // Edit the user message
    const editRes = await agent
      .post(`/api/chat/threads/${threadId}/messages/${userMessageId}/edit`)
      .send({
        message: 'Edited message',
        modelId: 'test-model-id'
      })
      .expect(200);

    expect(editRes.headers['content-type']).toContain('text/event-stream');

    const editEvents = parseSseEvents(editRes.text);
    const editDone = editEvents.find(
      (e) => typeof e === 'object' && e !== null && 'done' in e
    );
    expect(editDone).toBeDefined();
    expect(editDone).toMatchObject({
      done: true,
      model: 'test-model',
      provider: 'openai'
    });
  });

  it('returns error for non-existent message', async () => {
    const threadRes = await agent.post('/api/chat/threads/create').expect(200);
    const { threadId } = threadRes.body;

    const res = await agent
      .post(
        `/api/chat/threads/${threadId}/messages/00000000-0000-0000-0000-000000000000/edit`
      )
      .send({
        message: 'Edit attempt',
        modelId: 'test-model-id'
      });

    // SSE error is sent via event stream
    if (res.status === 200) {
      const events = parseSseEvents(res.text);
      const errorEvent = events.find(
        (e) => typeof e === 'object' && e !== null && 'error' in e
      );
      expect(errorEvent).toBeDefined();
    } else {
      expect(res.status).toBe(404);
    }
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .post('/api/chat/threads/some-id/messages/some-id/edit')
      .send({ message: 'hello', modelId: 'test-model-id' })
      .expect(401);
  });
});
