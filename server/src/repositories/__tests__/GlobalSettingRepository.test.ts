import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GlobalSettingRepository } from '../GlobalSettingRepository';
import type { GlobalSettings } from '../GlobalSettingRepository';
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

  describe('getSettings', () => {
    it('should return empty object when no settings exist', async () => {
      const result = await globalSettingRepository.getSettings();
      expect(result).toEqual({});
    });

    it('should return settings when they exist', async () => {
      await globalSettingRepository.getOrCreateSettings();

      const result = await globalSettingRepository.getSettings();
      expect(result).toEqual({});
    });
  });

  describe('getOrCreateSettings', () => {
    it('should create new settings when none exist', async () => {
      const result = await globalSettingRepository.getOrCreateSettings();
      expect(result).toEqual({});
    });

    it('should return existing settings without creating a new one', async () => {
      const first = await globalSettingRepository.getOrCreateSettings();
      const second = await globalSettingRepository.getOrCreateSettings();
      expect(first).toEqual(second);
    });
  });

  describe('updateSettings', () => {
    it('should create settings if none exist and update them', async () => {
      const modelSettings: GlobalSettings = {
        model: {
          activeId: 'model-1',
          models: [
            {
              id: 'model-1',
              type: 'lmstudio',
              baseUrl: 'http://localhost:1234/',
              model: 'test-model'
            }
          ]
        }
      };

      await globalSettingRepository.updateSettings(modelSettings, testUserId);

      const result = await globalSettingRepository.getSettings();
      expect(result).toEqual(modelSettings);
    });

    it('should update existing settings', async () => {
      await globalSettingRepository.getOrCreateSettings();

      const newSettings: GlobalSettings = {
        model: { activeId: 'new-model', models: [] }
      };
      await globalSettingRepository.updateSettings(newSettings, testUserId);

      const result = await globalSettingRepository.getSettings();
      expect(result).toEqual(newSettings);
    });

    it('should overwrite previous settings completely', async () => {
      await globalSettingRepository.updateSettings(
        { model: { activeId: 'old', models: [] } },
        testUserId
      );

      await globalSettingRepository.updateSettings(
        { mcpServers: {} },
        testUserId2
      );

      const result = await globalSettingRepository.getSettings();
      expect(result).toEqual({ mcpServers: {} });
    });

    it('should store and retrieve arbitrary extra keys like cleaning flag', async () => {
      const settingsWithCleaning = { cleaning: true } as GlobalSettings & {
        cleaning: boolean;
      };
      await globalSettingRepository.updateSettings(
        settingsWithCleaning,
        testUserId
      );

      const result = await globalSettingRepository.getSettings();
      expect((result as Record<string, unknown>).cleaning).toBe(true);
    });

    it('should remove cleaning flag when updated without it', async () => {
      await globalSettingRepository.updateSettings(
        { cleaning: true } as GlobalSettings & { cleaning: boolean },
        testUserId
      );

      await globalSettingRepository.updateSettings({}, testUserId2);

      const result = await globalSettingRepository.getSettings();
      expect((result as Record<string, unknown>).cleaning).toBeUndefined();
    });
  });
});
