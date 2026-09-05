import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type AgentSandboxModule = typeof import('../AgentSandboxService');

type MockSandboxManager = {
  isDockerAvailable: ReturnType<typeof vi.fn>;
  prewarm: ReturnType<typeof vi.fn>;
};

const RESOURCE_ENV_KEYS = [
  'AGENT_SANDBOX_PORTS',
  'AGENT_SANDBOX_VNC_HOST',
  'AGENT_SANDBOX_HOST',
  'AGENT_GUI_KEYBOARD'
] as const;

const createMockSandboxManager = (): MockSandboxManager => ({
  isDockerAvailable: vi.fn(),
  prewarm: vi.fn()
});

class MockSandboxError extends Error {
  override name = 'SandboxError';
}

async function loadService(manager: MockSandboxManager): Promise<{
  module: AgentSandboxModule;
  SandboxManager: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const SandboxManager = vi.fn(function SandboxManagerMock() {
    return manager;
  });

  vi.doMock('tenjo-chat-engine', () => ({
    SandboxManager,
    // Service uses `error instanceof SandboxError`; the mock must export it.
    SandboxError: MockSandboxError
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
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of RESOURCE_ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of RESOURCE_ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    vi.doUnmock('tenjo-chat-engine');
    vi.doUnmock('../../logger');
    vi.resetModules();
  });

  describe('SandboxManager options', () => {
    it('should initialize without CPU or memory limits', async () => {
      const manager = createMockSandboxManager();
      const { SandboxManager } = await loadService(manager);

      expect(SandboxManager).toHaveBeenCalledWith({
        portMode: 'vnc-single',
        publishPorts: [],
        guiKeyboard: undefined
      });
    });

    it('should expose AGENT_SANDBOX_VNC_HOST without changing SandboxManager ports', async () => {
      process.env.AGENT_SANDBOX_VNC_HOST = 'host.docker.internal';
      const manager = createMockSandboxManager();
      const { module, SandboxManager } = await loadService(manager);

      expect(module.SANDBOX_VNC_HOST).toBe('host.docker.internal');
      expect(SandboxManager).toHaveBeenCalledWith({
        portMode: 'vnc-single',
        publishPorts: [],
        guiKeyboard: undefined
      });
    });

    it('should pass AGENT_SANDBOX_PORTS and AGENT_GUI_KEYBOARD when set', async () => {
      process.env.AGENT_SANDBOX_PORTS = '127.0.0.1:6000-6010:6000-6010';
      process.env.AGENT_GUI_KEYBOARD = 'us';
      const manager = createMockSandboxManager();
      const { SandboxManager } = await loadService(manager);

      expect(SandboxManager).toHaveBeenCalledWith({
        portMode: 'vnc-single',
        publishPorts: ['127.0.0.1:6000-6010:6000-6010'],
        guiKeyboard: 'us'
      });
    });
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
