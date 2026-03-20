import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from '../utils/env';
import { ServiceError } from '../errors/ServiceError';
import logger from '../logger';

export class ImageNotFoundError extends ServiceError {
  constructor(message: string = 'File not found') {
    super(message);
  }
}

export class ImageValidationError extends ServiceError {}

const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface MagicByteEntry {
  format: string;
  bytes: number[];
  ext: string;
}

const MAGIC_BYTES: MagicByteEntry[] = [
  { format: 'jpeg', bytes: [0xff, 0xd8, 0xff], ext: '.jpg' },
  { format: 'png', bytes: [0x89, 0x50, 0x4e, 0x47], ext: '.png' }
];

const EXTENSION_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png'
};

function getArtifactsDir(): string {
  return path.join(getDataDir(), 'artifacts');
}

/**
 * Detect image format by checking magic bytes.
 * Returns the file extension (e.g., '.jpg') or null if not a supported format.
 */
function detectImageFormat(buffer: Buffer): string | null {
  for (const entry of MAGIC_BYTES) {
    const prefixMatch = entry.bytes.every(
      (byte, index) => buffer[index] === byte
    );
    if (!prefixMatch) continue;
    return entry.ext;
  }
  return null;
}

async function ensureDirectories(): Promise<void> {
  await fs.mkdir(getArtifactsDir(), { recursive: true });
}

export interface UploadResult {
  filename: string;
  url: string;
}

export class ImageService {
  async uploadImage(fileBuffer: Buffer): Promise<UploadResult> {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new ImageValidationError('No file data received');
    }

    if (fileBuffer.length > MAX_FILE_SIZE) {
      throw new ImageValidationError('File size exceeds 10MB limit');
    }

    const ext = detectImageFormat(fileBuffer);
    if (!ext) {
      throw new ImageValidationError(
        'Invalid file type. Only JPEG and PNG images are allowed.'
      );
    }

    await ensureDirectories();

    const id = crypto.randomUUID();
    const filename = `${id}${ext}`;
    const artifactPath = path.join(getArtifactsDir(), filename);

    await fs.writeFile(artifactPath, fileBuffer);

    return {
      filename,
      url: `/api/upload/artifacts/${filename}`
    };
  }

  async getArtifact(
    filename: string
  ): Promise<{ data: Buffer; contentType: string }> {
    const sanitized = path.basename(filename);
    if (sanitized !== filename || filename.includes('..')) {
      throw new ImageValidationError('Invalid filename');
    }

    const ext = path.extname(sanitized).toLowerCase();
    const contentType = EXTENSION_TO_MIME[ext] ?? 'application/octet-stream';

    const filePath = path.join(getArtifactsDir(), sanitized);

    try {
      await fs.access(filePath);
      const data = await fs.readFile(filePath);
      return { data, contentType };
    } catch {
      logger.debug('Artifact file not found:', filePath);
      throw new ImageNotFoundError();
    }
  }
}
