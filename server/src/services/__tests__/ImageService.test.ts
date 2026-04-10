import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ImageService,
  ImageNotFoundError,
  ImageValidationError
} from '../ImageService';
import type { FileUploadService } from '../FileUploadService';

// Mock crypto
vi.mock('node:crypto', () => ({
  default: {
    randomUUID: vi.fn().mockReturnValue('test-uuid-1234')
  }
}));

// Mock logger
vi.mock('../../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

/** Build a buffer with the given leading bytes, padded to the specified length */
function buildBuffer(magicBytes: number[], totalLength: number = 64): Buffer {
  const buf = Buffer.alloc(totalLength);
  magicBytes.forEach((byte, i) => {
    buf[i] = byte;
  });
  return buf;
}

const createMockFileUploadService = () => ({
  save: vi.fn().mockResolvedValue('/mock/data/artifacts/test-uuid-1234.jpg'),
  read: vi.fn().mockResolvedValue(Buffer.from('file-data')),
  readText: vi.fn(),
  delete: vi.fn(),
  getPath: vi.fn()
});

describe('ImageService', () => {
  let service: ImageService;
  let mockFileUploadService: ReturnType<typeof createMockFileUploadService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileUploadService = createMockFileUploadService();
    service = new ImageService(
      mockFileUploadService as unknown as FileUploadService
    );
  });

  describe('uploadImage', () => {
    it('should upload a JPEG file and return filename with url', async () => {
      const jpegBuffer = buildBuffer([0xff, 0xd8, 0xff]);

      const result = await service.uploadImage(jpegBuffer);

      expect(result).toEqual({
        filename: 'test-uuid-1234.jpg',
        url: '/api/upload/artifacts/test-uuid-1234.jpg'
      });
      expect(mockFileUploadService.save).toHaveBeenCalledWith(
        'test-uuid-1234.jpg',
        jpegBuffer
      );
    });

    it('should upload a PNG file and return filename with url', async () => {
      const pngBuffer = buildBuffer([0x89, 0x50, 0x4e, 0x47]);

      const result = await service.uploadImage(pngBuffer);

      expect(result).toEqual({
        filename: 'test-uuid-1234.png',
        url: '/api/upload/artifacts/test-uuid-1234.png'
      });
      expect(mockFileUploadService.save).toHaveBeenCalledWith(
        'test-uuid-1234.png',
        pngBuffer
      );
    });

    it('should throw ImageValidationError when file exceeds 10MB', async () => {
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1);
      largeBuffer[0] = 0xff;
      largeBuffer[1] = 0xd8;
      largeBuffer[2] = 0xff;

      await expect(service.uploadImage(largeBuffer)).rejects.toThrow(
        ImageValidationError
      );
      await expect(service.uploadImage(largeBuffer)).rejects.toThrow(
        'File size exceeds 10MB limit'
      );
    });

    it('should throw ImageValidationError for unsupported format', async () => {
      const gifBuffer = buildBuffer([0x47, 0x49, 0x46, 0x38]);

      await expect(service.uploadImage(gifBuffer)).rejects.toThrow(
        ImageValidationError
      );
      await expect(service.uploadImage(gifBuffer)).rejects.toThrow(
        'Invalid file type'
      );
    });

    it('should throw ImageValidationError for empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);

      await expect(service.uploadImage(emptyBuffer)).rejects.toThrow(
        ImageValidationError
      );
      await expect(service.uploadImage(emptyBuffer)).rejects.toThrow(
        'No file data received'
      );
    });
  });

  describe('getArtifact', () => {
    it('should return buffer and content type for a JPEG file', async () => {
      const fileData = Buffer.from('jpeg-content');
      mockFileUploadService.read.mockResolvedValue(fileData);

      const result = await service.getArtifact('image.jpg');

      expect(result).toEqual({
        data: fileData,
        contentType: 'image/jpeg'
      });
      expect(mockFileUploadService.read).toHaveBeenCalledWith('image.jpg');
    });

    it('should return buffer and content type for a PNG file', async () => {
      const fileData = Buffer.from('png-content');
      mockFileUploadService.read.mockResolvedValue(fileData);

      const result = await service.getArtifact('image.png');

      expect(result).toEqual({
        data: fileData,
        contentType: 'image/png'
      });
    });

    it('should throw ImageNotFoundError when file does not exist', async () => {
      mockFileUploadService.read.mockRejectedValue(new Error('ENOENT'));

      await expect(service.getArtifact('missing.jpg')).rejects.toThrow(
        ImageNotFoundError
      );
    });

    it('should return application/octet-stream for unknown file extensions', async () => {
      const fileData = Buffer.from('gif-content');
      mockFileUploadService.read.mockResolvedValue(fileData);

      const result = await service.getArtifact('test-file.gif');

      expect(result).toEqual({
        data: fileData,
        contentType: 'application/octet-stream'
      });
    });

    it('should throw ImageValidationError for path traversal attempt', async () => {
      await expect(service.getArtifact('../etc/passwd')).rejects.toThrow(
        ImageValidationError
      );
      await expect(service.getArtifact('../etc/passwd')).rejects.toThrow(
        'Invalid filename'
      );
    });

    it('should throw ImageValidationError for filename containing directory separators', async () => {
      await expect(service.getArtifact('subdir/image.jpg')).rejects.toThrow(
        ImageValidationError
      );
    });
  });
});
