import { BaseRepository } from './BaseRepository';
import type { McpServersConfig } from 'tenjo-chat-engine';

export const MODEL_TYPES = [
  'lmstudio',
  'ollama',
  'openai',
  'openai-compatible'
] as const;

export type ModelType = (typeof MODEL_TYPES)[number];

export function isModelType(value: string): value is ModelType {
  return MODEL_TYPES.some((type) => type === value);
}

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

export interface BrandingSettings {
  appTitle?: string;
  logoFilename?: string;
  faviconFilename?: string;
}

export interface GlobalSettings {
  model?: ModelSettings;
  mcpServers?: McpServersConfig;
  branding?: BrandingSettings;
}

export interface UserSettings {
  activeModelId?: string;
  language?: string;
  theme?: string;
  selectedKnowledgeIds?: string[];
  disabledMcpTools?: string[];
  executeCodeEnabled?: boolean;
  webSearchEnabled?: boolean;
  webSearchExtendedTimeoutEnabled?: boolean;
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

  async updateSettingSection<K extends keyof GlobalSettings>(
    key: K,
    value: GlobalSettings[K],
    updatedBy: string
  ): Promise<void> {
    const current = await this.getOrCreateRow();
    await this.pool.query(
      `UPDATE "global_settings"
       SET "settings" = jsonb_set(COALESCE("settings", '{}'::jsonb), $1, $2::jsonb, true),
           "updated_by" = $3,
           "updated_at" = $4
       WHERE "id" = $5`,
      [[key], JSON.stringify(value), updatedBy, new Date(), current.id]
    );
  }
}
