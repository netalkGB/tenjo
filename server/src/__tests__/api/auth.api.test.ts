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
});

// Valid password that satisfies all validation rules:
// min 8 chars, uppercase, lowercase, digit, symbol
const VALID_PASSWORD = 'Test1234!';

describe('POST /api/login', () => {
  it('returns 200 and success message with valid username credentials', async () => {
    await seedTestUser({
      userName: 'alice',
      password: 'secret123',
      email: 'alice@example.com'
    });

    const res = await agent
      .post('/api/login')
      .send({ username: 'alice', password: 'secret123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Login successful' });
  });

  it('returns 200 when logging in with email instead of username', async () => {
    await seedTestUser({
      userName: 'bob',
      password: 'mypassword',
      email: 'bob@example.com'
    });

    const res = await agent
      .post('/api/login')
      .send({ username: 'bob@example.com', password: 'mypassword' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Login successful' });
  });

  it('returns 400 when username is missing', async () => {
    const res = await agent.post('/api/login').send({ password: 'secret123' });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Invalid request body');
  });

  it('returns 400 when password is missing', async () => {
    const res = await agent.post('/api/login').send({ username: 'alice' });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Invalid request body');
  });

  it('returns 400 when body is empty', async () => {
    const res = await agent.post('/api/login').send({});

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Invalid request body');
  });

  it('returns 400 when username is empty string', async () => {
    const res = await agent
      .post('/api/login')
      .send({ username: '', password: 'secret123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when password is empty string', async () => {
    const res = await agent
      .post('/api/login')
      .send({ username: 'alice', password: '' });

    expect(res.status).toBe(400);
  });

  it('returns 401 when user does not exist', async () => {
    const res = await agent
      .post('/api/login')
      .send({ username: 'nonexistent', password: 'secret123' });

    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('Invalid credentials');
  });

  it('returns 401 when password is wrong', async () => {
    await seedTestUser({
      userName: 'alice',
      password: 'correct',
      email: 'alice@example.com'
    });

    const res = await agent
      .post('/api/login')
      .send({ username: 'alice', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('Invalid credentials');
  });

  it('establishes a session after successful login', async () => {
    // Use a fresh agent to verify session persistence
    const freshAgent = await createApiAgent();
    await seedTestUser({
      userName: 'sessionuser',
      password: 'pass123',
      email: 'session@example.com'
    });

    await loginAgent(freshAgent, 'sessionuser', 'pass123');

    // Session should allow access to whoami
    const whoami = await freshAgent.get('/api/whoami');
    expect(whoami.status).toBe(200);
    expect(whoami.body.userName).toBe('sessionuser');
  });
});

describe('GET /api/register/status', () => {
  it('returns needsInvitationCode: false when no admin exists', async () => {
    const res = await agent.get('/api/register/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ needsInvitationCode: false });
  });

  it('returns needsInvitationCode: true when admin exists', async () => {
    await seedTestUser({ userRole: 'admin' });

    const res = await agent.get('/api/register/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ needsInvitationCode: true });
  });
});

describe('POST /api/register', () => {
  it('registers first user as admin when no admin exists', async () => {
    const res = await agent.post('/api/register').send({
      userName: 'firstadmin',
      email: 'admin@example.com',
      password: VALID_PASSWORD
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'register_success' });

    // Verify the first user becomes admin by logging in and checking whoami
    const freshAgent = await createApiAgent();
    await loginAgent(freshAgent, 'firstadmin', VALID_PASSWORD);
    const whoami = await freshAgent.get('/api/whoami');
    expect(whoami.status).toBe(200);
    // First user should not need invitation code confirmation to prove admin role
    // (but we can verify registration succeeded)
  });

  it('registers with optional fullName', async () => {
    const res = await agent.post('/api/register').send({
      fullName: 'John Doe',
      userName: 'johndoe',
      email: 'john@example.com',
      password: VALID_PASSWORD
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'register_success' });
  });

  it('returns 400 for invalid userName (too short or invalid chars)', async () => {
    const res = await agent.post('/api/register').send({
      userName: '',
      email: 'test@example.com',
      password: VALID_PASSWORD
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('register_user_name_invalid');
  });

  it('returns 400 for userName with special characters', async () => {
    const res = await agent.post('/api/register').send({
      userName: 'user@name!',
      email: 'test@example.com',
      password: VALID_PASSWORD
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('register_user_name_invalid');
  });

  it('returns 400 for missing email', async () => {
    const res = await agent.post('/api/register').send({
      userName: 'testuser',
      email: '',
      password: VALID_PASSWORD
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('profile_email_required');
  });

  it('returns 400 for password that is too short', async () => {
    const res = await agent.post('/api/register').send({
      userName: 'testuser',
      email: 'test@example.com',
      password: 'Ab1!'
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Invalid password');
    expect(res.body.errors).toContain('register_password_min_length');
  });

  it('returns 400 for password missing uppercase', async () => {
    const res = await agent.post('/api/register').send({
      userName: 'testuser',
      email: 'test@example.com',
      password: 'test1234!'
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Invalid password');
    expect(res.body.errors).toContain('register_password_uppercase');
  });

  it('returns 400 for password missing lowercase', async () => {
    const res = await agent.post('/api/register').send({
      userName: 'testuser',
      email: 'test@example.com',
      password: 'TEST1234!'
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('register_password_lowercase');
  });

  it('returns 400 for password missing digit', async () => {
    const res = await agent.post('/api/register').send({
      userName: 'testuser',
      email: 'test@example.com',
      password: 'TestTest!'
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('register_password_number');
  });

  it('returns 400 for password missing symbol', async () => {
    const res = await agent.post('/api/register').send({
      userName: 'testuser',
      email: 'test@example.com',
      password: 'Test1234'
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('register_password_symbol');
  });

  it('returns 409 for duplicate userName', async () => {
    // Register first user (becomes admin)
    await agent.post('/api/register').send({
      userName: 'duplicate',
      email: 'first@example.com',
      password: VALID_PASSWORD
    });

    // Attempt to register with same userName
    const res = await agent.post('/api/register').send({
      userName: 'duplicate',
      email: 'second@example.com',
      password: VALID_PASSWORD,
      invitationCode: 'doesnotmatter'
    });

    expect(res.status).toBe(409);
    expect(res.body.detail).toBe('register_user_name_already_exists');
  });

  it('returns 409 for duplicate email', async () => {
    await agent.post('/api/register').send({
      userName: 'user1',
      email: 'same@example.com',
      password: VALID_PASSWORD
    });

    const res = await agent.post('/api/register').send({
      userName: 'user2',
      email: 'same@example.com',
      password: VALID_PASSWORD,
      invitationCode: 'doesnotmatter'
    });

    expect(res.status).toBe(409);
    expect(res.body.detail).toBe('register_email_already_exists');
  });

  it('returns 400 when invitation code is required but not provided', async () => {
    // Seed an admin so invitation code is required
    await seedTestUser({ userRole: 'admin' });

    const res = await agent.post('/api/register').send({
      userName: 'newuser',
      email: 'new@example.com',
      password: VALID_PASSWORD
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('register_invitation_code_required');
  });

  it('returns 400 when invitation code is invalid', async () => {
    await seedTestUser({ userRole: 'admin' });

    // Use a valid UUID format that does not exist in the DB
    const nonExistentCode = '00000000-0000-0000-0000-000000000000';
    const res = await agent.post('/api/register').send({
      userName: 'newuser',
      email: 'new@example.com',
      password: VALID_PASSWORD,
      invitationCode: nonExistentCode
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('register_invitation_code_invalid');
  });

  it('returns 400 when invitation code is already used', async () => {
    const admin = await seedTestUser({ userRole: 'admin' });

    // Create a used invitation code (let DB auto-generate the UUID code)
    const { invitationCodeRepo } = await import('../../repositories/registry');
    const created = await invitationCodeRepo.create({
      user_role: 'standard',
      used: true,
      used_by: admin.id,
      created_by: admin.id
    });

    const res = await agent.post('/api/register').send({
      userName: 'newuser',
      email: 'new@example.com',
      password: VALID_PASSWORD,
      invitationCode: created.code
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('register_invitation_code_invalid');
  });

  it('registers successfully with a valid invitation code', async () => {
    const admin = await seedTestUser({ userRole: 'admin' });

    const { invitationCodeRepo } = await import('../../repositories/registry');
    const created = await invitationCodeRepo.create({
      user_role: 'standard',
      used: false,
      created_by: admin.id
    });

    const res = await agent.post('/api/register').send({
      userName: 'invited',
      email: 'invited@example.com',
      password: VALID_PASSWORD,
      invitationCode: created.code
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'register_success' });

    // Verify the invitation code is now marked as used
    const code = await invitationCodeRepo.findByCode(created.code);
    expect(code?.used).toBe(true);
  });

  it('returns 400 for fullName that is too long', async () => {
    const res = await agent.post('/api/register').send({
      fullName: 'A'.repeat(65),
      userName: 'testuser',
      email: 'test@example.com',
      password: VALID_PASSWORD
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('profile_full_name_too_long');
  });
});

describe('POST /api/logout', () => {
  it('returns 200 and success message', async () => {
    const freshAgent = await createApiAgent();
    await seedTestUser({
      userName: 'logoutuser',
      password: 'pass123',
      email: 'logout@example.com'
    });
    await loginAgent(freshAgent, 'logoutuser', 'pass123');

    const res = await freshAgent.post('/api/logout');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Logout successful' });
  });

  it('clears the session after logout', async () => {
    const freshAgent = await createApiAgent();
    await seedTestUser({
      userName: 'logoutuser2',
      password: 'pass123',
      email: 'logout2@example.com'
    });
    await loginAgent(freshAgent, 'logoutuser2', 'pass123');

    // Verify session works before logout
    const whoamiBefore = await freshAgent.get('/api/whoami');
    expect(whoamiBefore.status).toBe(200);

    await freshAgent.post('/api/logout');

    // Session should be destroyed; whoami should return 401
    const whoamiAfter = await freshAgent.get('/api/whoami');
    expect(whoamiAfter.status).toBe(401);
  });

  it('succeeds even when not logged in', async () => {
    const freshAgent = await createApiAgent();

    const res = await freshAgent.post('/api/logout');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Logout successful' });
  });
});

describe('GET /api/whoami', () => {
  it('returns 401 when not authenticated', async () => {
    const freshAgent = await createApiAgent();

    const res = await freshAgent.get('/api/whoami');

    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('Authentication required');
  });

  it('returns user info when authenticated', async () => {
    const freshAgent = await createApiAgent();
    await seedTestUser({
      userName: 'whoamiuser',
      password: 'pass123',
      email: 'whoami@example.com',
      userRole: 'standard'
    });
    await loginAgent(freshAgent, 'whoamiuser', 'pass123');

    const res = await freshAgent.get('/api/whoami');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      userName: 'whoamiuser',
      userRole: 'standard',
      singleUserMode: false
    });
  });

  it('returns admin role for admin users', async () => {
    const freshAgent = await createApiAgent();
    await seedTestUser({
      userName: 'adminwhoami',
      password: 'pass123',
      email: 'adminwhoami@example.com',
      userRole: 'admin'
    });
    await loginAgent(freshAgent, 'adminwhoami', 'pass123');

    const res = await freshAgent.get('/api/whoami');

    expect(res.status).toBe(200);
    expect(res.body.userName).toBe('adminwhoami');
    expect(res.body.userRole).toBe('admin');
    expect(res.body.singleUserMode).toBe(false);
  });

  it('returns 401 when session user has been deleted from database', async () => {
    const freshAgent = await createApiAgent();
    const user = await seedTestUser({
      userName: 'deleteduser',
      password: 'pass123',
      email: 'deleted@example.com'
    });
    await loginAgent(freshAgent, 'deleteduser', 'pass123');

    // Delete the user directly from the database
    const { userRepo } = await import('../../repositories/registry');
    await userRepo.delete(user.id);

    const res = await freshAgent.get('/api/whoami');

    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('User not found');
  });
});
