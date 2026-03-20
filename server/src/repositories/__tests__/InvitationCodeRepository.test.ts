import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { InvitationCodeRepository } from '../InvitationCodeRepository';
import { UserRepository } from '../UserRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';

describe('InvitationCodeRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let invitationCodeRepository: InvitationCodeRepository;
  let userRepository: UserRepository;
  let testUserId: string;

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({
      ...config,
      schemaSuffix: 'invitation_code'
    });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();

    const pool = testDb.getPool();
    invitationCodeRepository = new InvitationCodeRepository(pool);
    userRepository = new UserRepository(pool);
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();

    const user = await userRepository.create({
      full_name: 'Test User',
      user_name: 'testuser',
      email: 'test@example.com',
      password: 'test_password',
      user_role: 'admin'
    });
    testUserId = user.id;
  });

  describe('create', () => {
    it('should create a new invitation code', async () => {
      const code = await invitationCodeRepository.create({
        created_by: testUserId
      });

      expect(code).toBeDefined();
      expect(code.id).toBeDefined();
      expect(code.code).toBeDefined();
      expect(code.used).toBe(false);
      expect(code.used_by).toBeNull();
      expect(code.user_role).toBe('standard');
    });

    it('should create an invitation code with admin role', async () => {
      const code = await invitationCodeRepository.create({
        user_role: 'admin',
        created_by: testUserId
      });

      expect(code.user_role).toBe('admin');
    });

    it('should auto-generate unique codes', async () => {
      const code1 = await invitationCodeRepository.create({
        created_by: testUserId
      });
      const code2 = await invitationCodeRepository.create({
        created_by: testUserId
      });

      expect(code1.code).not.toBe(code2.code);
    });
  });

  describe('findAll', () => {
    it('should return an empty array when no codes exist', async () => {
      const codes = await invitationCodeRepository.findAll();
      expect(codes).toEqual([]);
    });

    it('should return all invitation codes', async () => {
      await invitationCodeRepository.create({ created_by: testUserId });
      await invitationCodeRepository.create({ created_by: testUserId });

      const codes = await invitationCodeRepository.findAll();
      expect(codes).toHaveLength(2);
    });
  });

  describe('findByCode', () => {
    it('should return undefined when code does not exist', async () => {
      const result = await invitationCodeRepository.findByCode(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(result).toBeUndefined();
    });

    it('should return invitation code when it exists', async () => {
      const created = await invitationCodeRepository.create({
        created_by: testUserId
      });

      const found = await invitationCodeRepository.findByCode(created.code);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.code).toBe(created.code);
    });
  });

  describe('markUsed', () => {
    it('should mark an invitation code as used', async () => {
      const created = await invitationCodeRepository.create({
        created_by: testUserId
      });

      await invitationCodeRepository.markUsed(created.code, testUserId);

      const found = await invitationCodeRepository.findByCode(created.code);
      expect(found?.used).toBe(true);
      expect(found?.used_by).toBe(testUserId);
    });
  });

  describe('delete', () => {
    it('should return false when code does not exist', async () => {
      const result = await invitationCodeRepository.delete(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(result).toBe(false);
    });

    it('should delete code and return true when it exists', async () => {
      const created = await invitationCodeRepository.create({
        created_by: testUserId
      });

      const result = await invitationCodeRepository.delete(created.id);
      expect(result).toBe(true);

      const found = await invitationCodeRepository.findByCode(created.code);
      expect(found).toBeUndefined();
    });
  });
});
