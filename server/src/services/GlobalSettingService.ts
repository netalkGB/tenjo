import crypto from 'node:crypto';
import type {
  GlobalSettingRepository,
  GlobalSettings,
  ModelSettings,
  ModelEntry,
  ModelEntryResponse,
  ModelConfig
} from '../repositories/GlobalSettingRepository';
import type { CredentialStoreService } from './CredentialStoreService';
import type { McpServersConfig } from 'tenjo-chat-engine';
import { ServiceError } from '../errors/ServiceError';

export class ModelNotFoundError extends ServiceError {
  constructor(message: string = 'Model setting not found') {
    super(message);
  }
}

export class ModelDuplicateError extends ServiceError {}

export class GlobalSettingService {
  constructor(
    private globalSettingRepo: GlobalSettingRepository,
    private credentialStoreService: CredentialStoreService
  ) {}

  async getGlobalSettings(): Promise<GlobalSettings> {
    return this.globalSettingRepo.getSettings();
  }

  async getModelSettings(): Promise<ModelSettings> {
    const settings = await this.getGlobalSettings();
    return settings.model ?? { activeId: '', models: [] };
  }

  async resolveModelConfig(modelId: string | undefined): Promise<ModelConfig> {
    if (!modelId) {
      throw new ModelNotFoundError('Model ID is required');
    }

    const settings = await this.getGlobalSettings();
    const modelSettings = settings.model;

    if (!modelSettings) {
      throw new ModelNotFoundError();
    }

    const entry = modelSettings.models.find((m) => m.id === modelId);

    if (!entry) {
      throw new ModelNotFoundError();
    }

    const token = entry.tokenCredentialId
      ? await this.credentialStoreService.load(entry.tokenCredentialId)
      : null;

    return {
      type: entry.type,
      baseUrl: entry.baseUrl,
      model: entry.model,
      token
    };
  }

  async getModelSettingsForClient(): Promise<{
    activeId: string;
    models: ModelEntryResponse[];
  }> {
    const modelSettings = await this.getModelSettings();
    return {
      activeId: modelSettings.activeId,
      models: modelSettings.models.map((m) => ({
        id: m.id,
        type: m.type,
        baseUrl: m.baseUrl,
        model: m.model,
        hasToken: !!m.tokenCredentialId,
        maxContextLength: m.maxContextLength
      }))
    };
  }

  async getMcpServersConfig(): Promise<McpServersConfig> {
    const settings = await this.getGlobalSettings();
    return settings.mcpServers ?? {};
  }

  async addModel(
    entry: {
      type: ModelEntry['type'];
      baseUrl: string;
      model: string;
      token?: string;
      maxContextLength?: number;
    },
    userId: string
  ): Promise<ModelEntryResponse> {
    const settings = await this.globalSettingRepo.getOrCreateSettings();
    const modelSettings: ModelSettings = settings.model ?? {
      activeId: '',
      models: []
    };

    const duplicate = modelSettings.models.some(
      (m) => m.model === entry.model && m.baseUrl === entry.baseUrl
    );
    if (duplicate) {
      throw new ModelDuplicateError(
        'A model with the same name and base URL already exists'
      );
    }

    let tokenCredentialId: string | undefined;
    if (entry.token) {
      tokenCredentialId = await this.credentialStoreService.save(entry.token);
    }

    const newEntry: ModelEntry = {
      id: crypto.randomUUID(),
      type: entry.type,
      baseUrl: entry.baseUrl,
      model: entry.model,
      tokenCredentialId,
      maxContextLength: entry.maxContextLength
    };

    modelSettings.models.push(newEntry);
    const updated: GlobalSettings = { ...settings, model: modelSettings };
    await this.globalSettingRepo.updateSettings(updated, userId);

    return {
      id: newEntry.id,
      type: newEntry.type,
      baseUrl: newEntry.baseUrl,
      model: newEntry.model,
      hasToken: !!tokenCredentialId,
      maxContextLength: newEntry.maxContextLength
    };
  }

  async deleteModel(modelId: string, userId: string): Promise<void> {
    const settings = await this.globalSettingRepo.getOrCreateSettings();
    const modelSettings: ModelSettings = settings.model ?? {
      activeId: '',
      models: []
    };

    const index = modelSettings.models.findIndex((m) => m.id === modelId);
    if (index === -1) {
      throw new ModelNotFoundError();
    }

    const entry = modelSettings.models[index];
    if (entry.tokenCredentialId) {
      await this.credentialStoreService.delete(entry.tokenCredentialId);
    }

    modelSettings.models.splice(index, 1);

    if (modelSettings.activeId === modelId) {
      modelSettings.activeId = '';
    }

    const updated: GlobalSettings = { ...settings, model: modelSettings };
    await this.globalSettingRepo.updateSettings(updated, userId);
  }

  async updateMcpServersConfig(
    mcpServers: McpServersConfig,
    userId: string
  ): Promise<void> {
    const settings = await this.globalSettingRepo.getOrCreateSettings();
    const updated: GlobalSettings = { ...settings, mcpServers };
    await this.globalSettingRepo.updateSettings(updated, userId);
  }
}
