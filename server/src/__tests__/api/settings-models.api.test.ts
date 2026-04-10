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
  TEST_ADMIN,
  TEST_STANDARD
} from '../../test-utils/apiTestHelper';
import type supertest from 'supertest';

// Mock chatClientFactory to avoid real API calls for model operations
vi.mock('../../factories/chatClientFactory', () => ({
  createChatApiClient: vi.fn(() => ({
    getMaxContextLength: vi.fn().mockResolvedValue(4096)
  })),
  createChatClient: vi.fn(() => ({
    onContextAdded: vi.fn(),
    setMessageHandler: vi.fn(),
    setThinkingHandler: vi.fn(),
    setReasoningHandler: vi.fn(),
    setToolCallHandler: vi.fn(),
    setMessages: vi.fn(),
    setSystemPrompt: vi.fn(),
    getToolCallPlan: vi.fn().mockReturnValue([]),
    sendMessage: vi.fn()
  }))
}));

// Mock OpenAIChatApiClient.listModels for /models/available
vi.mock('tenjo-chat-engine', async (importOriginal) => {
  const original = await importOriginal<typeof import('tenjo-chat-engine')>();
  return {
    ...original,
    OpenAIChatApiClient: {
      ...original.OpenAIChatApiClient,
      listModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4', owned_by: 'openai' },
        { id: 'gpt-3.5-turbo', owned_by: 'openai' }
      ])
    },
    LocalChatApiClient: class {
      getMaxContextLength = vi.fn().mockResolvedValue(null);
    }
  };
});

// Mock McpToolService
vi.mock('../../services/McpToolService', () => {
  class MockMcpToolService {
    initializeMcpConnection = vi.fn().mockResolvedValue({
      mcpClientManager: { close: vi.fn() },
      tools: []
    });
    validateAndGetToolsByServer = vi.fn().mockResolvedValue({
      tools: { 'test-server': ['tool1', 'tool2'] },
      errors: {}
    });
  }
  return { McpToolService: MockMcpToolService };
});

let adminAgent: supertest.Agent;
let standardAgent: supertest.Agent;

beforeAll(async () => {
  await setupApiTestSchema();
  adminAgent = await createApiAgent();
  standardAgent = await createApiAgent();
});

afterAll(async () => {
  await teardownApiTestSchema();
});

beforeEach(async () => {
  await cleanAllTables();
  await seedTestUser(TEST_ADMIN);
  await seedTestUser(TEST_STANDARD);
  await loginAgent(adminAgent, TEST_ADMIN.userName, TEST_ADMIN.password);
  await loginAgent(
    standardAgent,
    TEST_STANDARD.userName,
    TEST_STANDARD.password
  );
});

// ---------------------------------------------------------------------------
// GET /api/settings/models/available
// ---------------------------------------------------------------------------
describe('GET /api/settings/models/available', () => {
  it('returns available models from the server', async () => {
    const res = await adminAgent
      .get('/api/settings/models/available')
      .query({ baseUrl: 'http://localhost:1234' })
      .expect(200);

    expect(res.body.models).toHaveLength(2);
    expect(res.body.models[0]).toMatchObject({
      id: 'gpt-3.5-turbo',
      ownedBy: 'openai'
    });
  });

  it('returns 400 when baseUrl is missing', async () => {
    await adminAgent.get('/api/settings/models/available').expect(400);
  });

  it('returns 502 when external server fails', async () => {
    // Make listModels throw to trigger the error branch
    const { OpenAIChatApiClient } = await import('tenjo-chat-engine');
    vi.mocked(OpenAIChatApiClient.listModels).mockRejectedValueOnce(
      new Error('Connection refused')
    );

    await adminAgent
      .get('/api/settings/models/available')
      .query({ baseUrl: 'http://bad-server:9999' })
      .expect(502);
  });

  it('returns 403 for standard user', async () => {
    await standardAgent
      .get('/api/settings/models/available')
      .query({ baseUrl: 'http://localhost:1234' })
      .expect(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/settings/models
// ---------------------------------------------------------------------------
describe('POST /api/settings/models', () => {
  it('adds a new model', async () => {
    const res = await adminAgent
      .post('/api/settings/models')
      .send({
        type: 'openai',
        baseUrl: 'http://localhost:1234',
        model: 'new-model'
      })
      .expect(200);

    expect(res.body.model).toMatchObject({
      type: 'openai',
      baseUrl: 'http://localhost:1234',
      model: 'new-model'
    });
  });

  // Token storage requires pgcrypto (pgp_sym_encrypt) which may not be
  // available in all test environments. Token model coverage is tested
  // at the service/repository level instead.

  it('returns 400 for missing required fields', async () => {
    await adminAgent
      .post('/api/settings/models')
      .send({ type: 'openai' })
      .expect(400);
  });

  it('returns 409 for duplicate model', async () => {
    await adminAgent
      .post('/api/settings/models')
      .send({
        type: 'openai',
        baseUrl: 'http://localhost:1234',
        model: 'dup-model'
      })
      .expect(200);

    await adminAgent
      .post('/api/settings/models')
      .send({
        type: 'openai',
        baseUrl: 'http://localhost:1234',
        model: 'dup-model'
      })
      .expect(409);
  });

  it('returns 403 for standard user', async () => {
    await standardAgent
      .post('/api/settings/models')
      .send({
        type: 'openai',
        baseUrl: 'http://localhost:1234',
        model: 'test'
      })
      .expect(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/settings/models/:id
// ---------------------------------------------------------------------------
describe('DELETE /api/settings/models/:id', () => {
  it('deletes a model', async () => {
    // Add a model first
    const addRes = await adminAgent
      .post('/api/settings/models')
      .send({
        type: 'openai',
        baseUrl: 'http://localhost:5000',
        model: 'deletable-model'
      })
      .expect(200);

    const modelId = addRes.body.model.id;

    await adminAgent.delete(`/api/settings/models/${modelId}`).expect(200);

    // Verify it's gone
    const listRes = await adminAgent.get('/api/settings/models').expect(200);
    const modelIds = listRes.body.models.map((m: { id: string }) => m.id);
    expect(modelIds).not.toContain(modelId);
  });

  it('returns 404 for nonexistent model', async () => {
    await adminAgent.delete('/api/settings/models/nonexistent-id').expect(404);
  });

  it('returns 403 for standard user', async () => {
    await standardAgent.delete('/api/settings/models/some-id').expect(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/settings/mcp-servers
// ---------------------------------------------------------------------------
describe('GET /api/settings/mcp-servers', () => {
  it('returns empty MCP servers initially', async () => {
    const res = await adminAgent.get('/api/settings/mcp-servers').expect(200);

    expect(res.body.mcpServers).toBeDefined();
    expect(res.body.oauthCallbackUrl).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GET /api/settings/mcp-tools
// ---------------------------------------------------------------------------
describe('GET /api/settings/mcp-tools', () => {
  it('returns tools from MCP servers', async () => {
    const res = await adminAgent.get('/api/settings/mcp-tools').expect(200);

    expect(res.body.tools).toBeDefined();
    expect(res.body.errors).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// PUT /api/settings/mcp-servers
// ---------------------------------------------------------------------------
describe('PUT /api/settings/mcp-servers', () => {
  it('updates MCP server configuration', async () => {
    const res = await adminAgent
      .put('/api/settings/mcp-servers')
      .send({
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['server.js']
          }
        }
      })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('validates server configuration', async () => {
    await adminAgent
      .put('/api/settings/mcp-servers')
      .send({
        mcpServers: {
          'bad-server': {} // missing command for stdio type
        }
      })
      .expect(400);
  });

  it('validates http server requires url', async () => {
    await adminAgent
      .put('/api/settings/mcp-servers')
      .send({
        mcpServers: {
          'http-server': { type: 'http' } // missing url
        }
      })
      .expect(400);
  });

  it('validates oauth-http server requires url', async () => {
    await adminAgent
      .put('/api/settings/mcp-servers')
      .send({
        mcpServers: {
          'oauth-server': { type: 'oauth-http' } // missing url
        }
      })
      .expect(400);
  });

  it('rejects non-object mcpServers', async () => {
    await adminAgent
      .put('/api/settings/mcp-servers')
      .send({ mcpServers: 'not-an-object' })
      .expect(400);
  });

  it('rejects null mcpServers', async () => {
    await adminAgent
      .put('/api/settings/mcp-servers')
      .send({ mcpServers: null })
      .expect(400);
  });

  it('rejects array mcpServers', async () => {
    await adminAgent
      .put('/api/settings/mcp-servers')
      .send({ mcpServers: [] })
      .expect(400);
  });

  it('rejects invalid server config object', async () => {
    await adminAgent
      .put('/api/settings/mcp-servers')
      .send({
        mcpServers: {
          bad: null
        }
      })
      .expect(400);
  });

  it('returns 403 for standard user', async () => {
    await standardAgent
      .put('/api/settings/mcp-servers')
      .send({
        mcpServers: {
          'test-server': { command: 'node', args: [] }
        }
      })
      .expect(403);
  });
});
