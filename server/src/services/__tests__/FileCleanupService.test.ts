import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileCleanupService } from '../FileCleanupService';
import type { CleanupStatus } from '../FileCleanupService';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  default: {
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ isFile: () => true, size: 1024 }),
    unlink: vi.fn().mockResolvedValue(undefined)
  }
}));

// Mock env utils
vi.mock('../../utils/env', () => ({
  getDataDir: vi.fn().mockReturnValue('/mock/data')
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

import fs from 'node:fs/promises';

function createMockPool(imageFilenames: string[], knowledgePaths: string[]) {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('messages')) {
        return {
          rows: imageFilenames.map((f) => ({ filename: f }))
        };
      }
      if (sql.includes('knowledge')) {
        return {
          rows: knowledgePaths.map((p) => ({ fs_path: p }))
        };
      }
      return { rows: [] };
    })
  };
}

function createMockGlobalSettingRepo(cleaning = false) {
  const settingsState: Record<string, unknown> = cleaning
    ? { cleaning: true }
    : {};

  return {
    getSettings: vi.fn().mockImplementation(() => ({ ...settingsState })),
    getOrCreateSettings: vi
      .fn()
      .mockImplementation(() => ({ ...settingsState })),
    updateSettings: vi
      .fn()
      .mockImplementation((settings: Record<string, unknown>) => {
        Object.assign(settingsState, settings);
        // If cleaning key was removed, remove from state too
        if (!('cleaning' in settings)) {
          delete settingsState.cleaning;
        }
      })
  };
}

describe('FileCleanupService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStatus', () => {
    it('should return cleaning: false and totalSizeBytes when not cleaning', async () => {
      const mockPool = createMockPool([], []);
      const mockRepo = createMockGlobalSettingRepo(false);

      vi.mocked(fs.readdir).mockResolvedValue([
        'file1.jpg',
        'file2.png'
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.stat).mockResolvedValue({
        isFile: () => true,
        size: 500
      } as Awaited<ReturnType<typeof fs.stat>>);

      const service = new FileCleanupService(
        mockPool as never,
        mockRepo as never
      );
      const status: CleanupStatus = await service.getStatus();

      expect(status.cleaning).toBe(false);
      expect(status.totalSizeBytes).toBe(1000);
    });

    it('should return cleaning: true when cleanup is in progress', async () => {
      const mockPool = createMockPool([], []);
      const mockRepo = createMockGlobalSettingRepo(true);

      vi.mocked(fs.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
      );

      const service = new FileCleanupService(
        mockPool as never,
        mockRepo as never
      );
      const status = await service.getStatus();

      expect(status.cleaning).toBe(true);
      expect(status.totalSizeBytes).toBe(0);
    });

    it('should return 0 bytes when artifacts directory does not exist', async () => {
      const mockPool = createMockPool([], []);
      const mockRepo = createMockGlobalSettingRepo(false);

      vi.mocked(fs.readdir).mockRejectedValue(new Error('ENOENT'));

      const service = new FileCleanupService(
        mockPool as never,
        mockRepo as never
      );
      const status = await service.getStatus();

      expect(status.totalSizeBytes).toBe(0);
    });
  });

  describe('startCleanup', () => {
    it('should set cleaning flag and trigger background cleanup', async () => {
      const mockPool = createMockPool([], []);
      const mockRepo = createMockGlobalSettingRepo(false);

      vi.mocked(fs.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
      );

      const service = new FileCleanupService(
        mockPool as never,
        mockRepo as never
      );
      await service.startCleanup('user-1');

      // cleaning flag should have been set
      expect(mockRepo.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ cleaning: true }),
        'user-1'
      );
    });
  });

  describe('performCleanup (via startCleanup)', () => {
    it('should delete orphaned files and clear cleaning flag', async () => {
      const mockPool = createMockPool(
        ['referenced.jpg'],
        ['/mock/data/artifacts/knowledge.txt']
      );
      const mockRepo = createMockGlobalSettingRepo(false);

      vi.mocked(fs.readdir).mockResolvedValue([
        'referenced.jpg',
        'orphan.png',
        'knowledge.txt'
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.stat).mockResolvedValue({
        isFile: () => true,
        size: 1024
      } as Awaited<ReturnType<typeof fs.stat>>);

      const service = new FileCleanupService(
        mockPool as never,
        mockRepo as never
      );
      await service.startCleanup('user-1');

      // Wait for background task
      await vi.waitFor(() => {
        // Should delete only orphan.png
        expect(fs.unlink).toHaveBeenCalledTimes(1);
        expect(fs.unlink).toHaveBeenCalledWith(
          expect.stringContaining('orphan.png')
        );
      });

      // Cleaning flag should be cleared (settings without cleaning key)
      await vi.waitFor(() => {
        const lastCall =
          mockRepo.updateSettings.mock.calls[
            mockRepo.updateSettings.mock.calls.length - 1
          ];
        expect(lastCall).toBeDefined();
        expect(lastCall![0]).not.toHaveProperty('cleaning');
      });
    });

    it('should not delete files referenced in messages', async () => {
      const mockPool = createMockPool(['image1.jpg', 'image2.png'], []);
      const mockRepo = createMockGlobalSettingRepo(false);

      vi.mocked(fs.readdir).mockResolvedValue([
        'image1.jpg',
        'image2.png'
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      const service = new FileCleanupService(
        mockPool as never,
        mockRepo as never
      );
      await service.startCleanup('user-1');

      // Wait for background task
      await vi.waitFor(() => {
        const lastCall =
          mockRepo.updateSettings.mock.calls[
            mockRepo.updateSettings.mock.calls.length - 1
          ];
        expect(lastCall).toBeDefined();
        expect(lastCall![0]).not.toHaveProperty('cleaning');
      });

      // Nothing should be deleted
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('should not delete files referenced in knowledge', async () => {
      const mockPool = createMockPool([], ['/mock/data/artifacts/doc.txt']);
      const mockRepo = createMockGlobalSettingRepo(false);

      vi.mocked(fs.readdir).mockResolvedValue(['doc.txt'] as unknown as Awaited<
        ReturnType<typeof fs.readdir>
      >);

      const service = new FileCleanupService(
        mockPool as never,
        mockRepo as never
      );
      await service.startCleanup('user-1');

      await vi.waitFor(() => {
        const lastCall =
          mockRepo.updateSettings.mock.calls[
            mockRepo.updateSettings.mock.calls.length - 1
          ];
        expect(lastCall).toBeDefined();
        expect(lastCall![0]).not.toHaveProperty('cleaning');
      });

      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('should handle empty artifacts directory gracefully', async () => {
      const mockPool = createMockPool([], []);
      const mockRepo = createMockGlobalSettingRepo(false);

      vi.mocked(fs.readdir).mockRejectedValue(new Error('ENOENT'));

      const service = new FileCleanupService(
        mockPool as never,
        mockRepo as never
      );
      await service.startCleanup('user-1');

      await vi.waitFor(() => {
        const lastCall =
          mockRepo.updateSettings.mock.calls[
            mockRepo.updateSettings.mock.calls.length - 1
          ];
        expect(lastCall).toBeDefined();
        expect(lastCall![0]).not.toHaveProperty('cleaning');
      });

      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('should continue deleting when a single file fails', async () => {
      const mockPool = createMockPool([], []);
      const mockRepo = createMockGlobalSettingRepo(false);

      vi.mocked(fs.readdir).mockResolvedValue([
        'fail.png',
        'ok.jpg'
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.stat).mockResolvedValue({
        isFile: () => true,
        size: 512
      } as Awaited<ReturnType<typeof fs.stat>>);
      vi.mocked(fs.unlink)
        .mockRejectedValueOnce(new Error('Permission denied'))
        .mockResolvedValueOnce(undefined);

      const service = new FileCleanupService(
        mockPool as never,
        mockRepo as never
      );
      await service.startCleanup('user-1');

      await vi.waitFor(() => {
        expect(fs.unlink).toHaveBeenCalledTimes(2);
      });
    });
  });
});
