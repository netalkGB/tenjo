import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  setupApiTestSchema,
  teardownApiTestSchema,
  createApiAgent,
  seedTestUser,
  loginAgent,
  cleanAllTables
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

describe('POST /api/upload/image', () => {
  it('uploads a PNG image successfully', async () => {
    const res = await agent
      .post('/api/upload/image')
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_PNG)
      .expect(200);

    expect(res.body.filename).toMatch(/\.png$/);
    expect(res.body.url).toContain('/api/upload/artifacts/');
  });

  it('uploads a JPEG image successfully', async () => {
    const res = await agent
      .post('/api/upload/image')
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_JPEG)
      .expect(200);

    expect(res.body.filename).toMatch(/\.jpg$/);
    expect(res.body.url).toContain('/api/upload/artifacts/');
  });

  it('returns 400 for empty body', async () => {
    await agent
      .post('/api/upload/image')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(0))
      .expect(400);
  });

  it('returns 400 for unsupported file type', async () => {
    const invalidData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    await agent
      .post('/api/upload/image')
      .set('Content-Type', 'application/octet-stream')
      .send(invalidData)
      .expect(400);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .post('/api/upload/image')
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_PNG)
      .expect(401);
  });
});

describe('GET /api/upload/artifacts/:filename', () => {
  it('serves an uploaded artifact', async () => {
    // Upload first
    const uploadRes = await agent
      .post('/api/upload/image')
      .set('Content-Type', 'application/octet-stream')
      .send(VALID_PNG)
      .expect(200);

    // Retrieve artifact (no auth required for artifact serving)
    const res = await agent.get(uploadRes.body.url).expect(200);

    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('returns 404 for nonexistent artifact', async () => {
    await agent.get('/api/upload/artifacts/nonexistent.png').expect(404);
  });

  it('rejects path traversal attempt', async () => {
    // ImageValidationError is not caught by the GET handler (only ImageNotFoundError is),
    // so it falls through to the global error handler as a 500
    await agent.get('/api/upload/artifacts/..%2F..%2Fetc%2Fpasswd').expect(500);
  });
});
