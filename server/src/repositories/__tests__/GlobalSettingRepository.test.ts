import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GlobalSettingRepository } from '../GlobalSettingRepository';
import { UserRepository } from '../UserRepository';
import { TestDatabaseHelper, getTestDbConfig } from '../../test-utils/testDb';

describe('GlobalSettingRepository (Integration Tests)', () => {
  let testDb: TestDatabaseHelper;
  let globalSettingRepository: GlobalSettingRepository;
  let userRepository: UserRepository;
  let testUserId: string;
  let testUserId2: string;

  beforeAll(async () => {
    const config = getTestDbConfig();
    testDb = new TestDatabaseHelper({
      ...config,
      schemaSuffix: 'global_setting'
    });
    await testDb.connect();
    await testDb.createSchema();
    await testDb.createTables();

    const pool = testDb.getPool();
    globalSettingRepository = new GlobalSettingRepository(pool);
    userRepository = new UserRepository(pool);
  });

  afterAll(async () => {
    await testDb.dropSchema();
    await testDb.disconnect();
  });

  beforeEach(async () => {
    await testDb.cleanTables();

    const user1 = await userRepository.create({
      full_name: 'Test User',
      user_name: 'testuser',
      email: 'test@example.com',
      password: 'test_password'
    });
    testUserId = user1.id;

    const user2 = await userRepository.create({
      full_name: 'Test User 2',
      user_name: 'testuser2',
      email: 'test2@example.com',
      password: 'test_password2'
    });
    testUserId2 = user2.id;
  });

  describe('get', () => {
    it('should return undefined when no settings exist', async () => {
      const result = await globalSettingRepository.get();
      expect(result).toBeUndefined();
    });

    it('should return settings when they exist', async () => {
      await globalSettingRepository.getOrCreate();

      const result = await globalSettingRepository.get();

      expect(result).toBeDefined();
      expect(result?.id).toBeDefined();
      expect(result?.settings).toEqual({});
    });
  });

  describe('getOrCreate', () => {
    it('should create new settings when none exist', async () => {
      const result = await globalSettingRepository.getOrCreate();

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.settings).toEqual({});
    });

    it('should return existing settings without creating a new one', async () => {
      const first = await globalSettingRepository.getOrCreate();
      const second = await globalSettingRepository.getOrCreate();

      expect(first.id).toBe(second.id);
    });
  });

  describe('updateSettings', () => {
    it('should create settings if none exist and update them', async () => {
      const modelSettings = {
        model: {
          activeId: 'model-1',
          models: [
            {
              id: 'model-1',
              type: 'lmstudio',
              baseUrl: 'http://localhost:1234/',
              model: 'test-model',
              token: ''
            }
          ]
        }
      };

      const result = await globalSettingRepository.updateSettings(
        modelSettings,
        testUserId
      );

      expect(result).toBeDefined();
      expect(result.settings).toEqual(modelSettings);
      expect(result.updated_by).toBe(testUserId);
    });

    it('should update existing settings', async () => {
      await globalSettingRepository.getOrCreate();

      const newSettings = { model: { activeId: 'new-model', models: [] } };
      const result = await globalSettingRepository.updateSettings(
        newSettings,
        testUserId
      );

      expect(result.settings).toEqual(newSettings);
      expect(result.updated_by).toBe(testUserId);
    });

    it('should overwrite previous settings completely', async () => {
      await globalSettingRepository.updateSettings(
        { model: { activeId: 'old', models: [] } },
        testUserId
      );

      const result = await globalSettingRepository.updateSettings(
        { mcpServers: {} },
        testUserId2
      );

      expect(result.settings).toEqual({ mcpServers: {} });
      expect(result.updated_by).toBe(testUserId2);
    });
  });
});
