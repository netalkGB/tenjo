import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from '../utils/env';
import logger from '../logger';

function getArtifactsDir(): string {
  return path.join(getDataDir(), 'artifacts');
}

/**
 * Centralized service for file I/O operations on the artifacts directory.
 * All file save/read/delete operations should go through this service.
 */
export class FileUploadService {
  /**
   * Save data to the artifacts directory.
   * Ensures the directory exists before writing.
   * Returns the full filesystem path of the saved file.
   */
  async save(
    filename: string,
    data: Buffer | string,
    encoding?: BufferEncoding
  ): Promise<string> {
    const dir = getArtifactsDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, path.basename(filename));
    if (encoding) {
      await fs.writeFile(filePath, data, encoding);
    } else {
      await fs.writeFile(filePath, data);
    }
    return filePath;
  }

  /**
   * Read a file from the artifacts directory as a Buffer.
   */
  async read(filename: string): Promise<Buffer> {
    const filePath = path.join(getArtifactsDir(), path.basename(filename));
    return fs.readFile(filePath);
  }

  /**
   * Read a file from the artifacts directory as UTF-8 text.
   */
  async readText(filename: string): Promise<string> {
    const filePath = path.join(getArtifactsDir(), path.basename(filename));
    return fs.readFile(filePath, 'utf-8');
  }

  /**
   * Delete a file from the artifacts directory.
   * Handles ENOENT gracefully (file already deleted).
   * Logs warnings for other errors without throwing.
   */
  async delete(filename: string): Promise<void> {
    const sanitized = path.basename(filename);
    const filePath = path.join(getArtifactsDir(), sanitized);
    try {
      await fs.unlink(filePath);
      logger.debug('Deleted artifact file', { filename: sanitized });
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        logger.debug('Artifact file already deleted', { filename: sanitized });
      } else {
        logger.warn('Failed to delete artifact file', {
          filename: sanitized,
          error: err
        });
      }
    }
  }

  /**
   * Get the full filesystem path for an artifact filename.
   */
  getPath(filename: string): string {
    return path.join(getArtifactsDir(), path.basename(filename));
  }
}
