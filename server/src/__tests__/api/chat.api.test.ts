import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  setupApiTestSchema,
  teardownApiTestSchema,
  createApiAgent,
  seedTestUser,
  loginAgent,
  cleanAllTables
} from '../../test-utils/apiTestHelper';
import { getDataDir } from '../../utils/env';
import type supertest from 'supertest';

let agent: supertest.Agent;

beforeAll(async () => {
  await setupApiTestSchema();
  agent = await createApiAgent();
});

afterAll(async () => {
  await teardownApiTestSchema();
});

beforeEach(async () => {
  await cleanAllTables();
  await seedTestUser({
    userName: 'admin',
    password: 'password123',
    email: 'admin@test.com',
    userRole: 'admin'
  });
  await loginAgent(agent, 'admin', 'password123');
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Creates a thread via the API and returns its id. */
async function createThread(
  a: supertest.Agent,
  title?: string
): Promise<string> {
  const res = await a
    .post('/api/chat/threads/create')
    .send(title ? { title } : {})
    .expect(200);
  return res.body.threadId as string;
}

/** Inserts a user message into the given thread via the repository. */
async function insertMessage(
  threadId: string,
  opts: {
    source?: 'user' | 'assistant';
    content?: string;
    parentMessageId?: string | null;
    createdBy?: string;
    model?: string;
  } = {}
): Promise<string> {
  const { messageRepo, threadRepo } = await import(
    '../../repositories/registry'
  );

  const msg = await messageRepo.create({
    thread_id: threadId,
    source: opts.source ?? 'user',
    data: {
      role: opts.source ?? 'user',
      content: opts.content ?? 'hello'
    },
    parent_message_id: opts.parentMessageId ?? null,
    model: opts.model ?? null
  });

  // Keep the thread's leaf pointer up-to-date
  await threadRepo.update(threadId, { current_leaf_message_id: msg.id });
  return msg.id;
}

// ─── POST /api/chat/threads/create ─────────────────────────────────────────

describe('POST /api/chat/threads/create', () => {
  it('creates a new thread and returns threadId', async () => {
    const res = await agent
      .post('/api/chat/threads/create')
      .send({})
      .expect(200);

    expect(res.body).toHaveProperty('threadId');
    expect(typeof res.body.threadId).toBe('string');
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent.post('/api/chat/threads/create').send({}).expect(401);
  });
});

// ─── GET /api/chat/threads ─────────────────────────────────────────────────

describe('GET /api/chat/threads', () => {
  it('returns empty list when no threads exist', async () => {
    const res = await agent.get('/api/chat/threads').expect(200);

    expect(res.body.threads).toEqual([]);
    expect(res.body.totalPages).toBe(0);
    expect(res.body.currentPage).toBe(1);
    expect(res.body.totalCount).toBe(0);
  });

  it('returns threads belonging to the authenticated user', async () => {
    await createThread(agent);
    await createThread(agent);

    const res = await agent.get('/api/chat/threads').expect(200);

    expect(res.body.threads).toHaveLength(2);
    expect(res.body.totalCount).toBe(2);
  });

  it('does not return threads of another user', async () => {
    // Create a thread as admin
    await createThread(agent);

    // Create a second user and log in
    const agent2 = await createApiAgent();
    await seedTestUser({
      userName: 'other',
      password: 'password123',
      email: 'other@test.com'
    });
    await loginAgent(agent2, 'other', 'password123');

    const res = await agent2.get('/api/chat/threads').expect(200);
    expect(res.body.threads).toHaveLength(0);
  });

  it('supports pagination with pageSize and pageNumber', async () => {
    // Create 5 threads
    for (let i = 0; i < 5; i++) {
      await createThread(agent);
    }

    const page1 = await agent
      .get('/api/chat/threads')
      .query({ pageSize: '2', pageNumber: '1' })
      .expect(200);

    expect(page1.body.threads).toHaveLength(2);
    expect(page1.body.totalCount).toBe(5);
    expect(page1.body.totalPages).toBe(3);
    expect(page1.body.currentPage).toBe(1);

    const page3 = await agent
      .get('/api/chat/threads')
      .query({ pageSize: '2', pageNumber: '3' })
      .expect(200);

    expect(page3.body.threads).toHaveLength(1);
    expect(page3.body.currentPage).toBe(3);
  });

  it('supports search by title', async () => {
    const threadId = await createThread(agent);

    // Rename the thread so we have a searchable title
    await agent
      .patch(`/api/chat/threads/${threadId}`)
      .send({ title: 'Unique Search Title' })
      .expect(200);

    // Create another thread with a different title
    const otherId = await createThread(agent);
    await agent
      .patch(`/api/chat/threads/${otherId}`)
      .send({ title: 'Something Else' })
      .expect(200);

    const res = await agent
      .get('/api/chat/threads')
      .query({ searchWord: 'Unique' })
      .expect(200);

    expect(res.body.threads).toHaveLength(1);
    expect(res.body.threads[0].id).toBe(threadId);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent.get('/api/chat/threads').expect(401);
  });
});

// ─── GET /api/chat/threads/pinned ──────────────────────────────────────────

describe('GET /api/chat/threads/pinned', () => {
  it('returns empty list when no threads are pinned', async () => {
    await createThread(agent);

    const res = await agent.get('/api/chat/threads/pinned').expect(200);
    expect(res.body.threads).toEqual([]);
  });

  it('returns only pinned threads', async () => {
    const threadId1 = await createThread(agent);
    await createThread(agent); // unpinned

    // Pin the first thread
    await agent
      .patch(`/api/chat/threads/${threadId1}/pin`)
      .send({ pinned: true })
      .expect(200);

    const res = await agent.get('/api/chat/threads/pinned').expect(200);
    expect(res.body.threads).toHaveLength(1);
    expect(res.body.threads[0].id).toBe(threadId1);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent.get('/api/chat/threads/pinned').expect(401);
  });
});

// ─── PATCH /api/chat/threads/:threadId ─────────────────────────────────────

describe('PATCH /api/chat/threads/:threadId', () => {
  it('renames a thread', async () => {
    const threadId = await createThread(agent);

    const res = await agent
      .patch(`/api/chat/threads/${threadId}`)
      .send({ title: 'Renamed Thread' })
      .expect(200);

    expect(res.body.thread.title).toBe('Renamed Thread');
    expect(res.body.thread.id).toBe(threadId);
  });

  it('returns 400 for empty title', async () => {
    const threadId = await createThread(agent);

    await agent
      .patch(`/api/chat/threads/${threadId}`)
      .send({ title: '' })
      .expect(400);
  });

  it('returns 400 for whitespace-only title', async () => {
    const threadId = await createThread(agent);

    await agent
      .patch(`/api/chat/threads/${threadId}`)
      .send({ title: '   ' })
      .expect(400);
  });

  it('returns 404 for non-existent thread', async () => {
    await agent
      .patch('/api/chat/threads/00000000-0000-0000-0000-000000000000')
      .send({ title: 'Nope' })
      .expect(404);
  });

  it('returns 404 when another user tries to rename', async () => {
    const threadId = await createThread(agent);

    const agent2 = await createApiAgent();
    await seedTestUser({
      userName: 'other',
      password: 'password123',
      email: 'other@test.com'
    });
    await loginAgent(agent2, 'other', 'password123');

    await agent2
      .patch(`/api/chat/threads/${threadId}`)
      .send({ title: 'Hijacked' })
      .expect(404);
  });

  it('returns 401 for unauthenticated request', async () => {
    const threadId = await createThread(agent);
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .patch(`/api/chat/threads/${threadId}`)
      .send({ title: 'Nope' })
      .expect(401);
  });
});

// ─── PATCH /api/chat/threads/:threadId/pin ─────────────────────────────────

describe('PATCH /api/chat/threads/:threadId/pin', () => {
  it('pins a thread', async () => {
    const threadId = await createThread(agent);

    const res = await agent
      .patch(`/api/chat/threads/${threadId}/pin`)
      .send({ pinned: true })
      .expect(200);

    expect(res.body.thread.pinned).toBe(true);
  });

  it('unpins a thread', async () => {
    const threadId = await createThread(agent);

    // Pin first
    await agent
      .patch(`/api/chat/threads/${threadId}/pin`)
      .send({ pinned: true })
      .expect(200);

    // Unpin
    const res = await agent
      .patch(`/api/chat/threads/${threadId}/pin`)
      .send({ pinned: false })
      .expect(200);

    expect(res.body.thread.pinned).toBe(false);
  });

  it('returns 404 for non-existent thread', async () => {
    await agent
      .patch('/api/chat/threads/00000000-0000-0000-0000-000000000000/pin')
      .send({ pinned: true })
      .expect(404);
  });

  it('returns 404 when another user tries to pin', async () => {
    const threadId = await createThread(agent);

    const agent2 = await createApiAgent();
    await seedTestUser({
      userName: 'other',
      password: 'password123',
      email: 'other@test.com'
    });
    await loginAgent(agent2, 'other', 'password123');

    await agent2
      .patch(`/api/chat/threads/${threadId}/pin`)
      .send({ pinned: true })
      .expect(404);
  });

  it('returns 401 for unauthenticated request', async () => {
    const threadId = await createThread(agent);
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .patch(`/api/chat/threads/${threadId}/pin`)
      .send({ pinned: true })
      .expect(401);
  });
});

// ─── DELETE /api/chat/threads/:threadId ────────────────────────────────────

describe('DELETE /api/chat/threads/:threadId', () => {
  it('deletes a thread', async () => {
    const threadId = await createThread(agent);

    const res = await agent.delete(`/api/chat/threads/${threadId}`).expect(200);

    expect(res.body.success).toBe(true);

    // Verify it's gone
    const list = await agent.get('/api/chat/threads').expect(200);
    expect(list.body.threads).toHaveLength(0);
  });

  it('deletes a thread along with its messages', async () => {
    const threadId = await createThread(agent);
    await insertMessage(threadId, { content: 'to be deleted' });

    await agent.delete(`/api/chat/threads/${threadId}`).expect(200);

    // Thread should not appear anymore
    const list = await agent.get('/api/chat/threads').expect(200);
    expect(
      list.body.threads.find((t: { id: string }) => t.id === threadId)
    ).toBeUndefined();
  });

  it('returns 404 for non-existent thread', async () => {
    await agent
      .delete('/api/chat/threads/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });

  it('returns 404 when another user tries to delete', async () => {
    const threadId = await createThread(agent);

    const agent2 = await createApiAgent();
    await seedTestUser({
      userName: 'other',
      password: 'password123',
      email: 'other@test.com'
    });
    await loginAgent(agent2, 'other', 'password123');

    await agent2.delete(`/api/chat/threads/${threadId}`).expect(404);
  });

  it('returns 401 for unauthenticated request', async () => {
    const threadId = await createThread(agent);
    const unauthAgent = await createApiAgent();
    await unauthAgent.delete(`/api/chat/threads/${threadId}`).expect(401);
  });

  it('deletes image files referenced by messages', async () => {
    // Minimal valid PNG
    const validPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
      0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
      0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
    ]);

    // Upload an image
    const uploadRes = await agent
      .post('/api/upload/image')
      .set('Content-Type', 'application/octet-stream')
      .send(validPng)
      .expect(200);

    const { filename, url } = uploadRes.body as {
      filename: string;
      url: string;
    };
    const artifactPath = path.join(getDataDir(), 'artifacts', filename);

    // Verify file exists
    await expect(fs.access(artifactPath)).resolves.toBeUndefined();

    // Create thread with a message referencing the image
    const threadId = await createThread(agent);
    const { messageRepo } = await import('../../repositories/registry');
    await messageRepo.create({
      thread_id: threadId,
      source: 'user',
      data: {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image_url', image_url: { url } }
        ]
      }
    });

    // Delete thread
    await agent.delete(`/api/chat/threads/${threadId}`).expect(200);

    // Verify image file is deleted
    await expect(fs.access(artifactPath)).rejects.toThrow();
  });
});

// ─── GET /api/chat/threads/:threadId/messages ──────────────────────────────

describe('GET /api/chat/threads/:threadId/messages', () => {
  it('returns empty messages for a thread with no messages', async () => {
    const threadId = await createThread(agent);

    const res = await agent
      .get(`/api/chat/threads/${threadId}/messages`)
      .expect(200);

    expect(res.body.messages).toEqual([]);
    expect(res.body).toHaveProperty('title');
    expect(res.body).toHaveProperty('pinned');
  });

  it('returns messages for a thread with messages', async () => {
    const threadId = await createThread(agent);
    const userMsgId = await insertMessage(threadId, {
      source: 'user',
      content: 'Hello'
    });
    await insertMessage(threadId, {
      source: 'assistant',
      content: 'Hi there',
      parentMessageId: userMsgId
    });

    const res = await agent
      .get(`/api/chat/threads/${threadId}/messages`)
      .expect(200);

    expect(res.body.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('returns 404 for non-existent thread', async () => {
    await agent
      .get('/api/chat/threads/00000000-0000-0000-0000-000000000000/messages')
      .expect(404);
  });

  it('returns 404 when accessing another user thread', async () => {
    const threadId = await createThread(agent);

    const agent2 = await createApiAgent();
    await seedTestUser({
      userName: 'other',
      password: 'password123',
      email: 'other@test.com'
    });
    await loginAgent(agent2, 'other', 'password123');

    await agent2.get(`/api/chat/threads/${threadId}/messages`).expect(404);
  });

  it('returns 401 for unauthenticated request', async () => {
    const threadId = await createThread(agent);
    const unauthAgent = await createApiAgent();
    await unauthAgent.get(`/api/chat/threads/${threadId}/messages`).expect(401);
  });
});

// ─── POST /api/chat/threads/:threadId/messages/branch-status ───────────────

describe('POST /api/chat/threads/:threadId/messages/branch-status', () => {
  it('returns branch statuses for given message IDs', async () => {
    const threadId = await createThread(agent);
    const msgId = await insertMessage(threadId, {
      source: 'user',
      content: 'Branch test'
    });

    const res = await agent
      .post(`/api/chat/threads/${threadId}/messages/branch-status`)
      .send({ messageIds: [msgId] })
      .expect(200);

    expect(res.body).toHaveProperty('branchStatuses');
    expect(typeof res.body.branchStatuses).toBe('object');
  });

  it('returns empty statuses when messageIds is empty array', async () => {
    const threadId = await createThread(agent);

    const res = await agent
      .post(`/api/chat/threads/${threadId}/messages/branch-status`)
      .send({ messageIds: [] })
      .expect(200);

    expect(res.body.branchStatuses).toEqual({});
  });

  it('returns 400 when messageIds is not an array', async () => {
    const threadId = await createThread(agent);

    await agent
      .post(`/api/chat/threads/${threadId}/messages/branch-status`)
      .send({ messageIds: 'not-an-array' })
      .expect(400);
  });

  it('returns 404 for non-existent thread', async () => {
    await agent
      .post(
        '/api/chat/threads/00000000-0000-0000-0000-000000000000/messages/branch-status'
      )
      .send({ messageIds: [] })
      .expect(404);
  });

  it('returns 404 when accessing another user thread', async () => {
    const threadId = await createThread(agent);

    const agent2 = await createApiAgent();
    await seedTestUser({
      userName: 'other',
      password: 'password123',
      email: 'other@test.com'
    });
    await loginAgent(agent2, 'other', 'password123');

    await agent2
      .post(`/api/chat/threads/${threadId}/messages/branch-status`)
      .send({ messageIds: [] })
      .expect(404);
  });

  it('returns 401 for unauthenticated request', async () => {
    const threadId = await createThread(agent);
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .post(`/api/chat/threads/${threadId}/messages/branch-status`)
      .send({ messageIds: [] })
      .expect(401);
  });
});

// ─── POST /api/chat/threads/:threadId/messages/:messageId/switch-branch ────

describe('POST /api/chat/threads/:threadId/messages/:messageId/switch-branch', () => {
  it('switches branch and returns updated messages', async () => {
    const threadId = await createThread(agent);

    // Build a tree:
    //   userMsg1 (root)
    //     -> assistantMsg1 (branch A, selected)
    //     -> assistantMsg2 (branch B)
    const userMsgId = await insertMessage(threadId, {
      source: 'user',
      content: 'root message'
    });

    const { messageRepo } = await import('../../repositories/registry');

    // Branch A
    const branchA = await messageRepo.create({
      thread_id: threadId,
      source: 'assistant',
      data: { role: 'assistant', content: 'branch A' },
      parent_message_id: userMsgId,
      model: 'test'
    });

    // Set selected_child_id on the user message to branchA
    await messageRepo.update(userMsgId, { selected_child_id: branchA.id });

    // Branch B
    const branchB = await messageRepo.create({
      thread_id: threadId,
      source: 'assistant',
      data: { role: 'assistant', content: 'branch B' },
      parent_message_id: userMsgId,
      model: 'test'
    });

    const { threadRepo } = await import('../../repositories/registry');
    await threadRepo.update(threadId, {
      current_leaf_message_id: branchA.id
    });

    // Switch from branchA to branchB
    const res = await agent
      .post(
        `/api/chat/threads/${threadId}/messages/${branchA.id}/switch-branch`
      )
      .send({ targetSiblingId: branchB.id })
      .expect(200);

    expect(res.body).toHaveProperty('messages');
    expect(res.body).toHaveProperty('title');
    expect(res.body).toHaveProperty('pinned');
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it('returns 404 for non-existent thread', async () => {
    await agent
      .post(
        '/api/chat/threads/00000000-0000-0000-0000-000000000000/messages/00000000-0000-0000-0000-000000000001/switch-branch'
      )
      .send({ targetSiblingId: '00000000-0000-0000-0000-000000000002' })
      .expect(404);
  });

  it('returns 404 for non-existent message', async () => {
    const threadId = await createThread(agent);

    await agent
      .post(
        `/api/chat/threads/${threadId}/messages/00000000-0000-0000-0000-000000000099/switch-branch`
      )
      .send({ targetSiblingId: '00000000-0000-0000-0000-000000000098' })
      .expect(404);
  });

  it('returns 404 when accessing another user thread', async () => {
    const threadId = await createThread(agent);
    const msgId = await insertMessage(threadId, {
      source: 'user',
      content: 'test'
    });

    const agent2 = await createApiAgent();
    await seedTestUser({
      userName: 'other',
      password: 'password123',
      email: 'other@test.com'
    });
    await loginAgent(agent2, 'other', 'password123');

    await agent2
      .post(`/api/chat/threads/${threadId}/messages/${msgId}/switch-branch`)
      .send({ targetSiblingId: '00000000-0000-0000-0000-000000000001' })
      .expect(404);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .post(
        '/api/chat/threads/00000000-0000-0000-0000-000000000000/messages/00000000-0000-0000-0000-000000000001/switch-branch'
      )
      .send({ targetSiblingId: '00000000-0000-0000-0000-000000000002' })
      .expect(401);
  });
});

// ─── GET /api/chat/threads/:threadId/messages/:messageId/user-prompt ───────

describe('GET /api/chat/threads/:threadId/messages/:messageId/user-prompt', () => {
  it('returns the user prompt for an assistant message', async () => {
    const threadId = await createThread(agent);

    const userMsgId = await insertMessage(threadId, {
      source: 'user',
      content: 'What is the meaning of life?'
    });
    const assistantMsgId = await insertMessage(threadId, {
      source: 'assistant',
      content: '42',
      parentMessageId: userMsgId
    });

    const res = await agent
      .get(
        `/api/chat/threads/${threadId}/messages/${assistantMsgId}/user-prompt`
      )
      .expect(200);

    expect(res.body.prompt).toBe('What is the meaning of life?');
  });

  it('returns 404 for non-existent thread', async () => {
    await agent
      .get(
        '/api/chat/threads/00000000-0000-0000-0000-000000000000/messages/00000000-0000-0000-0000-000000000001/user-prompt'
      )
      .expect(404);
  });

  it('returns 404 for non-existent message', async () => {
    const threadId = await createThread(agent);

    await agent
      .get(
        `/api/chat/threads/${threadId}/messages/00000000-0000-0000-0000-000000000099/user-prompt`
      )
      .expect(404);
  });

  it('returns 404 when accessing another user thread', async () => {
    const threadId = await createThread(agent);
    const userMsgId = await insertMessage(threadId, {
      source: 'user',
      content: 'test'
    });
    const assistantMsgId = await insertMessage(threadId, {
      source: 'assistant',
      content: 'reply',
      parentMessageId: userMsgId
    });

    const agent2 = await createApiAgent();
    await seedTestUser({
      userName: 'other',
      password: 'password123',
      email: 'other@test.com'
    });
    await loginAgent(agent2, 'other', 'password123');

    await agent2
      .get(
        `/api/chat/threads/${threadId}/messages/${assistantMsgId}/user-prompt`
      )
      .expect(404);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .get(
        '/api/chat/threads/00000000-0000-0000-0000-000000000000/messages/00000000-0000-0000-0000-000000000001/user-prompt'
      )
      .expect(401);
  });
});

// ─── POST /api/chat/tools/:toolCallId/approve ──────────────────────────────

describe('POST /api/chat/tools/:toolCallId/approve', () => {
  it('returns success for a valid approval request', async () => {
    const res = await agent
      .post('/api/chat/tools/fake-tool-call-id/approve')
      .send({ approved: true })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('returns success for a rejection request', async () => {
    const res = await agent
      .post('/api/chat/tools/fake-tool-call-id/approve')
      .send({ approved: false })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('returns 400 when approved is not a boolean', async () => {
    await agent
      .post('/api/chat/tools/fake-tool-call-id/approve')
      .send({ approved: 'yes' })
      .expect(400);
  });

  it('returns 400 when approved is missing', async () => {
    await agent
      .post('/api/chat/tools/fake-tool-call-id/approve')
      .send({})
      .expect(400);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .post('/api/chat/tools/fake-tool-call-id/approve')
      .send({ approved: true })
      .expect(401);
  });
});
