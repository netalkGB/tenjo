import { BaseRepository } from './BaseRepository';
import type { McpServersConfig } from 'tenjo-chat-engine';

export type ModelType = 'lmstudio' | 'ollama' | 'openai';

export interface ModelEntry {
  id: string;
  type: ModelType;
  baseUrl: string;
  model: string;
  tokenCredentialId?: string;
  maxContextLength?: number;
}

export interface ModelEntryResponse {
  id: string;
  type: ModelType;
  baseUrl: string;
  model: string;
  hasToken: boolean;
  maxContextLength?: number;
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
  language?: string;
  theme?: string;
}

interface GlobalSettingRow {
  id: string;
  settings: GlobalSettings;
  updated_by: string | null;
  updated_at: Date | null;
}

export class GlobalSettingRepository extends BaseRepository {
  private async getRow(): Promise<GlobalSettingRow | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "global_settings" LIMIT 1`
    );
    return result.rows[0] as GlobalSettingRow | undefined;
  }

  private async getOrCreateRow(): Promise<GlobalSettingRow> {
    const existing = await this.getRow();
    if (existing) return existing;

    return await this.insertReturning<GlobalSettingRow>(
      'global_settings',
      { settings: {} },
      ['id', 'settings', 'updated_by', 'updated_at']
    );
  }

  async getSettings(): Promise<GlobalSettings> {
    const row = await this.getRow();
    return row?.settings ?? {};
  }

  async getOrCreateSettings(): Promise<GlobalSettings> {
    const row = await this.getOrCreateRow();
    return row.settings;
  }

  async updateSettings(
    settings: GlobalSettings,
    updatedBy: string
  ): Promise<void> {
    const current = await this.getOrCreateRow();
    await this.pool.query(
      `UPDATE "global_settings" SET "settings" = $1, "updated_by" = $2, "updated_at" = $3 WHERE "id" = $4`,
      [JSON.stringify(settings), updatedBy, new Date(), current.id]
    );
  }
}
