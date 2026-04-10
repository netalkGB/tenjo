import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GlobalSettingService,
  ModelNotFoundError,
  ModelDuplicateError
} from '../GlobalSettingService';
import type {
  GlobalSettingRepository,
  GlobalSettings,
  ModelEntry,
  ModelSettings
} from '../../repositories/GlobalSettingRepository';
import type { CredentialStoreService } from '../CredentialStoreService';
import type { McpServersConfig } from 'tenjo-chat-engine';

vi.mock('node:crypto', () => ({
  default: { randomUUID: vi.fn(() => 'generated-uuid') }
}));

const createMockGlobalSettingRepo = () => ({
  getSettings: vi.fn(),
  getOrCreateSettings: vi.fn(),
  updateSettings: vi.fn()
});

const createMockCredentialStoreService = () => ({
  save: vi.fn(),
  load: vi.fn(),
  exists: vi.fn(),
  delete: vi.fn(),
  update: vi.fn()
});

const makeModelEntry = (overrides: Partial<ModelEntry> = {}): ModelEntry => ({
  id: 'model-1',
  type: 'openai',
  baseUrl: 'https://api.openai.com',
  model: 'gpt-4',
  tokenCredentialId: 'cred-1',
  ...overrides
});

const makeModelSettings = (
  overrides: Partial<ModelSettings> = {}
): ModelSettings => ({
  activeId: 'model-1',
  models: [makeModelEntry()],
  ...overrides
});

const makeGlobalSettings = (
  overrides: Partial<GlobalSettings> = {}
): GlobalSettings => ({
  model: makeModelSettings(),
  ...overrides
});

describe('GlobalSettingService', () => {
  let service: GlobalSettingService;
  let repo: ReturnType<typeof createMockGlobalSettingRepo>;
  let credentialStore: ReturnType<typeof createMockCredentialStoreService>;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = createMockGlobalSettingRepo();
    credentialStore = createMockCredentialStoreService();
    service = new GlobalSettingService(
      repo as unknown as GlobalSettingRepository,
      credentialStore as unknown as CredentialStoreService
    );
  });

  describe('getGlobalSettings', () => {
    it('should return settings from repository', async () => {
      const settings = makeGlobalSettings();
      repo.getSettings.mockResolvedValue(settings);

      const result = await service.getGlobalSettings();

      expect(result).toEqual(settings);
      expect(repo.getSettings).toHaveBeenCalledOnce();
    });
  });

  describe('getModelSettings', () => {
    it('should return model settings when present', async () => {
      const modelSettings = makeModelSettings();
      repo.getSettings.mockResolvedValue(
        makeGlobalSettings({ model: modelSettings })
      );

      const result = await service.getModelSettings();

      expect(result).toEqual(modelSettings);
    });

    it('should return defaults when model settings are not set', async () => {
      repo.getSettings.mockResolvedValue({});

      const result = await service.getModelSettings();

      expect(result).toEqual({ activeId: '', models: [] });
    });
  });

  describe('resolveModelConfig', () => {
    it('should resolve config for a valid model with token', async () => {
      const entry = makeModelEntry({ tokenCredentialId: 'cred-1' });
      repo.getSettings.mockResolvedValue(
        makeGlobalSettings({
          model: makeModelSettings({ models: [entry] })
        })
      );
      credentialStore.load.mockResolvedValue('sk-secret-token');

      const result = await service.resolveModelConfig('model-1');

      expect(result).toEqual({
        type: 'openai',
        baseUrl: 'https://api.openai.com',
        model: 'gpt-4',
        token: 'sk-secret-token'
      });
      expect(credentialStore.load).toHaveBeenCalledWith('cred-1');
    });

    it('should resolve config for a model without token', async () => {
      const entry = makeModelEntry({ tokenCredentialId: undefined });
      repo.getSettings.mockResolvedValue(
        makeGlobalSettings({
          model: makeModelSettings({ models: [entry] })
        })
      );

      const result = await service.resolveModelConfig('model-1');

      expect(result).toEqual({
        type: 'openai',
        baseUrl: 'https://api.openai.com',
        model: 'gpt-4',
        token: null
      });
      expect(credentialStore.load).not.toHaveBeenCalled();
    });

    it('should throw ModelNotFoundError when modelId is undefined', async () => {
      await expect(service.resolveModelConfig(undefined)).rejects.toThrow(
        ModelNotFoundError
      );
    });

    it('should throw ModelNotFoundError when model settings are missing', async () => {
      repo.getSettings.mockResolvedValue({});

      await expect(service.resolveModelConfig('model-1')).rejects.toThrow(
        ModelNotFoundError
      );
    });

    it('should throw ModelNotFoundError when model is not found', async () => {
      repo.getSettings.mockResolvedValue(
        makeGlobalSettings({
          model: makeModelSettings({ models: [] })
        })
      );

      await expect(service.resolveModelConfig('nonexistent')).rejects.toThrow(
        ModelNotFoundError
      );
    });
  });

  describe('getModelSettingsForClient', () => {
    it('should return models without token credential IDs', async () => {
      const models: ModelEntry[] = [
        makeModelEntry({
          id: 'm-1',
          tokenCredentialId: 'cred-1',
          maxContextLength: 128000
        }),
        makeModelEntry({
          id: 'm-2',
          type: 'ollama',
          baseUrl: 'http://localhost:11434',
          model: 'llama3',
          tokenCredentialId: undefined,
          maxContextLength: undefined
        })
      ];
      repo.getSettings.mockResolvedValue(
        makeGlobalSettings({
          model: makeModelSettings({ activeId: 'm-1', models })
        })
      );

      const result = await service.getModelSettingsForClient();

      expect(result).toEqual({
        activeId: 'm-1',
        models: [
          {
            id: 'm-1',
            type: 'openai',
            baseUrl: 'https://api.openai.com',
            model: 'gpt-4',
            hasToken: true,
            maxContextLength: 128000
          },
          {
            id: 'm-2',
            type: 'ollama',
            baseUrl: 'http://localhost:11434',
            model: 'llama3',
            hasToken: false,
            maxContextLength: undefined
          }
        ]
      });

      // Verify tokenCredentialId is not in the response
      const responseStr = JSON.stringify(result);
      expect(responseStr).not.toContain('tokenCredentialId');
      expect(responseStr).not.toContain('cred-1');
    });
  });

  describe('getMcpServersConfig', () => {
    it('should return MCP servers config when present', async () => {
      const mcpServers: McpServersConfig = {
        myServer: { type: 'stdio', command: 'node', args: ['server.js'] }
      };
      repo.getSettings.mockResolvedValue(makeGlobalSettings({ mcpServers }));

      const result = await service.getMcpServersConfig();

      expect(result).toEqual(mcpServers);
    });

    it('should return empty object when no MCP config exists', async () => {
      repo.getSettings.mockResolvedValue({});

      const result = await service.getMcpServersConfig();

      expect(result).toEqual({});
    });
  });

  describe('addModel', () => {
    it('should add a model with token', async () => {
      const existingSettings: GlobalSettings = {};
      repo.getOrCreateSettings.mockResolvedValue(existingSettings);
      credentialStore.save.mockResolvedValue('new-cred-id');

      const result = await service.addModel(
        {
          type: 'openai',
          baseUrl: 'https://api.openai.com',
          model: 'gpt-4',
          token: 'sk-secret',
          maxContextLength: 128000
        },
        'user-1'
      );

      expect(result).toEqual({
        id: 'generated-uuid',
        type: 'openai',
        baseUrl: 'https://api.openai.com',
        model: 'gpt-4',
        hasToken: true,
        maxContextLength: 128000
      });
      expect(credentialStore.save).toHaveBeenCalledWith('sk-secret');
      expect(repo.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            models: [
              expect.objectContaining({
                id: 'generated-uuid',
                tokenCredentialId: 'new-cred-id'
              })
            ]
          })
        }),
        'user-1'
      );
    });

    it('should add a model without token', async () => {
      repo.getOrCreateSettings.mockResolvedValue({});

      const result = await service.addModel(
        {
          type: 'lmstudio',
          baseUrl: 'http://localhost:1234',
          model: 'local-model'
        },
        'user-1'
      );

      expect(result).toEqual({
        id: 'generated-uuid',
        type: 'lmstudio',
        baseUrl: 'http://localhost:1234',
        model: 'local-model',
        hasToken: false,
        maxContextLength: undefined
      });
      expect(credentialStore.save).not.toHaveBeenCalled();
    });

    it('should throw ModelDuplicateError for duplicate model+baseUrl', async () => {
      const existing = makeModelEntry({
        model: 'gpt-4',
        baseUrl: 'https://api.openai.com'
      });
      repo.getOrCreateSettings.mockResolvedValue(
        makeGlobalSettings({
          model: makeModelSettings({ models: [existing] })
        })
      );

      await expect(
        service.addModel(
          {
            type: 'openai',
            baseUrl: 'https://api.openai.com',
            model: 'gpt-4',
            token: 'sk-secret'
          },
          'user-1'
        )
      ).rejects.toThrow(ModelDuplicateError);

      expect(repo.updateSettings).not.toHaveBeenCalled();
    });
  });

  describe('deleteModel', () => {
    it('should delete a model and clean up token credential', async () => {
      const entry = makeModelEntry({
        id: 'model-to-delete',
        tokenCredentialId: 'cred-to-delete'
      });
      const settings = makeGlobalSettings({
        model: makeModelSettings({
          activeId: 'other-model',
          models: [entry]
        })
      });
      repo.getOrCreateSettings.mockResolvedValue(settings);

      await service.deleteModel('model-to-delete', 'user-1');

      expect(credentialStore.delete).toHaveBeenCalledWith('cred-to-delete');
      expect(repo.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            models: []
          })
        }),
        'user-1'
      );
    });

    it('should delete a model without token credential', async () => {
      const entry = makeModelEntry({
        id: 'model-to-delete',
        tokenCredentialId: undefined
      });
      const settings = makeGlobalSettings({
        model: makeModelSettings({
          activeId: 'other-model',
          models: [entry]
        })
      });
      repo.getOrCreateSettings.mockResolvedValue(settings);

      await service.deleteModel('model-to-delete', 'user-1');

      expect(credentialStore.delete).not.toHaveBeenCalled();
      expect(repo.updateSettings).toHaveBeenCalledOnce();
    });

    it('should clear activeId when deleting the active model', async () => {
      const entry = makeModelEntry({ id: 'active-model' });
      const settings = makeGlobalSettings({
        model: makeModelSettings({
          activeId: 'active-model',
          models: [entry]
        })
      });
      repo.getOrCreateSettings.mockResolvedValue(settings);

      await service.deleteModel('active-model', 'user-1');

      expect(repo.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            activeId: ''
          })
        }),
        'user-1'
      );
    });

    it('should throw ModelNotFoundError when settings.model is null/undefined', async () => {
      repo.getOrCreateSettings.mockResolvedValue(
        makeGlobalSettings({ model: undefined as unknown as ModelSettings })
      );

      await expect(service.deleteModel('any-model', 'user-1')).rejects.toThrow(
        ModelNotFoundError
      );

      expect(repo.updateSettings).not.toHaveBeenCalled();
    });

    it('should throw ModelNotFoundError when model does not exist', async () => {
      repo.getOrCreateSettings.mockResolvedValue(
        makeGlobalSettings({
          model: makeModelSettings({ models: [] })
        })
      );

      await expect(
        service.deleteModel('nonexistent', 'user-1')
      ).rejects.toThrow(ModelNotFoundError);

      expect(repo.updateSettings).not.toHaveBeenCalled();
    });
  });

  describe('updateMcpServersConfig', () => {
    it('should update MCP servers config', async () => {
      const existingSettings = makeGlobalSettings();
      repo.getOrCreateSettings.mockResolvedValue(existingSettings);

      const newMcpConfig: McpServersConfig = {
        server1: { type: 'stdio', command: 'npx', args: ['-y', 'mcp-server'] }
      };

      await service.updateMcpServersConfig(newMcpConfig, 'user-1');

      expect(repo.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: newMcpConfig
        }),
        'user-1'
      );
    });
  });
});
