import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  setupApiTestSchema,
  teardownApiTestSchema,
  createApiAgent,
  seedTestUser,
  loginAgent,
  cleanAllTables,
  TEST_STANDARD
} from '../../test-utils/apiTestHelper';
import type supertest from 'supertest';

// Minimal valid PNG: 1x1 pixel transparent PNG
const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21,
  0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
  0x82
]);

// Minimal valid JPEG: starts with JPEG magic bytes
const VALID_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00
]);

let agent: supertest.Agent;
let adminUserId: string;

beforeAll(async () => {
  await setupApiTestSchema();
  agent = await createApiAgent();
});

afterAll(async () => {
  await teardownApiTestSchema();
});

beforeEach(async () => {
  await cleanAllTables();
  const admin = await seedTestUser({
    userName: 'admin',
    password: 'password123',
    email: 'admin@test.com',
    userRole: 'admin'
  });
  adminUserId = admin.id;
  await loginAgent(agent, 'admin', 'password123');
});

async function createOwnedThread(userId: string): Promise<string> {
  const { threadRepo } = await import('../../repositories/registry');
  const thread = await threadRepo.create({
    title: 'image thread',
    created_by: userId,
    updated_by: userId
  });
  if (!thread) throw new Error('Failed to create test thread');
  return thread.id;
}

describe('POST /api/chat/threads/:threadId/artifacts', () => {
  it('uploads a PNG image successfully', async () => {
    const threadId = await createOwnedThread(adminUserId);
    const res = await agent
      .post(`/api/chat/threads/${threadId}/artifacts`)
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_PNG)
      .expect(200);

    expect(res.body.filename).toMatch(/\.png$/);
    expect(res.body.url).toContain(`/api/chat/threads/${threadId}/artifacts/`);
  });

  it('uploads a JPEG image successfully', async () => {
    const threadId = await createOwnedThread(adminUserId);
    const res = await agent
      .post(`/api/chat/threads/${threadId}/artifacts`)
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_JPEG)
      .expect(200);

    expect(res.body.filename).toMatch(/\.jpg$/);
    expect(res.body.url).toContain(`/api/chat/threads/${threadId}/artifacts/`);
  });

  it('returns 400 for empty body', async () => {
    const threadId = await createOwnedThread(adminUserId);
    await agent
      .post(`/api/chat/threads/${threadId}/artifacts`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(0))
      .expect(400);
  });

  it('returns 400 for unsupported file type', async () => {
    const threadId = await createOwnedThread(adminUserId);
    const invalidData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    await agent
      .post(`/api/chat/threads/${threadId}/artifacts`)
      .set('Content-Type', 'application/octet-stream')
      .send(invalidData)
      .expect(400);
  });

  it('returns 401 for unauthenticated request', async () => {
    const threadId = await createOwnedThread(adminUserId);
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .post(`/api/chat/threads/${threadId}/artifacts`)
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_PNG)
      .expect(401);
  });
});

describe('POST /api/agent/context-files', () => {
  it('uploads an arbitrary text/JSON file and preserves the original name', async () => {
    const res = await agent
      .post('/api/agent/context-files')
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent('data sample.json'))
      .send(Buffer.from('{"hello":"world"}', 'utf-8'))
      .expect(200);

    expect(res.body.name).toBe('data sample.json');
    expect(res.body.ref).toMatch(/\.json$/);
  });

  it('accepts a file with no X-File-Name header (defaults the name)', async () => {
    const res = await agent
      .post('/api/agent/context-files')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('plain text', 'utf-8'))
      .expect(200);

    expect(res.body.name).toBe('file');
    expect(typeof res.body.ref).toBe('string');
  });

  it('returns 400 for empty body', async () => {
    await agent
      .post('/api/agent/context-files')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(0))
      .expect(400);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .post('/api/agent/context-files')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x', 'utf-8'))
      .expect(401);
  });
});

describe('GET /api/chat/threads/:threadId/artifacts/:filename', () => {
  async function createMessageWithImage(
    threadId: string,
    url: string,
    userId: string
  ) {
    const { messageRepo, threadRepo } = await import(
      '../../repositories/registry'
    );
    const message = await messageRepo.create({
      thread_id: threadId,
      source: 'user',
      created_by: userId,
      updated_by: userId,
      data: {
        role: 'user',
        content: [
          { type: 'text', text: 'image' },
          { type: 'image_url', image_url: { url } }
        ]
      }
    });
    await threadRepo.update(threadId, { current_leaf_message_id: message.id });
  }

  it('returns 404 for an uploaded artifact before it is referenced', async () => {
    const threadId = await createOwnedThread(adminUserId);
    const uploadRes = await agent
      .post(`/api/chat/threads/${threadId}/artifacts`)
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_PNG)
      .expect(200);

    await agent.get(uploadRes.body.url).expect(404);
  });

  it('serves a chat image artifact to the owning user', async () => {
    const threadId = await createOwnedThread(adminUserId);
    const uploadRes = await agent
      .post(`/api/chat/threads/${threadId}/artifacts`)
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_PNG)
      .expect(200);

    await createMessageWithImage(threadId, uploadRes.body.url, adminUserId);

    const res = await agent.get(uploadRes.body.url).expect(200);

    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toContain('private');
  });

  it('serves a legacy chat image reference through the scoped artifact URL', async () => {
    const threadId = await createOwnedThread(adminUserId);
    const uploadRes = await agent
      .post(`/api/chat/threads/${threadId}/artifacts`)
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_PNG)
      .expect(200);

    await createMessageWithImage(
      threadId,
      `/api/upload/artifacts/${uploadRes.body.filename}`,
      adminUserId
    );

    const res = await agent.get(uploadRes.body.url).expect(200);

    expect(res.headers['content-type']).toContain('image/png');
  });

  it('returns 401 for an unauthenticated artifact request', async () => {
    const threadId = await createOwnedThread(adminUserId);
    const uploadRes = await agent
      .post(`/api/chat/threads/${threadId}/artifacts`)
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_PNG)
      .expect(200);

    await createMessageWithImage(threadId, uploadRes.body.url, adminUserId);

    const unauthAgent = await createApiAgent();
    await unauthAgent.get(uploadRes.body.url).expect(401);
  });

  it('returns 404 when another user requests a private artifact', async () => {
    const threadId = await createOwnedThread(adminUserId);
    const uploadRes = await agent
      .post(`/api/chat/threads/${threadId}/artifacts`)
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_PNG)
      .expect(200);

    await createMessageWithImage(threadId, uploadRes.body.url, adminUserId);

    await seedTestUser(TEST_STANDARD);
    const otherAgent = await createApiAgent();
    await loginAgent(
      otherAgent,
      TEST_STANDARD.userName,
      TEST_STANDARD.password
    );

    await otherAgent.get(uploadRes.body.url).expect(404);
  });

  it('serves public branding artifacts without authentication', async () => {
    const uploadRes = await agent
      .put('/api/settings/branding/logo')
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_PNG)
      .expect(200);

    expect(uploadRes.body.logoUrl).toBe('/api/settings/branding/logo');

    const unauthAgent = await createApiAgent();
    const res = await unauthAgent.get(uploadRes.body.logoUrl).expect(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('returns 404 for nonexistent artifact', async () => {
    const threadId = await createOwnedThread(adminUserId);
    await agent
      .get(`/api/chat/threads/${threadId}/artifacts/nonexistent.png`)
      .expect(404);
  });

  it('rejects path traversal attempt', async () => {
    const threadId = await createOwnedThread(adminUserId);
    await agent
      .get(`/api/chat/threads/${threadId}/artifacts/..%2F..%2Fetc%2Fpasswd`)
      .expect(400);
  });
});
