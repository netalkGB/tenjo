import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AgentProjectRepository } from '../AgentProjectRepository';
import { AgentMessageRepository } from '../AgentMessageRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';
import type { MessageRequest } from 'tenjo-chat-engine';

const USER = '00000000-0000-0000-0000-00000000000a';

describe('AgentMessageRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let projectRepo: AgentProjectRepository;
  let repo: AgentMessageRepository;
  let projectId: string;

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({ ...config, schemaSuffix: 'agentmsg' });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();
    projectRepo = new AgentProjectRepository(testDb.getPool());
    repo = new AgentMessageRepository(testDb.getPool());
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();
    const project = await projectRepo.create({ created_by: USER });
    projectId = project!.id;
  });

  const userMessage: MessageRequest = { role: 'user', content: 'hello' };
  const assistantMessage: MessageRequest = {
    role: 'assistant',
    content: 'hi there'
  };

  it('appends messages and returns them in seq order', async () => {
    await repo.append({
      project_id: projectId,
      role: 'user',
      source: 'user',
      data: userMessage
    });
    await repo.append({
      project_id: projectId,
      role: 'assistant',
      source: 'assistant',
      data: assistantMessage
    });
    const messages = await repo.listByProject(projectId);
    expect(messages).toHaveLength(2);
    expect(messages[0].data).toEqual(userMessage);
    expect(messages[1].data).toEqual(assistantMessage);
    // seq is monotonic.
    expect(Number(messages[1].seq)).toBeGreaterThan(Number(messages[0].seq));
  });

  it('should find a message by id', async () => {
    const message = await repo.append({
      project_id: projectId,
      role: 'user',
      source: 'user',
      data: userMessage,
      created_by: USER
    });

    const found = await repo.findById(message.id);

    expect(found).toBeDefined();
    expect(found!.id).toBe(message.id);
    expect(found!.data).toEqual(userMessage);
    expect(found!.created_by).toBe(USER);
    expect(found!.updated_by).toBe(USER);
    expect(found!.updated_at).toBeDefined();
    const project = await projectRepo.findById(projectId);
    expect(project!.updated_by).toBe(USER);
    expect(project!.updated_at).toBeDefined();
  });

  it('should return undefined when message does not exist', async () => {
    const found = await repo.findById('00000000-0000-0000-0000-000000000000');

    expect(found).toBeUndefined();
  });

  it('attaches a plan to the latest assistant message', async () => {
    await repo.append({
      project_id: projectId,
      role: 'user',
      source: 'user',
      data: userMessage
    });
    await repo.append({
      project_id: projectId,
      role: 'assistant',
      source: 'assistant',
      data: assistantMessage
    });
    const plan = {
      summary: null,
      todos: [{ text: 'a', status: 'pending' as const }],
      status: 'proposed' as const
    };
    const updated = await repo.setPlanForLatestAssistant(projectId, plan, USER);
    expect(updated?.role).toBe('assistant');
    expect(updated?.plan).toEqual(plan);
    expect(updated?.updated_by).toBe(USER);
    expect(updated?.updated_at).toBeDefined();
  });

  it('should return undefined when setting a plan without assistant messages', async () => {
    await repo.append({
      project_id: projectId,
      role: 'user',
      source: 'user',
      data: userMessage
    });
    const plan = {
      summary: null,
      todos: [],
      status: 'proposed' as const
    };

    const updated = await repo.setPlanForLatestAssistant(projectId, plan);

    expect(updated).toBeUndefined();
  });

  it('should delete messages by project id and return the deleted count', async () => {
    await repo.append({
      project_id: projectId,
      role: 'user',
      source: 'user',
      data: userMessage
    });
    await repo.append({
      project_id: projectId,
      role: 'assistant',
      source: 'assistant',
      data: assistantMessage
    });

    const deleted = await repo.deleteByProjectId(projectId);

    expect(deleted).toBe(2);
    expect(await repo.listByProject(projectId)).toHaveLength(0);
  });

  it('cascades message deletion when the project is deleted', async () => {
    await repo.append({
      project_id: projectId,
      role: 'user',
      source: 'user',
      data: userMessage
    });
    await projectRepo.delete(projectId);
    const messages = await repo.listByProject(projectId);
    expect(messages).toHaveLength(0);
  });
});
