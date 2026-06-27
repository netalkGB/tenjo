import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type AgentIdleReaperModule = typeof import('../AgentIdleReaperService');

async function loadService(): Promise<AgentIdleReaperModule> {
  vi.resetModules();
  vi.doMock('../../logger', () => ({
    default: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
  }));

  return import('../AgentIdleReaperService');
}

describe('AgentIdleReaperService', () => {
  const originalIdleStopMs = process.env.AGENT_IDLE_STOP_MS;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    process.env.AGENT_IDLE_STOP_MS = '100';
  });

  afterEach(() => {
    if (originalIdleStopMs === undefined) {
      delete process.env.AGENT_IDLE_STOP_MS;
    } else {
      process.env.AGENT_IDLE_STOP_MS = originalIdleStopMs;
    }
    vi.useRealTimers();
    vi.doUnmock('../../logger');
    vi.resetModules();
  });

  describe('startIdleReaper', () => {
    it('should stop a touched project after it becomes idle', async () => {
      const service = await loadService();
      const stop = vi.fn().mockResolvedValue(undefined);
      service.startIdleReaper({
        isActive: () => false,
        hasViewer: () => false,
        stop
      });

      service.touch('project-1');
      await vi.advanceTimersByTimeAsync(60_000);

      expect(stop).toHaveBeenCalledWith('project-1');
      service.stopIdleReaper();
    });

    it('should refresh activity while the project is active', async () => {
      const service = await loadService();
      const stop = vi.fn().mockResolvedValue(undefined);
      let active = true;
      service.startIdleReaper({
        isActive: () => active,
        hasViewer: () => false,
        stop
      });

      service.touch('project-1');
      await vi.advanceTimersByTimeAsync(60_000);
      active = false;
      expect(stop).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(stop).toHaveBeenCalledWith('project-1');
      service.stopIdleReaper();
    });

    it('should refresh activity while a preview viewer is connected', async () => {
      const service = await loadService();
      const stop = vi.fn().mockResolvedValue(undefined);
      let hasViewer = true;
      service.startIdleReaper({
        isActive: () => false,
        hasViewer: () => hasViewer,
        stop
      });

      service.touch('project-1');
      await vi.advanceTimersByTimeAsync(60_000);
      hasViewer = false;
      expect(stop).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(stop).toHaveBeenCalledWith('project-1');
      service.stopIdleReaper();
    });

    it('should start the interval only once', async () => {
      const service = await loadService();
      const stop = vi.fn().mockResolvedValue(undefined);
      const deps = {
        isActive: () => false,
        hasViewer: () => false,
        stop
      };

      service.startIdleReaper(deps);
      service.startIdleReaper(deps);

      expect(vi.getTimerCount()).toBe(1);
      service.stopIdleReaper();
    });
  });
});
