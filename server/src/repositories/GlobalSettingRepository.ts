import { BaseRepository } from './BaseRepository';
import type { McpServersConfig } from '../utils/mcpTransportFactory';

export interface GlobalSetting {
  id: string;
  settings: unknown;
  updated_by: string | null;
  updated_at: Date | null;
}

export type ModelType = 'lmstudio' | 'ollama' | 'openai';

export interface ModelEntry {
  id: string;
  type: ModelType;
  baseUrl: string;
  model: string;
  token: string;
}

export interface ModelSettings {
  activeId: string;
  models: ModelEntry[];
}

export interface ModelConfig {
  type: ModelType;
  baseUrl: string;
  model: string;
  token: string | null;
}

export interface GlobalSettings {
  model?: ModelSettings;
  mcpServers?: McpServersConfig;
}

export interface UserSettings {
  activeModelId?: string;
}

export class GlobalSettingRepository extends BaseRepository {
  async get(): Promise<GlobalSetting | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "global_settings" LIMIT 1`
    );
    return result.rows[0] as GlobalSetting | undefined;
  }

  async getOrCreate(): Promise<GlobalSetting> {
    const existing = await this.get();
    if (existing) return existing;

    return await this.insertReturning<GlobalSetting>(
      'global_settings',
      { settings: {} },
      ['id', 'settings', 'updated_by', 'updated_at']
    );
  }

  async updateSettings(
    settings: object,
    updatedBy: string
  ): Promise<GlobalSetting> {
    const current = await this.getOrCreate();
    const result = await this.pool.query(
      `UPDATE "global_settings" SET "settings" = $1, "updated_by" = $2, "updated_at" = $3 WHERE "id" = $4 RETURNING *`,
      [JSON.stringify(settings), updatedBy, new Date(), current.id]
    );
    return result.rows[0] as GlobalSetting;
  }
}
