import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileUploadService } from '../FileUploadService';

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('file-data')),
    unlink: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../../utils/env', () => ({
  getDataDir: vi.fn().mockReturnValue('/mock/data')
}));

vi.mock('../../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import fs from 'node:fs/promises';
import logger from '../../logger';

describe('FileUploadService', () => {
  let service: FileUploadService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FileUploadService();
  });

  describe('save', () => {
    it('should ensure directory and write file, returning full path', async () => {
      const result = await service.save('test.jpg', Buffer.from('data'));

      expect(fs.mkdir).toHaveBeenCalledWith('/mock/data/artifacts', {
        recursive: true
      });
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/mock/data/artifacts/test.jpg',
        Buffer.from('data')
      );
      expect(result).toBe('/mock/data/artifacts/test.jpg');
    });

    it('should pass encoding when provided', async () => {
      await service.save('test.txt', 'text content', 'utf-8');

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/mock/data/artifacts/test.txt',
        'text content',
        'utf-8'
      );
    });

    it('should sanitize filename with path.basename', async () => {
      await service.save('../evil/file.txt', 'data');

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/mock/data/artifacts/file.txt',
        'data'
      );
    });
  });

  describe('read', () => {
    it('should read file as buffer', async () => {
      const data = Buffer.from('image-data');
      vi.mocked(fs.readFile).mockResolvedValue(data);

      const result = await service.read('image.jpg');

      expect(result).toBe(data);
      expect(fs.readFile).toHaveBeenCalledWith(
        '/mock/data/artifacts/image.jpg'
      );
    });

    it('should sanitize filename', async () => {
      await service.read('../etc/passwd');

      expect(fs.readFile).toHaveBeenCalledWith('/mock/data/artifacts/passwd');
    });
  });

  describe('readText', () => {
    it('should read file as utf-8 text', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('text content' as never);

      const result = await service.readText('doc.txt');

      expect(result).toBe('text content');
      expect(fs.readFile).toHaveBeenCalledWith(
        '/mock/data/artifacts/doc.txt',
        'utf-8'
      );
    });
  });

  describe('delete', () => {
    it('should delete file and log debug', async () => {
      await service.delete('test.jpg');

      expect(fs.unlink).toHaveBeenCalledWith('/mock/data/artifacts/test.jpg');
      expect(logger.debug).toHaveBeenCalledWith('Deleted artifact file', {
        filename: 'test.jpg'
      });
    });

    it('should log debug when file is already deleted (ENOENT)', async () => {
      const enoentError = Object.assign(new Error('ENOENT'), {
        code: 'ENOENT'
      });
      vi.mocked(fs.unlink).mockRejectedValue(enoentError);

      await service.delete('missing.jpg');

      expect(logger.debug).toHaveBeenCalledWith(
        'Artifact file already deleted',
        { filename: 'missing.jpg' }
      );
    });

    it('should log warning on non-ENOENT errors without throwing', async () => {
      const permError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      vi.mocked(fs.unlink).mockRejectedValue(permError);

      await service.delete('locked.jpg');

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to delete artifact file',
        {
          filename: 'locked.jpg',
          error: permError
        }
      );
    });

    it('should sanitize filename to prevent path traversal', async () => {
      await service.delete('../etc/passwd');

      expect(fs.unlink).toHaveBeenCalledWith('/mock/data/artifacts/passwd');
      expect(fs.unlink).not.toHaveBeenCalledWith(
        expect.stringContaining('../')
      );
    });
  });

  describe('getPath', () => {
    it('should return full path for filename', () => {
      const result = service.getPath('image.jpg');

      expect(result).toBe('/mock/data/artifacts/image.jpg');
    });

    it('should sanitize filename', () => {
      const result = service.getPath('../etc/passwd');

      expect(result).toBe('/mock/data/artifacts/passwd');
    });
  });
});
