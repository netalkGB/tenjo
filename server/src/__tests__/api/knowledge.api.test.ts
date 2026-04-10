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

describe('GET /api/knowledge', () => {
  it('returns empty list initially', async () => {
    const res = await agent.get('/api/knowledge').expect(200);
    expect(res.body.entries).toEqual([]);
    expect(res.body.totalCount).toBe(0);
  });

  it('returns paginated knowledge entries', async () => {
    // Create multiple entries
    for (let i = 0; i < 3; i++) {
      await agent
        .post('/api/knowledge')
        .send({ name: `entry-${i}`, content: `content ${i}` })
        .expect(201);
    }

    const res = await agent
      .get('/api/knowledge')
      .query({ pageSize: '2', pageNumber: '1' })
      .expect(200);

    expect(res.body.entries).toHaveLength(2);
    expect(res.body.totalCount).toBe(3);
    expect(res.body.totalPages).toBe(2);
  });

  it('supports search', async () => {
    await agent
      .post('/api/knowledge')
      .send({ name: 'alpha', content: 'hello' })
      .expect(201);
    await agent
      .post('/api/knowledge')
      .send({ name: 'beta', content: 'world' })
      .expect(201);

    const res = await agent
      .get('/api/knowledge')
      .query({ search: 'alpha' })
      .expect(200);

    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].name).toBe('alpha.txt');
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent.get('/api/knowledge').expect(401);
  });
});

describe('GET /api/knowledge/:id/content', () => {
  it('returns the content of a knowledge entry', async () => {
    const createRes = await agent
      .post('/api/knowledge')
      .send({ name: 'test-entry', content: 'test content body' })
      .expect(201);

    const res = await agent
      .get(`/api/knowledge/${createRes.body.id}/content`)
      .expect(200);

    expect(res.body.content).toBe('test content body');
  });

  it('returns 404 for nonexistent entry', async () => {
    await agent
      .get('/api/knowledge/00000000-0000-0000-0000-000000000000/content')
      .expect(404);
  });

  it('returns 404 for another user entry', async () => {
    const createRes = await agent
      .post('/api/knowledge')
      .send({ name: 'private', content: 'secret' })
      .expect(201);

    // Login as different user
    await seedTestUser({
      userName: 'other',
      password: 'password123',
      email: 'other@test.com'
    });
    const otherAgent = await createApiAgent();
    await loginAgent(otherAgent, 'other', 'password123');

    await otherAgent
      .get(`/api/knowledge/${createRes.body.id}/content`)
      .expect(404);
  });
});

describe('POST /api/knowledge', () => {
  it('creates a knowledge entry', async () => {
    const res = await agent
      .post('/api/knowledge')
      .send({ name: 'my-entry', content: 'some content' })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('my-entry.txt');
  });

  it('adds .txt extension if missing', async () => {
    const res = await agent
      .post('/api/knowledge')
      .send({ name: 'no-ext', content: 'data' })
      .expect(201);

    expect(res.body.name).toBe('no-ext.txt');
  });

  it('preserves .txt extension if already present', async () => {
    const res = await agent
      .post('/api/knowledge')
      .send({ name: 'has-ext.txt', content: 'data' })
      .expect(201);

    expect(res.body.name).toBe('has-ext.txt');
  });

  it('returns 400 for missing name', async () => {
    await agent.post('/api/knowledge').send({ content: 'data' }).expect(400);
  });

  it('returns 400 for missing content', async () => {
    await agent.post('/api/knowledge').send({ name: 'test' }).expect(400);
  });

  it('returns 400 for duplicate name', async () => {
    await agent
      .post('/api/knowledge')
      .send({ name: 'dup', content: 'first' })
      .expect(201);

    await agent
      .post('/api/knowledge')
      .send({ name: 'dup', content: 'second' })
      .expect(400);
  });
});

describe('POST /api/knowledge/upload', () => {
  it('uploads a file as raw binary', async () => {
    const content = Buffer.from('uploaded file content');
    const res = await agent
      .post('/api/knowledge/upload')
      .set('x-filename', encodeURIComponent('uploaded.txt'))
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('uploaded.txt');
  });

  it('returns 400 when x-filename header is missing', async () => {
    const content = Buffer.from('data');
    await agent
      .post('/api/knowledge/upload')
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(400);
  });
});

describe('PUT /api/knowledge/:id', () => {
  it('updates a knowledge entry', async () => {
    const createRes = await agent
      .post('/api/knowledge')
      .send({ name: 'original', content: 'old content' })
      .expect(201);

    const res = await agent
      .put(`/api/knowledge/${createRes.body.id}`)
      .send({ name: 'updated', content: 'new content' })
      .expect(200);

    expect(res.body.name).toBe('updated.txt');

    // Verify content was updated
    const contentRes = await agent
      .get(`/api/knowledge/${createRes.body.id}/content`)
      .expect(200);
    expect(contentRes.body.content).toBe('new content');
  });

  it('returns 404 for nonexistent entry', async () => {
    await agent
      .put('/api/knowledge/00000000-0000-0000-0000-000000000000')
      .send({ name: 'test', content: 'data' })
      .expect(404);
  });

  it('returns 400 for invalid body', async () => {
    const createRes = await agent
      .post('/api/knowledge')
      .send({ name: 'test', content: 'data' })
      .expect(201);

    await agent
      .put(`/api/knowledge/${createRes.body.id}`)
      .send({ name: '', content: 'data' })
      .expect(400);
  });
});

describe('DELETE /api/knowledge/:id', () => {
  it('deletes a knowledge entry', async () => {
    const createRes = await agent
      .post('/api/knowledge')
      .send({ name: 'to-delete', content: 'data' })
      .expect(201);

    await agent.delete(`/api/knowledge/${createRes.body.id}`).expect(204);

    // Verify it's gone
    await agent.get(`/api/knowledge/${createRes.body.id}/content`).expect(404);
  });

  it('deletes the artifact file from disk', { timeout: 15000 }, async () => {
    const createRes = await agent
      .post('/api/knowledge')
      .send({ name: 'file-check', content: 'to be removed' })
      .expect(201);

    const fsPath = createRes.body.fs_path as string;
    const filename = path.basename(fsPath);
    const artifactPath = path.join(getDataDir(), 'artifacts', filename);

    // File should exist before deletion
    await expect(fs.access(artifactPath)).resolves.toBeUndefined();

    await agent.delete(`/api/knowledge/${createRes.body.id}`).expect(204);

    // File should be gone after deletion
    await expect(fs.access(artifactPath)).rejects.toThrow();
  });

  it('returns 404 for nonexistent entry', async () => {
    await agent
      .delete('/api/knowledge/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });
});
