import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from '../utils/env';
import type { Pool } from 'pg';
import type { GlobalSettingRepository } from '../repositories/GlobalSettingRepository';
import logger from '../logger';

function getArtifactsDir(): string {
  return path.join(getDataDir(), 'artifacts');
}

export interface CleanupStatus {
  cleaning: boolean;
  totalSizeBytes: number;
  deletedCount?: number;
  deletedSizeBytes?: number;
}

export class FileCleanupService {
  constructor(
    private readonly pool: Pool,
    private readonly globalSettingRepo: GlobalSettingRepository
  ) {}

  /**
   * Get the current cleanup status and total artifacts size.
   */
  async getStatus(): Promise<CleanupStatus> {
    const settings = await this.globalSettingRepo.getSettings();
    const cleaning = (settings as Record<string, unknown>).cleaning === true;

    const totalSizeBytes = await this.calculateTotalSize();

    return { cleaning, totalSizeBytes };
  }

  /**
   * Start background cleanup. Returns immediately.
   * Sets cleaning flag in global_settings, performs cleanup, then removes the flag.
   */
  async startCleanup(userId: string): Promise<void> {
    // Set cleaning flag
    const settings = await this.globalSettingRepo.getOrCreateSettings();
    await this.globalSettingRepo.updateSettings(
      { ...settings, cleaning: true } as typeof settings & {
        cleaning: boolean;
      },
      userId
    );

    // Run cleanup in background (don't await)
    this.performCleanup(userId).catch((err) => {
      logger.error('File cleanup failed', { error: err });
    });
  }

  private async performCleanup(userId: string): Promise<void> {
    try {
      const artifactsDir = getArtifactsDir();

      let files: string[];
      try {
        files = await fs.readdir(artifactsDir);
      } catch {
        logger.info('Artifacts directory does not exist, nothing to clean');
        return;
      }

      const referencedFiles = await this.getReferencedFiles();

      let deletedCount = 0;
      let deletedSizeBytes = 0;

      for (const file of files) {
        if (referencedFiles.has(file)) continue;

        const filePath = path.join(artifactsDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (!stat.isFile()) continue;

          await fs.unlink(filePath);
          deletedCount++;
          deletedSizeBytes += stat.size;
          logger.debug('Deleted orphaned file', { file });
        } catch (err) {
          logger.warn('Failed to delete orphaned file', { file, error: err });
        }
      }

      logger.info('File cleanup completed', { deletedCount, deletedSizeBytes });
    } finally {
      // Clear cleaning flag
      const settings = await this.globalSettingRepo.getOrCreateSettings();
      const { cleaning: _, ...rest } = settings as typeof settings & {
        cleaning?: boolean;
      };
      await this.globalSettingRepo.updateSettings(
        rest as typeof settings,
        userId
      );
    }
  }

  /**
   * Get all filenames referenced in messages (image URLs) and knowledge (fs_path).
   */
  private async getReferencedFiles(): Promise<Set<string>> {
    const referenced = new Set<string>();

    // Extract image filenames from messages.data JSONB
    // Image URLs are stored as /api/upload/artifacts/{filename}
    const imageResult = await this.pool.query<{ filename: string }>(`
      SELECT DISTINCT match[1] AS filename
      FROM messages,
           LATERAL jsonb_array_elements(
             CASE jsonb_typeof(data->'content')
               WHEN 'array' THEN data->'content'
               ELSE '[]'::jsonb
             END
           ) AS elem,
           LATERAL (
             SELECT regexp_match(
               elem->'image_url'->>'url',
               '/api/upload/artifacts/([^/]+)$'
             ) AS match
           ) AS m
      WHERE elem->>'type' = 'image_url'
        AND match IS NOT NULL
    `);

    for (const row of imageResult.rows) {
      referenced.add(row.filename);
    }

    // Extract filenames from knowledge.fs_path
    const knowledgeResult = await this.pool.query<{ fs_path: string }>(
      `SELECT fs_path FROM knowledge`
    );

    for (const row of knowledgeResult.rows) {
      const filename = path.basename(row.fs_path);
      referenced.add(filename);
    }

    return referenced;
  }

  private async calculateTotalSize(): Promise<number> {
    const artifactsDir = getArtifactsDir();
    let totalSize = 0;

    try {
      const files = await fs.readdir(artifactsDir);
      for (const file of files) {
        try {
          const stat = await fs.stat(path.join(artifactsDir, file));
          if (stat.isFile()) {
            totalSize += stat.size;
          }
        } catch {
          // Skip files that can't be stat'd
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return totalSize;
  }
}
