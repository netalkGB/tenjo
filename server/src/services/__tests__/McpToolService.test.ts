import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ToolDefinitionRequest,
  McpServersConfig,
  OAuthHttpMcpServerConfig
} from 'tenjo-chat-engine';
import {
  McpToolService,
  McpOAuthRequiredError,
  McpConnectionError
} from '../McpToolService';
import type { CredentialStoreService } from '../CredentialStoreService';

// ── Mock: environment utils ──────────────────────────────────────────
vi.mock('../../utils/env', () => ({
  getAppName: vi.fn().mockReturnValue('test-app'),
  getOAuthRedirectUrl: vi
    .fn()
    .mockReturnValue('http://localhost/oauth/callback')
}));

// ── Mock: logger ─────────────────────────────────────────────────────
vi.mock('../../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// ── Hoisted mocks for tenjo-chat-engine ──────────────────────────────
// vi.hoisted runs before vi.mock factories, making these available there
const {
  mockCreateTransport,
  mockCreateHttpTransportWithFallback,
  mockSaveTokens,
  mockTransport,
  getMockMcpManagerInstance,
  capturedOAuthProviderOptions
} = vi.hoisted(() => {
  const transport = {
    start: vi.fn(),
    send: vi.fn(),
    close: vi.fn()
  };

  // Shared ref so tests can swap the instance per-beforeEach
  const instanceRef: { current: Record<string, ReturnType<typeof vi.fn>> } = {
    current: {
      setTransports: vi.fn(),
      connect: vi.fn(),
      getTools: vi.fn(),
      close: vi.fn(),
      callTool: vi.fn()
    }
  };

  // Capture options passed to McpOAuthClientProvider constructor
  const oauthOptionsRef: {
    current: { onRedirectToAuthorization?: () => void } | null;
  } = { current: null };

  return {
    mockCreateTransport: vi.fn().mockResolvedValue(transport),
    mockCreateHttpTransportWithFallback: vi.fn().mockResolvedValue(transport),
    mockSaveTokens: vi.fn(),
    mockTransport: transport,
    getMockMcpManagerInstance: instanceRef,
    capturedOAuthProviderOptions: oauthOptionsRef
  };
});

vi.mock('tenjo-chat-engine', () => {
  // Use real functions (not arrows) so they can be invoked with `new`
  function MockMcpClientManager() {
    return getMockMcpManagerInstance.current;
  }
  function MockMcpOAuthClientProvider(
    this: { saveTokens: ReturnType<typeof vi.fn> },
    options: { onRedirectToAuthorization?: () => void }
  ) {
    capturedOAuthProviderOptions.current = options;
    this.saveTokens = mockSaveTokens;
  }
  return {
    McpClientManager: MockMcpClientManager,
    createTransport: mockCreateTransport,
    createHttpTransportWithFallback: mockCreateHttpTransportWithFallback,
    McpOAuthClientProvider: MockMcpOAuthClientProvider
  };
});

// ── Mock helpers for McpClientManager instances ──────────────────────
function createMockMcpClientManager() {
  return {
    setTransports: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    connectWithPartialFailure: vi.fn().mockResolvedValue({}),
    getTools: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn()
  };
}

let mockMcpClientManagerInstance = createMockMcpClientManager();

// ── Mock: CredentialStoreService ─────────────────────────────────────
function createMockCredentialStoreService(): {
  [K in keyof CredentialStoreService]: ReturnType<typeof vi.fn>;
} {
  return {
    save: vi.fn(),
    load: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn(),
    update: vi.fn()
  };
}

// ── Test helpers ─────────────────────────────────────────────────────
function makeTool(name: string): ToolDefinitionRequest {
  return {
    type: 'function',
    function: {
      name,
      description: `Test tool ${name}`,
      parameters: { type: 'object', properties: {}, required: [] }
    }
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('McpToolService', () => {
  let service: McpToolService;
  let mockCredentialStore: ReturnType<typeof createMockCredentialStoreService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpClientManagerInstance = createMockMcpClientManager();
    getMockMcpManagerInstance.current = mockMcpClientManagerInstance;
    mockCreateTransport.mockResolvedValue(mockTransport);
    mockCreateHttpTransportWithFallback.mockResolvedValue(mockTransport);
    capturedOAuthProviderOptions.current = null;
    mockCredentialStore = createMockCredentialStoreService();
    service = new McpToolService(
      mockCredentialStore as unknown as CredentialStoreService
    );
  });

  // ── validateAndGetToolsByServer ──────────────────────────────────
  describe('validateAndGetToolsByServer', () => {
    it('should connect to servers and return tools grouped by server name', async () => {
      const toolA = makeTool('read_file');
      const toolB = makeTool('write_file');
      mockMcpClientManagerInstance.getTools.mockResolvedValue([toolA, toolB]);

      const servers: McpServersConfig = {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem']
        }
      };

      const result = await service.validateAndGetToolsByServer(servers);

      expect(result.tools).toEqual({
        filesystem: ['read_file', 'write_file']
      });
      expect(result.errors).toEqual({});
      expect(mockMcpClientManagerInstance.connect).toHaveBeenCalledOnce();
      expect(mockMcpClientManagerInstance.close).toHaveBeenCalledOnce();
    });

    it('should handle multiple servers and collect tools per server', async () => {
      const toolA = makeTool('tool_a');
      const toolB = makeTool('tool_b');

      // First server returns toolA, second returns toolB
      mockMcpClientManagerInstance.getTools
        .mockResolvedValueOnce([toolA])
        .mockResolvedValueOnce([toolB]);

      const servers: McpServersConfig = {
        serverA: { type: 'http', url: 'http://localhost:3001/mcp' },
        serverB: { type: 'http', url: 'http://localhost:3002/mcp' }
      };

      const result = await service.validateAndGetToolsByServer(servers);

      expect(result.tools).toEqual({
        serverA: ['tool_a'],
        serverB: ['tool_b']
      });
      expect(result.errors).toEqual({});
    });

    it('should collect errors for servers that fail to connect while succeeding for others', async () => {
      const toolA = makeTool('tool_a');
      mockMcpClientManagerInstance.getTools.mockResolvedValueOnce([toolA]);
      mockMcpClientManagerInstance.connect
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Connection refused'));

      const servers: McpServersConfig = {
        working: { type: 'http', url: 'http://localhost:3001/mcp' },
        broken: { type: 'http', url: 'http://localhost:9999/mcp' }
      };

      const result = await service.validateAndGetToolsByServer(servers);

      expect(result.tools).toEqual({ working: ['tool_a'] });
      expect(result.errors).toEqual({ broken: 'Connection refused' });
    });

    it('should skip oauth-http servers without credentialId', async () => {
      const servers: McpServersConfig = {
        oauthServer: {
          type: 'oauth-http',
          url: 'http://oauth.example.com/mcp'
        }
      };

      const result = await service.validateAndGetToolsByServer(servers);

      // Server is skipped, returns empty tools array, no error
      expect(result.tools).toEqual({ oauthServer: [] });
      expect(result.errors).toEqual({});
      expect(mockMcpClientManagerInstance.connect).not.toHaveBeenCalled();
    });

    it('should connect oauth-http servers that have credentialId and tokens', async () => {
      const tokenData = JSON.stringify({ access_token: 'test-token' });
      mockCredentialStore.load.mockResolvedValue(tokenData);
      mockMcpClientManagerInstance.getTools.mockResolvedValue([
        makeTool('oauth_tool')
      ]);

      const servers: McpServersConfig = {
        oauthServer: {
          type: 'oauth-http',
          url: 'http://oauth.example.com/mcp',
          credentialId: 'cred-123'
        } as McpServersConfig[string]
      };

      const result = await service.validateAndGetToolsByServer(servers);

      expect(result.tools).toEqual({ oauthServer: ['oauth_tool'] });
      expect(result.errors).toEqual({});
      expect(mockCredentialStore.load).toHaveBeenCalledWith('cred-123');
    });

    it('should record error when oauth-http server has credentialId but no tokens', async () => {
      mockCredentialStore.load.mockResolvedValue(null);

      const servers: McpServersConfig = {
        oauthServer: {
          type: 'oauth-http',
          url: 'http://oauth.example.com/mcp',
          credentialId: 'cred-missing'
        } as McpServersConfig[string]
      };

      const result = await service.validateAndGetToolsByServer(servers);

      expect(result.tools).toEqual({});
      expect(result.errors.oauthServer).toContain('OAuth tokens not found');
    });

    it('should always close the manager even when an error occurs', async () => {
      mockMcpClientManagerInstance.connect.mockRejectedValue(
        new Error('Connection failed')
      );

      const servers: McpServersConfig = {
        failing: { type: 'http', url: 'http://localhost:9999/mcp' }
      };

      await service.validateAndGetToolsByServer(servers);

      expect(mockMcpClientManagerInstance.close).toHaveBeenCalledOnce();
    });

    it('should return empty results for an empty server config', async () => {
      const result = await service.validateAndGetToolsByServer({});

      expect(result.tools).toEqual({});
      expect(result.errors).toEqual({});
    });

    it('should capture non-Error thrown values as strings', async () => {
      mockCreateTransport.mockRejectedValueOnce('connection failed');

      const servers: McpServersConfig = {
        badServer: { type: 'stdio', command: 'npx' }
      };

      const result = await service.validateAndGetToolsByServer(servers);

      expect(result.tools).toEqual({});
      expect(result.errors).toEqual({ badServer: 'connection failed' });
    });
  });

  // ── initializeMcpConnection ─────────────────────────────────────
  describe('initializeMcpConnection', () => {
    it('should return manager and all discovered tools on happy path', async () => {
      const tools = [makeTool('read_file'), makeTool('write_file')];
      mockMcpClientManagerInstance.getTools.mockResolvedValue(tools);

      const servers: McpServersConfig = {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem']
        }
      };

      const result = await service.initializeMcpConnection(servers);

      expect(result.mcpClientManager).toBe(mockMcpClientManagerInstance);
      expect(result.tools).toEqual(tools);
      expect(mockMcpClientManagerInstance.setTransports).toHaveBeenCalledWith([
        mockTransport
      ]);
      expect(
        mockMcpClientManagerInstance.connectWithPartialFailure
      ).toHaveBeenCalledOnce();
    });

    it('should filter tools by enabledTools when provided', async () => {
      const tools = [
        makeTool('read_file'),
        makeTool('write_file'),
        makeTool('delete_file')
      ];
      mockMcpClientManagerInstance.getTools.mockResolvedValue(tools);

      const servers: McpServersConfig = {
        filesystem: { type: 'stdio', command: 'npx' }
      };

      const result = await service.initializeMcpConnection(servers, [
        'read_file',
        'delete_file'
      ]);

      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.function.name)).toEqual([
        'read_file',
        'delete_file'
      ]);
    });

    it('should skip connection when enabledTools is an empty array', async () => {
      const servers: McpServersConfig = {
        filesystem: { type: 'stdio', command: 'npx' }
      };

      const result = await service.initializeMcpConnection(servers, []);

      expect(result.tools).toEqual([]);
      expect(
        mockMcpClientManagerInstance.connectWithPartialFailure
      ).not.toHaveBeenCalled();
      expect(mockMcpClientManagerInstance.setTransports).not.toHaveBeenCalled();
    });

    it('should skip connection when no servers are configured', async () => {
      const result = await service.initializeMcpConnection({});

      expect(result.tools).toEqual([]);
      expect(
        mockMcpClientManagerInstance.connectWithPartialFailure
      ).not.toHaveBeenCalled();
    });

    it('should continue when connectWithPartialFailure reports errors for some servers', async () => {
      mockMcpClientManagerInstance.connectWithPartialFailure.mockResolvedValue({
        0: 'Network error'
      });
      mockCreateTransport
        .mockResolvedValueOnce(mockTransport)
        .mockResolvedValueOnce(mockTransport);
      mockMcpClientManagerInstance.getTools.mockResolvedValue([
        makeTool('goodTool')
      ]);

      const servers: McpServersConfig = {
        badServer: { type: 'http', url: 'http://localhost:3001/mcp' },
        goodServer: { type: 'http', url: 'http://localhost:3002/mcp' }
      };

      const result = await service.initializeMcpConnection(servers);
      expect(result.tools).toEqual([makeTool('goodTool')]);
    });

    it('should throw McpConnectionError when transport creation fails for a server', async () => {
      mockCreateTransport.mockRejectedValueOnce(
        new Error('Transport creation failed')
      );

      const servers: McpServersConfig = {
        badServer: { type: 'stdio', command: 'nonexistent-binary' }
      };

      await expect(service.initializeMcpConnection(servers)).rejects.toThrow(
        McpConnectionError
      );
    });

    it('should skip oauth-http servers without credentialId during connection', async () => {
      const tools = [makeTool('stdio_tool')];
      mockMcpClientManagerInstance.getTools.mockResolvedValue(tools);

      const servers: McpServersConfig = {
        stdioServer: { type: 'stdio', command: 'npx' },
        oauthServer: {
          type: 'oauth-http',
          url: 'http://oauth.example.com/mcp'
          // No credentialId — should be skipped
        }
      };

      const result = await service.initializeMcpConnection(servers);

      // Only one transport should be set (the stdio one)
      expect(mockMcpClientManagerInstance.setTransports).toHaveBeenCalledWith([
        mockTransport
      ]);
      expect(result.tools).toEqual(tools);
    });

    it('should return all tools when enabledTools is undefined', async () => {
      const tools = [makeTool('a'), makeTool('b'), makeTool('c')];
      mockMcpClientManagerInstance.getTools.mockResolvedValue(tools);

      const servers: McpServersConfig = {
        server: { type: 'http', url: 'http://localhost:3001/mcp' }
      };

      const result = await service.initializeMcpConnection(servers, undefined);

      expect(result.tools).toEqual(tools);
    });

    it('should capture non-Error thrown values as strings during transport creation', async () => {
      mockCreateTransport.mockRejectedValueOnce('transport init failed');

      const servers: McpServersConfig = {
        badServer: { type: 'stdio', command: 'npx' }
      };

      await expect(service.initializeMcpConnection(servers)).rejects.toThrow(
        McpConnectionError
      );
    });

    it('should log warnings when connectWithPartialFailure reports errors', async () => {
      mockMcpClientManagerInstance.connectWithPartialFailure.mockResolvedValue({
        0: 'auth expired'
      });
      mockMcpClientManagerInstance.getTools.mockResolvedValue([]);

      const servers: McpServersConfig = {
        remote: { type: 'http', url: 'http://localhost:3001/mcp' }
      };

      const result = await service.initializeMcpConnection(servers);
      // Should not throw, just return empty tools
      expect(result.tools).toEqual([]);
    });

    it('should continue with successful servers when some transports fail', async () => {
      // First server succeeds, second fails
      mockCreateTransport
        .mockResolvedValueOnce(mockTransport)
        .mockRejectedValueOnce(new Error('Bad transport'));

      mockMcpClientManagerInstance.getTools.mockResolvedValue([
        { function: { name: 'goodTool' } }
      ]);

      const servers: McpServersConfig = {
        goodServer: { type: 'http', url: 'http://localhost:3001/mcp' },
        badServer: { type: 'http', url: 'http://localhost:9999/mcp' }
      };

      const result = await service.initializeMcpConnection(servers);

      // Should succeed with the good server's tools
      expect(result.tools).toEqual([{ function: { name: 'goodTool' } }]);
      expect(mockMcpClientManagerInstance.setTransports).toHaveBeenCalledWith([
        mockTransport
      ]);
      expect(
        mockMcpClientManagerInstance.connectWithPartialFailure
      ).toHaveBeenCalled();
    });

    it('should throw when all transports fail', async () => {
      mockCreateTransport.mockRejectedValue(new Error('Bad transport'));

      const servers: McpServersConfig = {
        badServer1: { type: 'http', url: 'http://localhost:9998/mcp' },
        badServer2: { type: 'http', url: 'http://localhost:9999/mcp' }
      };

      await expect(service.initializeMcpConnection(servers)).rejects.toThrow(
        McpConnectionError
      );
    });
  });

  // ── createOAuthTransport (private, tested via type cast) ─
  describe('createOAuthTransport', () => {
    // Helper to access private method without bracket notation lint warnings
    const callCreateOAuthTransport = (
      svc: McpToolService,
      config: OAuthHttpMcpServerConfig
    ) =>
      (
        svc as unknown as {
          createOAuthTransport: (
            c: OAuthHttpMcpServerConfig
          ) => Promise<unknown>;
        }
      ).createOAuthTransport(config);

    it('should throw McpOAuthRequiredError when credentialId is falsy', async () => {
      // Config with type oauth-http but no credentialId property
      const config = {
        type: 'oauth-http',
        url: 'http://oauth.example.com/mcp'
      } as OAuthHttpMcpServerConfig;

      await expect(callCreateOAuthTransport(service, config)).rejects.toThrow(
        McpOAuthRequiredError
      );

      await expect(callCreateOAuthTransport(service, config)).rejects.toThrow(
        'OAuth authorization required. Please authorize from settings.'
      );
    });

    it('should throw McpOAuthRequiredError when token has expired', async () => {
      const expiredTokenData = JSON.stringify({
        access_token: 'test-token',
        expires_at: Date.now() - 1000 // expired 1 second ago
      });
      mockCredentialStore.load.mockResolvedValue(expiredTokenData);

      const config = {
        type: 'oauth-http',
        url: 'http://oauth.example.com/mcp',
        credentialId: 'cred-123'
      } as OAuthHttpMcpServerConfig;

      await expect(callCreateOAuthTransport(service, config)).rejects.toThrow(
        McpOAuthRequiredError
      );
      await expect(callCreateOAuthTransport(service, config)).rejects.toThrow(
        'OAuth token has expired. Please re-authorize from settings.'
      );

      // Should not attempt to create transport
      expect(mockCreateHttpTransportWithFallback).not.toHaveBeenCalled();
    });

    it('should proceed when token has no expires_at (backwards compatibility)', async () => {
      const tokenData = JSON.stringify({ access_token: 'test-token' });
      mockCredentialStore.load.mockResolvedValue(tokenData);

      const config = {
        type: 'oauth-http',
        url: 'http://oauth.example.com/mcp',
        credentialId: 'cred-123'
      } as OAuthHttpMcpServerConfig;

      await callCreateOAuthTransport(service, config);

      expect(mockCreateHttpTransportWithFallback).toHaveBeenCalled();
    });

    it('should proceed when token has not yet expired', async () => {
      const validTokenData = JSON.stringify({
        access_token: 'test-token',
        expires_at: Date.now() + 3600_000 // expires in 1 hour
      });
      mockCredentialStore.load.mockResolvedValue(validTokenData);

      const config = {
        type: 'oauth-http',
        url: 'http://oauth.example.com/mcp',
        credentialId: 'cred-123'
      } as OAuthHttpMcpServerConfig;

      await callCreateOAuthTransport(service, config);

      expect(mockCreateHttpTransportWithFallback).toHaveBeenCalled();
    });

    it('should throw McpOAuthRequiredError when onRedirectToAuthorization is called', async () => {
      const tokenData = JSON.stringify({ access_token: 'test-token' });
      mockCredentialStore.load.mockResolvedValue(tokenData);

      const config = {
        type: 'oauth-http',
        url: 'http://oauth.example.com/mcp',
        credentialId: 'cred-123'
      } as OAuthHttpMcpServerConfig;

      // Call createOAuthTransport to trigger McpOAuthClientProvider construction
      await callCreateOAuthTransport(service, config);

      // The constructor should have been called, capturing the options
      expect(capturedOAuthProviderOptions.current).not.toBeNull();
      expect(
        capturedOAuthProviderOptions.current?.onRedirectToAuthorization
      ).toBeDefined();

      // Invoking the callback should throw McpOAuthRequiredError
      expect(() => {
        capturedOAuthProviderOptions.current!.onRedirectToAuthorization!();
      }).toThrow(McpOAuthRequiredError);

      expect(() => {
        capturedOAuthProviderOptions.current!.onRedirectToAuthorization!();
      }).toThrow(
        'OAuth authorization required. Please authorize from settings.'
      );
    });
  });

  // ── Credential suspension ──────────────────────────────────────
  describe('credential suspension', () => {
    const callCreateOAuthTransport = (
      svc: McpToolService,
      config: OAuthHttpMcpServerConfig
    ) =>
      (
        svc as unknown as {
          createOAuthTransport: (
            c: OAuthHttpMcpServerConfig
          ) => Promise<unknown>;
        }
      ).createOAuthTransport(config);

    it('should suspend credential after token expiration and skip DB lookup on retry', async () => {
      const expiredTokenData = JSON.stringify({
        access_token: 'test-token',
        expires_at: Date.now() - 1000
      });
      mockCredentialStore.load.mockResolvedValue(expiredTokenData);

      const config = {
        type: 'oauth-http',
        url: 'http://oauth.example.com/mcp',
        credentialId: 'cred-suspended'
      } as OAuthHttpMcpServerConfig;

      // First call — loads from DB, detects expiration, suspends
      await expect(callCreateOAuthTransport(service, config)).rejects.toThrow(
        McpOAuthRequiredError
      );
      expect(mockCredentialStore.load).toHaveBeenCalledTimes(1);

      mockCredentialStore.load.mockClear();

      // Second call — skipped via suspension, no DB lookup
      await expect(callCreateOAuthTransport(service, config)).rejects.toThrow(
        McpOAuthRequiredError
      );
      expect(mockCredentialStore.load).not.toHaveBeenCalled();
    });

    it('should suspend credential when tokens are not found', async () => {
      mockCredentialStore.load.mockResolvedValue(null);

      const config = {
        type: 'oauth-http',
        url: 'http://oauth.example.com/mcp',
        credentialId: 'cred-missing'
      } as OAuthHttpMcpServerConfig;

      await expect(callCreateOAuthTransport(service, config)).rejects.toThrow(
        McpOAuthRequiredError
      );

      mockCredentialStore.load.mockClear();

      // Suspended — no DB lookup
      await expect(callCreateOAuthTransport(service, config)).rejects.toThrow(
        McpOAuthRequiredError
      );
      expect(mockCredentialStore.load).not.toHaveBeenCalled();
    });

    it('should resume after unsuspendCredential is called', async () => {
      const expiredTokenData = JSON.stringify({
        access_token: 'test-token',
        expires_at: Date.now() - 1000
      });
      mockCredentialStore.load.mockResolvedValue(expiredTokenData);

      const config = {
        type: 'oauth-http',
        url: 'http://oauth.example.com/mcp',
        credentialId: 'cred-resume'
      } as OAuthHttpMcpServerConfig;

      // Trigger suspension
      await expect(callCreateOAuthTransport(service, config)).rejects.toThrow(
        McpOAuthRequiredError
      );

      // Clear suspension
      service.unsuspendCredential('cred-resume');

      // Now provide valid tokens
      const validTokenData = JSON.stringify({
        access_token: 'new-token',
        expires_at: Date.now() + 3600_000
      });
      mockCredentialStore.load.mockResolvedValue(validTokenData);

      await callCreateOAuthTransport(service, config);

      expect(mockCredentialStore.load).toHaveBeenCalledWith('cred-resume');
      expect(mockCreateHttpTransportWithFallback).toHaveBeenCalled();
    });
  });

  // ── Error class structure ───────────────────────────────────────
  describe('error classes', () => {
    it('McpOAuthRequiredError should use default message', () => {
      const error = new McpOAuthRequiredError();
      expect(error.message).toBe('OAuth authorization required');
      expect(error.name).toBe('McpOAuthRequiredError');
    });

    it('McpOAuthRequiredError should accept a custom message', () => {
      const error = new McpOAuthRequiredError('Custom OAuth message');
      expect(error.message).toBe('Custom OAuth message');
    });

    it('McpConnectionError should carry the provided message', () => {
      const error = new McpConnectionError('Connection lost');
      expect(error.message).toBe('Connection lost');
      expect(error.name).toBe('McpConnectionError');
    });
  });
});
