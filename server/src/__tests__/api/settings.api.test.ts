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
  await seedTestUser({
    userName: 'admin',
    password: 'password123',
    email: 'admin@test.com',
    userRole: 'admin'
  });
  await seedTestUser({
    userName: 'standard',
    password: 'password123',
    email: 'standard@test.com',
    userRole: 'standard'
  });
  await loginAgent(adminAgent, 'admin', 'password123');
  await loginAgent(standardAgent, 'standard', 'password123');
});

// ---------------------------------------------------------------------------
// GET /api/settings/cleanup-status (admin only)
// ---------------------------------------------------------------------------
describe('GET /api/settings/cleanup-status', () => {
  it('returns cleanup status for admin', async () => {
    const res = await adminAgent
      .get('/api/settings/cleanup-status')
      .expect(200);
    expect(res.body).toHaveProperty('cleaning');
    expect(res.body).toHaveProperty('totalSizeBytes');
    expect(typeof res.body.cleaning).toBe('boolean');
    expect(typeof res.body.totalSizeBytes).toBe('number');
  });

  it('returns 403 for standard user', async () => {
    await standardAgent.get('/api/settings/cleanup-status').expect(403);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent.get('/api/settings/cleanup-status').expect(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/settings/cleanup (admin only)
// ---------------------------------------------------------------------------
describe('POST /api/settings/cleanup', () => {
  it('starts cleanup for admin', async () => {
    const res = await adminAgent.post('/api/settings/cleanup').expect(200);
    expect(res.body).toEqual({ success: true });
  });

  it('returns 403 for standard user', async () => {
    await standardAgent.post('/api/settings/cleanup').expect(403);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent.post('/api/settings/cleanup').expect(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/settings/models
// ---------------------------------------------------------------------------
describe('GET /api/settings/models', () => {
  it('returns models for authenticated user', async () => {
    const res = await adminAgent.get('/api/settings/models').expect(200);
    expect(res.body).toHaveProperty('activeId');
    expect(res.body).toHaveProperty('models');
    expect(Array.isArray(res.body.models)).toBe(true);
  });

  it('returns models for standard user', async () => {
    const res = await standardAgent.get('/api/settings/models').expect(200);
    expect(res.body).toHaveProperty('models');
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent.get('/api/settings/models').expect(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/models/active
// ---------------------------------------------------------------------------
describe('PATCH /api/settings/models/active', () => {
  it('sets active model for user', async () => {
    const res = await standardAgent
      .patch('/api/settings/models/active')
      .send({ activeId: 'some-model-id' })
      .expect(200);
    expect(res.body).toEqual({ success: true });
  });

  it('persists the active model selection', async () => {
    await standardAgent
      .patch('/api/settings/models/active')
      .send({ activeId: 'my-model' })
      .expect(200);

    const res = await standardAgent.get('/api/settings/models').expect(200);
    expect(res.body.activeId).toBe('my-model');
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .patch('/api/settings/models/active')
      .send({ activeId: 'x' })
      .expect(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/settings/users (admin only)
// ---------------------------------------------------------------------------
describe('GET /api/settings/users', () => {
  it('returns user list for admin', async () => {
    const res = await adminAgent.get('/api/settings/users').expect(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.length).toBe(2);

    const userNames = res.body.users.map(
      (u: { userName: string }) => u.userName
    );
    expect(userNames).toContain('admin');
    expect(userNames).toContain('standard');
  });

  it('returns 403 for standard user', async () => {
    await standardAgent.get('/api/settings/users').expect(403);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent.get('/api/settings/users').expect(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/settings/users/:id (admin only)
// ---------------------------------------------------------------------------
describe('DELETE /api/settings/users/:id', () => {
  it('deletes a user', async () => {
    // Find the standard user's id
    const listRes = await adminAgent.get('/api/settings/users').expect(200);
    const standardUser = listRes.body.users.find(
      (u: { userName: string }) => u.userName === 'standard'
    );

    const res = await adminAgent
      .delete(`/api/settings/users/${standardUser.id}`)
      .expect(200);
    expect(res.body).toEqual({ success: true });

    // Verify user was deleted
    const afterRes = await adminAgent.get('/api/settings/users').expect(200);
    expect(afterRes.body.users.length).toBe(1);
  });

  it('returns 400 when deleting yourself', async () => {
    const listRes = await adminAgent.get('/api/settings/users').expect(200);
    const adminUser = listRes.body.users.find(
      (u: { userName: string }) => u.userName === 'admin'
    );

    await adminAgent.delete(`/api/settings/users/${adminUser.id}`).expect(400);
  });

  it('returns 404 for nonexistent user', async () => {
    await adminAgent
      .delete('/api/settings/users/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });

  it('returns 403 for standard user', async () => {
    await standardAgent
      .delete('/api/settings/users/00000000-0000-0000-0000-000000000000')
      .expect(403);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .delete('/api/settings/users/00000000-0000-0000-0000-000000000000')
      .expect(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/settings/invitation-codes (admin only)
// ---------------------------------------------------------------------------
describe('GET /api/settings/invitation-codes', () => {
  it('returns empty list initially', async () => {
    const res = await adminAgent
      .get('/api/settings/invitation-codes')
      .expect(200);
    expect(res.body).toEqual({ codes: [] });
  });

  it('returns 403 for standard user', async () => {
    await standardAgent.get('/api/settings/invitation-codes').expect(403);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent.get('/api/settings/invitation-codes').expect(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/settings/invitation-codes (admin only)
// ---------------------------------------------------------------------------
describe('POST /api/settings/invitation-codes', () => {
  it('creates an invitation code with standard role', async () => {
    const res = await adminAgent
      .post('/api/settings/invitation-codes')
      .send({ userRole: 'standard' })
      .expect(200);

    expect(res.body.code).toBeDefined();
    expect(res.body.code.userRole).toBe('standard');
    expect(res.body.code.id).toBeDefined();
  });

  it('creates an invitation code with admin role', async () => {
    const res = await adminAgent
      .post('/api/settings/invitation-codes')
      .send({ userRole: 'admin' })
      .expect(200);

    expect(res.body.code.userRole).toBe('admin');
  });

  it('appears in the invitation code list', async () => {
    await adminAgent
      .post('/api/settings/invitation-codes')
      .send({ userRole: 'standard' })
      .expect(200);

    const listRes = await adminAgent
      .get('/api/settings/invitation-codes')
      .expect(200);
    expect(listRes.body.codes.length).toBe(1);
  });

  it('returns 400 for invalid userRole', async () => {
    await adminAgent
      .post('/api/settings/invitation-codes')
      .send({ userRole: 'superadmin' })
      .expect(400);
  });

  it('returns 400 for missing userRole', async () => {
    await adminAgent
      .post('/api/settings/invitation-codes')
      .send({})
      .expect(400);
  });

  it('returns 403 for standard user', async () => {
    await standardAgent
      .post('/api/settings/invitation-codes')
      .send({ userRole: 'standard' })
      .expect(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/settings/invitation-codes/:id (admin only)
// ---------------------------------------------------------------------------
describe('DELETE /api/settings/invitation-codes/:id', () => {
  it('deletes an invitation code', async () => {
    const createRes = await adminAgent
      .post('/api/settings/invitation-codes')
      .send({ userRole: 'standard' })
      .expect(200);

    const res = await adminAgent
      .delete(`/api/settings/invitation-codes/${createRes.body.code.id}`)
      .expect(200);
    expect(res.body).toEqual({ success: true });

    // Verify it's gone
    const listRes = await adminAgent
      .get('/api/settings/invitation-codes')
      .expect(200);
    expect(listRes.body.codes.length).toBe(0);
  });

  it('returns 404 for nonexistent code', async () => {
    await adminAgent
      .delete(
        '/api/settings/invitation-codes/00000000-0000-0000-0000-000000000000'
      )
      .expect(404);
  });

  it('returns 403 for standard user', async () => {
    await standardAgent
      .delete(
        '/api/settings/invitation-codes/00000000-0000-0000-0000-000000000000'
      )
      .expect(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/settings/tool-approval-rules
// ---------------------------------------------------------------------------
describe('GET /api/settings/tool-approval-rules', () => {
  it('returns empty list initially', async () => {
    const res = await standardAgent
      .get('/api/settings/tool-approval-rules')
      .expect(200);
    expect(res.body).toEqual({ rules: [] });
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent.get('/api/settings/tool-approval-rules').expect(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/settings/tool-approval-rules
// ---------------------------------------------------------------------------
describe('POST /api/settings/tool-approval-rules', () => {
  it('creates a tool approval rule with auto_approve', async () => {
    const res = await standardAgent
      .post('/api/settings/tool-approval-rules')
      .send({ toolName: 'my-tool', approve: 'auto_approve' })
      .expect(200);

    expect(res.body.rule).toBeDefined();
    expect(res.body.rule.toolName).toBe('my-tool');
    expect(res.body.rule.approve).toBe('auto_approve');
  });

  it('creates a rule with manual approval', async () => {
    const res = await standardAgent
      .post('/api/settings/tool-approval-rules')
      .send({ toolName: 'tool-b', approve: 'manual' })
      .expect(200);

    expect(res.body.rule.approve).toBe('manual');
  });

  it('creates a rule with banned status', async () => {
    const res = await standardAgent
      .post('/api/settings/tool-approval-rules')
      .send({ toolName: 'tool-c', approve: 'banned' })
      .expect(200);

    expect(res.body.rule.approve).toBe('banned');
  });

  it('upserts existing rule when same toolName is posted', async () => {
    await standardAgent
      .post('/api/settings/tool-approval-rules')
      .send({ toolName: 'upsert-tool', approve: 'manual' })
      .expect(200);

    const res = await standardAgent
      .post('/api/settings/tool-approval-rules')
      .send({ toolName: 'upsert-tool', approve: 'banned' })
      .expect(200);

    expect(res.body.rule.approve).toBe('banned');

    // Verify only one rule exists for this tool
    const listRes = await standardAgent
      .get('/api/settings/tool-approval-rules')
      .expect(200);
    const matching = listRes.body.rules.filter(
      (r: { toolName: string }) => r.toolName === 'upsert-tool'
    );
    expect(matching.length).toBe(1);
  });

  it('returns 400 for invalid approve value', async () => {
    await standardAgent
      .post('/api/settings/tool-approval-rules')
      .send({ toolName: 'tool', approve: 'invalid' })
      .expect(400);
  });

  it('returns 400 for missing toolName', async () => {
    await standardAgent
      .post('/api/settings/tool-approval-rules')
      .send({ approve: 'manual' })
      .expect(400);
  });

  it('returns 400 for missing approve', async () => {
    await standardAgent
      .post('/api/settings/tool-approval-rules')
      .send({ toolName: 'tool' })
      .expect(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/settings/tool-approval-rules/:id
// ---------------------------------------------------------------------------
describe('DELETE /api/settings/tool-approval-rules/:id', () => {
  it('deletes a tool approval rule', async () => {
    const createRes = await standardAgent
      .post('/api/settings/tool-approval-rules')
      .send({ toolName: 'delete-me', approve: 'manual' })
      .expect(200);

    const res = await standardAgent
      .delete(`/api/settings/tool-approval-rules/${createRes.body.rule.id}`)
      .expect(200);
    expect(res.body).toEqual({ success: true });

    // Verify it's gone
    const listRes = await standardAgent
      .get('/api/settings/tool-approval-rules')
      .expect(200);
    expect(listRes.body.rules.length).toBe(0);
  });

  it('returns 404 for nonexistent rule', async () => {
    await standardAgent
      .delete(
        '/api/settings/tool-approval-rules/00000000-0000-0000-0000-000000000000'
      )
      .expect(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/settings/tool-approval-rules/bulk
// ---------------------------------------------------------------------------
describe('PUT /api/settings/tool-approval-rules/bulk', () => {
  it('bulk creates rules for multiple tools', async () => {
    const res = await standardAgent
      .put('/api/settings/tool-approval-rules/bulk')
      .send({ toolNames: ['tool-a', 'tool-b', 'tool-c'], approve: 'banned' })
      .expect(200);

    expect(Array.isArray(res.body.rules)).toBe(true);
    expect(res.body.rules.length).toBe(3);
  });

  it('bulk updates existing rules', async () => {
    // Create initial rules
    await standardAgent
      .put('/api/settings/tool-approval-rules/bulk')
      .send({
        toolNames: ['bulk-tool-1', 'bulk-tool-2'],
        approve: 'manual'
      })
      .expect(200);

    // Update them
    const res = await standardAgent
      .put('/api/settings/tool-approval-rules/bulk')
      .send({
        toolNames: ['bulk-tool-1', 'bulk-tool-2'],
        approve: 'auto_approve'
      })
      .expect(200);

    const rules = res.body.rules.filter((r: { toolName: string }) =>
      ['bulk-tool-1', 'bulk-tool-2'].includes(r.toolName)
    );
    for (const rule of rules) {
      expect(rule.approve).toBe('auto_approve');
    }
  });

  it('returns 400 for invalid approve value', async () => {
    await standardAgent
      .put('/api/settings/tool-approval-rules/bulk')
      .send({ toolNames: ['tool'], approve: 'invalid' })
      .expect(400);
  });

  it('returns 400 for non-array toolNames', async () => {
    await standardAgent
      .put('/api/settings/tool-approval-rules/bulk')
      .send({ toolNames: 'not-array', approve: 'manual' })
      .expect(400);
  });

  it('returns 400 for missing toolNames', async () => {
    await standardAgent
      .put('/api/settings/tool-approval-rules/bulk')
      .send({ approve: 'manual' })
      .expect(400);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .put('/api/settings/tool-approval-rules/bulk')
      .send({ toolNames: ['t'], approve: 'manual' })
      .expect(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/settings/profile
// ---------------------------------------------------------------------------
describe('GET /api/settings/profile', () => {
  it('returns profile for authenticated user', async () => {
    const res = await standardAgent.get('/api/settings/profile').expect(200);

    expect(res.body).toEqual({
      fullName: 'Test User',
      userName: 'standard',
      email: 'standard@test.com'
    });
  });

  it('returns profile for admin user', async () => {
    const res = await adminAgent.get('/api/settings/profile').expect(200);

    expect(res.body.userName).toBe('admin');
    expect(res.body.email).toBe('admin@test.com');
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent.get('/api/settings/profile').expect(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/profile
// ---------------------------------------------------------------------------
describe('PATCH /api/settings/profile', () => {
  it('updates full name', async () => {
    const res = await standardAgent
      .patch('/api/settings/profile')
      .send({ fullName: 'New Name' })
      .expect(200);
    expect(res.body).toEqual({ success: true });

    // Verify change
    const profileRes = await standardAgent
      .get('/api/settings/profile')
      .expect(200);
    expect(profileRes.body.fullName).toBe('New Name');
  });

  it('updates user name', async () => {
    await standardAgent
      .patch('/api/settings/profile')
      .send({ userName: 'newname' })
      .expect(200);

    const profileRes = await standardAgent
      .get('/api/settings/profile')
      .expect(200);
    expect(profileRes.body.userName).toBe('newname');
  });

  it('updates email', async () => {
    await standardAgent
      .patch('/api/settings/profile')
      .send({ email: 'new@test.com' })
      .expect(200);

    const profileRes = await standardAgent
      .get('/api/settings/profile')
      .expect(200);
    expect(profileRes.body.email).toBe('new@test.com');
  });

  it('returns 409 for duplicate user name', async () => {
    await standardAgent
      .patch('/api/settings/profile')
      .send({ userName: 'admin' })
      .expect(409);
  });

  it('returns 409 for duplicate email', async () => {
    await standardAgent
      .patch('/api/settings/profile')
      .send({ email: 'admin@test.com' })
      .expect(409);
  });

  it('returns 400 for invalid user name', async () => {
    await standardAgent
      .patch('/api/settings/profile')
      .send({ userName: 'bad user name!' })
      .expect(400);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .patch('/api/settings/profile')
      .send({ fullName: 'x' })
      .expect(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/profile/password
// ---------------------------------------------------------------------------
describe('PATCH /api/settings/profile/password', () => {
  it('changes password successfully', async () => {
    // New password must satisfy: 8+ chars, uppercase, lowercase, number, symbol
    const res = await standardAgent
      .patch('/api/settings/profile/password')
      .send({ currentPassword: 'password123', newPassword: 'NewPass1!' })
      .expect(200);
    expect(res.body).toEqual({ success: true });
  });

  it('can login with the new password after change', async () => {
    await standardAgent
      .patch('/api/settings/profile/password')
      .send({ currentPassword: 'password123', newPassword: 'NewPass1!' })
      .expect(200);

    // Login with new password
    const freshAgent = await createApiAgent();
    await loginAgent(freshAgent, 'standard', 'NewPass1!');
    const profileRes = await freshAgent
      .get('/api/settings/profile')
      .expect(200);
    expect(profileRes.body.userName).toBe('standard');
  });

  it('returns 400 for wrong current password', async () => {
    await standardAgent
      .patch('/api/settings/profile/password')
      .send({ currentPassword: 'wrongpassword', newPassword: 'NewPass1!' })
      .expect(400);
  });

  it('returns 400 for weak new password', async () => {
    await standardAgent
      .patch('/api/settings/profile/password')
      .send({ currentPassword: 'password123', newPassword: 'short' })
      .expect(400);
  });

  it('returns 400 for missing current password', async () => {
    await standardAgent
      .patch('/api/settings/profile/password')
      .send({ currentPassword: '', newPassword: 'NewPass1!' })
      .expect(400);
  });

  it('returns 400 for missing new password', async () => {
    await standardAgent
      .patch('/api/settings/profile/password')
      .send({ currentPassword: 'password123', newPassword: '' })
      .expect(400);
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .patch('/api/settings/profile/password')
      .send({ currentPassword: 'x', newPassword: 'y' })
      .expect(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/settings/preferences
// ---------------------------------------------------------------------------
describe('GET /api/settings/preferences', () => {
  it('returns empty preferences initially', async () => {
    const res = await standardAgent
      .get('/api/settings/preferences')
      .expect(200);
    // Preferences may be empty or have undefined fields
    expect(res.body).toBeDefined();
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent.get('/api/settings/preferences').expect(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/preferences
// ---------------------------------------------------------------------------
describe('PATCH /api/settings/preferences', () => {
  it('updates language preference', async () => {
    const res = await standardAgent
      .patch('/api/settings/preferences')
      .send({ language: 'ja' })
      .expect(200);
    expect(res.body).toEqual({ success: true });

    // Verify change
    const prefsRes = await standardAgent
      .get('/api/settings/preferences')
      .expect(200);
    expect(prefsRes.body.language).toBe('ja');
  });

  it('updates theme preference', async () => {
    await standardAgent
      .patch('/api/settings/preferences')
      .send({ theme: 'dark' })
      .expect(200);

    const prefsRes = await standardAgent
      .get('/api/settings/preferences')
      .expect(200);
    expect(prefsRes.body.theme).toBe('dark');
  });

  it('updates both language and theme', async () => {
    await standardAgent
      .patch('/api/settings/preferences')
      .send({ language: 'en', theme: 'light' })
      .expect(200);

    const prefsRes = await standardAgent
      .get('/api/settings/preferences')
      .expect(200);
    expect(prefsRes.body.language).toBe('en');
    expect(prefsRes.body.theme).toBe('light');
  });

  it('does not overwrite existing preference when updating only one', async () => {
    // Set both
    await standardAgent
      .patch('/api/settings/preferences')
      .send({ language: 'fr', theme: 'dark' })
      .expect(200);

    // Update only theme
    await standardAgent
      .patch('/api/settings/preferences')
      .send({ theme: 'light' })
      .expect(200);

    // Language should still be fr
    const prefsRes = await standardAgent
      .get('/api/settings/preferences')
      .expect(200);
    expect(prefsRes.body.language).toBe('fr');
    expect(prefsRes.body.theme).toBe('light');
  });

  it('returns 401 for unauthenticated request', async () => {
    const unauthAgent = await createApiAgent();
    await unauthAgent
      .patch('/api/settings/preferences')
      .send({ language: 'en' })
      .expect(401);
  });
});
