import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from '../utils/env';
import type { Pool } from 'pg';
import type { GlobalSettingRepository } from '../repositories/GlobalSettingRepository';
import logger from '../logger';
import { sandboxManager, isAgentSandboxUsable } from './AgentSandboxService';
import type { PunchSkillService } from './PunchSkillService';

function getArtifactsDir(): string {
  return path.join(getDataDir(), 'artifacts');
}

const UNREFERENCED_FILE_GRACE_PERIOD_MS = 30 * 60 * 1000;
// Backward compatibility for artifact URLs saved before scoped chat URLs.
const ARTIFACT_URL_FILENAME_PATTERN =
  '(?:/api/chat/threads/[^"\\\\/?#]+/artifacts|/api/upload/artifacts)/([^"\\\\/?#]+)(?:[?#][^"\\\\]*)?';

function addFilename(referenced: Set<string>, value: string): void {
  const filename = path.basename(value);
  if (filename.length > 0 && filename !== '.' && filename !== '..') {
    referenced.add(filename);
  }
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
    private readonly globalSettingRepo: GlobalSettingRepository,
    private readonly punchSkillService?: PunchSkillService
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
          if (!this.isEligibleForDeletion(stat.mtimeMs)) continue;

          await fs.unlink(filePath);
          deletedCount++;
          deletedSizeBytes += stat.size;
          logger.debug('Deleted orphaned file', { file });
        } catch (err) {
          logger.warn('Failed to delete orphaned file', { file, error: err });
        }
      }

      logger.info('File cleanup completed', { deletedCount, deletedSizeBytes });

      if (isAgentSandboxUsable()) {
        try {
          const projectResult = await this.pool.query<{ id: string }>(
            'SELECT id FROM "agent_project"'
          );
          const knownProjectIds = projectResult.rows.map((row) => row.id);
          await sandboxManager.reapOrphans(knownProjectIds);
          logger.info('Sandbox orphans cleanup completed');
        } catch (err) {
          logger.warn('Failed to cleanup sandbox orphans', { error: err });
        }
      }
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

  /** Get all artifact filenames still referenced by persisted application data. */
  private async getReferencedFiles(): Promise<Set<string>> {
    const referenced = new Set<string>();

    // Extract artifact filenames from the whole message JSON. User images are
    // stored in content[].image_url.url, but older or tool-produced messages can
    // still contain artifact URLs elsewhere in the persisted payload.
    const messageResult = await this.pool.query<{ filename: string }>(`
      SELECT DISTINCT match[1] AS filename
      FROM messages,
           LATERAL regexp_matches(
             data::text,
             '${ARTIFACT_URL_FILENAME_PATTERN}',
             'g'
           ) AS match
    `);

    for (const row of messageResult.rows) {
      addFilename(referenced, row.filename);
    }

    // Extract filenames from knowledge.fs_path
    const knowledgeResult = await this.pool.query<{ fs_path: string }>(
      `SELECT fs_path FROM knowledge`
    );

    for (const row of knowledgeResult.rows) {
      addFilename(referenced, row.fs_path);
    }

    if (this.punchSkillService) {
      for (const fsPath of await this.punchSkillService.listStoredFsPaths()) {
        addFilename(referenced, fsPath);
      }
    }

    // Extract branding filenames (logo, favicon) from global_settings
    const globalSettings = await this.globalSettingRepo.getSettings();
    if (globalSettings.branding?.logoFilename) {
      addFilename(referenced, globalSettings.branding.logoFilename);
    }
    if (globalSettings.branding?.faviconFilename) {
      addFilename(referenced, globalSettings.branding.faviconFilename);
    }

    return referenced;
  }

  private isEligibleForDeletion(mtimeMs: number): boolean {
    if (!Number.isFinite(mtimeMs)) return true;
    return Date.now() - mtimeMs >= UNREFERENCED_FILE_GRACE_PERIOD_MS;
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
