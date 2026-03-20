import crypto from 'node:crypto';
import type {
  GlobalSettingRepository,
  GlobalSettings,
  ModelSettings,
  ModelEntry,
  ModelConfig
} from '../repositories/GlobalSettingRepository';
import type { McpServersConfig } from '../utils/mcpTransportFactory';
import { ServiceError } from '../errors/ServiceError';

export class ModelNotFoundError extends ServiceError {
  constructor(message: string = 'Model setting not found') {
    super(message);
  }
}

export class ModelDuplicateError extends ServiceError {}

export class GlobalSettingService {
  constructor(private globalSettingRepo: GlobalSettingRepository) {}

  async getGlobalSettings(): Promise<GlobalSettings> {
    const globalSetting = await this.globalSettingRepo.get();
    return (globalSetting?.settings ?? {}) as GlobalSettings;
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

    return {
      type: entry.type,
      baseUrl: entry.baseUrl,
      model: entry.model,
      token: entry.token || null
    };
  }

  async getMcpServersConfig(): Promise<McpServersConfig> {
    const settings = await this.getGlobalSettings();
    return settings.mcpServers ?? {};
  }

  async addModel(
    entry: Omit<ModelEntry, 'id'>,
    userId: string
  ): Promise<ModelEntry> {
    const globalSetting = await this.globalSettingRepo.getOrCreate();
    const settings = (globalSetting.settings ?? {}) as GlobalSettings;
    const modelSettings = settings.model ?? { activeId: '', models: [] };

    const duplicate = modelSettings.models.some(
      (m) => m.model === entry.model && m.baseUrl === entry.baseUrl
    );
    if (duplicate) {
      throw new ModelDuplicateError(
        'A model with the same name and base URL already exists'
      );
    }

    const newEntry: ModelEntry = {
      id: crypto.randomUUID(),
      ...entry
    };

    modelSettings.models.push(newEntry);
    await this.globalSettingRepo.updateSettings(
      { ...settings, model: modelSettings },
      userId
    );

    return newEntry;
  }

  async deleteModel(modelId: string, userId: string): Promise<void> {
    const globalSetting = await this.globalSettingRepo.getOrCreate();
    const settings = (globalSetting.settings ?? {}) as GlobalSettings;
    const modelSettings = settings.model ?? { activeId: '', models: [] };

    const index = modelSettings.models.findIndex((m) => m.id === modelId);
    if (index === -1) {
      throw new ModelNotFoundError();
    }

    modelSettings.models.splice(index, 1);

    if (modelSettings.activeId === modelId) {
      modelSettings.activeId = '';
    }

    await this.globalSettingRepo.updateSettings(
      { ...settings, model: modelSettings },
      userId
    );
  }

  async updateMcpServersConfig(
    mcpServers: McpServersConfig,
    userId: string
  ): Promise<void> {
    const globalSetting = await this.globalSettingRepo.getOrCreate();
    const settings = (globalSetting.settings ?? {}) as GlobalSettings;
    settings.mcpServers = mcpServers;
    await this.globalSettingRepo.updateSettings(settings, userId);
  }
}
