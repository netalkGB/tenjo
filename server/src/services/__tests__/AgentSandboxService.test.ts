import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type AgentSandboxModule = typeof import('../AgentSandboxService');

type MockSandboxManager = {
  isDockerAvailable: ReturnType<typeof vi.fn>;
  prewarm: ReturnType<typeof vi.fn>;
};

const createMockSandboxManager = (): MockSandboxManager => ({
  isDockerAvailable: vi.fn(),
  prewarm: vi.fn()
});

async function loadService(manager: MockSandboxManager): Promise<{
  module: AgentSandboxModule;
  SandboxManager: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const SandboxManager = vi.fn(function SandboxManagerMock() {
    return manager;
  });

  vi.doMock('tenjo-chat-engine', () => ({
    SandboxManager
  }));
  vi.doMock('../../logger', () => ({
    default: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
  }));

  const module = await import('../AgentSandboxService');
  return { module, SandboxManager };
}

describe('AgentSandboxService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('tenjo-chat-engine');
    vi.doUnmock('../../logger');
    vi.resetModules();
  });

  describe('getSandboxStatus', () => {
    it('should start with unknown status', async () => {
      const manager = createMockSandboxManager();
      const { module } = await loadService(manager);

      expect(module.getSandboxStatus()).toEqual({ status: 'unknown' });
      expect(module.isAgentSandboxReady()).toBe(false);
      expect(module.isAgentSandboxUsable()).toBe(true);
    });
  });

  describe('initAgentSandbox', () => {
    it('should set unavailable when Docker is not available', async () => {
      const manager = createMockSandboxManager();
      manager.isDockerAvailable.mockResolvedValue(false);
      const { module } = await loadService(manager);

      await module.initAgentSandbox();

      expect(module.getSandboxStatus()).toEqual({
        status: 'unavailable',
        detail: 'Docker is not available.'
      });
      expect(module.isAgentSandboxReady()).toBe(false);
      expect(module.isAgentSandboxUsable()).toBe(false);
      expect(manager.prewarm).not.toHaveBeenCalled();
    });

    it('should publish preparing phases and become ready', async () => {
      const manager = createMockSandboxManager();
      manager.isDockerAvailable.mockResolvedValue(true);
      manager.prewarm.mockImplementation(
        async (
          onPhase: (
            phase:
              | 'building-image'
              | 'starting-container'
              | 'building-toolchain'
          ) => void
        ) => {
          onPhase('starting-container');
          onPhase('building-toolchain');
        }
      );
      const { module } = await loadService(manager);
      const events: ReturnType<typeof module.getSandboxStatus>[] = [];
      module.onSandboxStatusChange((info) => {
        events.push(info);
      });

      await module.initAgentSandbox();

      expect(module.getSandboxStatus()).toMatchObject({ status: 'ready' });
      expect(module.isAgentSandboxReady()).toBe(true);
      expect(module.isAgentSandboxUsable()).toBe(true);
      expect(events).toEqual([
        expect.objectContaining({
          status: 'preparing',
          detail: expect.stringContaining('Building the sandbox image')
        }),
        expect.objectContaining({
          status: 'preparing',
          detail: expect.stringContaining('Starting the sandbox container')
        }),
        expect.objectContaining({
          status: 'preparing',
          detail: expect.stringContaining(
            'Building the project toolchain image'
          )
        }),
        expect.objectContaining({ status: 'ready' })
      ]);
    });

    it('should set unavailable when prewarm fails', async () => {
      const manager = createMockSandboxManager();
      manager.isDockerAvailable.mockResolvedValue(true);
      manager.prewarm.mockRejectedValue(new Error('prewarm failed'));
      const { module } = await loadService(manager);

      await module.initAgentSandbox();

      expect(module.getSandboxStatus()).toEqual({
        status: 'unavailable',
        detail: 'Sandbox setup failed.'
      });
      expect(module.isAgentSandboxReady()).toBe(false);
      expect(module.isAgentSandboxUsable()).toBe(false);
    });

    it('should initialize only once', async () => {
      const manager = createMockSandboxManager();
      manager.isDockerAvailable.mockResolvedValue(true);
      manager.prewarm.mockResolvedValue(undefined);
      const { module } = await loadService(manager);

      await module.initAgentSandbox();
      await module.initAgentSandbox();

      expect(manager.isDockerAvailable).toHaveBeenCalledTimes(1);
      expect(manager.prewarm).toHaveBeenCalledTimes(1);
    });
  });
});
