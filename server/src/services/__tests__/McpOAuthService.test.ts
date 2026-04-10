import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  McpOAuthService,
  McpOAuthError,
  McpOAuthStateNotFoundError,
  McpOAuthTokenError,
  type OAuthAuthorizeParams,
  type OAuthCallbackParams
} from '../McpOAuthService';
import type { GlobalSettingService } from '../GlobalSettingService';
import type { CredentialStoreService } from '../CredentialStoreService';
import type {
  PendingOAuthFlowService,
  PendingOAuthFlowEntry
} from '../PendingOAuthFlowService';

// ---- Module mocks ----

// Mock env utils
vi.mock('../../utils/env', () => ({
  getAppName: vi.fn().mockReturnValue('test-app'),
  getOAuthRedirectUrl: vi
    .fn()
    .mockReturnValue('http://localhost:3000/api/settings/mcp-oauth/callback')
}));

// Mock logger
vi.mock('../../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// Capture the onRedirectToAuthorization callback so tests can invoke it
let capturedOnRedirect: ((url: URL) => void) | undefined;
let mockClientInfo: { client_id: string; client_secret?: string } | undefined;
let mockCodeVerifier: string;
let mockTokens: Record<string, string> | undefined;

vi.mock('tenjo-chat-engine', () => {
  // Must use function (not arrow) so it can be called with `new`
  const MockProvider = vi.fn(function (
    this: Record<string, unknown>,
    ctx: { onRedirectToAuthorization: (url: URL) => void }
  ) {
    capturedOnRedirect = ctx.onRedirectToAuthorization;
    this.clientInformation = vi.fn(() => mockClientInfo);
    this.codeVerifier = vi.fn(() => mockCodeVerifier);
    this.tokens = vi.fn(() => mockTokens);
    this.saveClientInformation = vi.fn();
    this.saveCodeVerifier = vi.fn();
  });
  return { McpOAuthClientProvider: MockProvider };
});

// Track transport instances
const mockTransportStart = vi.fn();
const mockTransportClose = vi.fn();
const mockTransportFinishAuth = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => {
  // Must use function (not arrow) so it can be called with `new`
  const MockTransport = vi.fn(function (this: Record<string, unknown>) {
    this.start = mockTransportStart;
    this.close = mockTransportClose;
    this.finishAuth = mockTransportFinishAuth;
  });
  return { SSEClientTransport: MockTransport };
});

// Mock crypto.randomUUID
vi.mock('node:crypto', () => ({
  default: {
    randomUUID: vi.fn().mockReturnValue('test-uuid-1234')
  }
}));

// ---- Helper factories ----

function createMockGlobalSettingService() {
  return {
    getMcpServersConfig: vi.fn(),
    updateMcpServersConfig: vi.fn()
  };
}

function createMockCredentialStoreService() {
  return {
    save: vi.fn(),
    delete: vi.fn()
  };
}

function createMockPendingOAuthFlowService() {
  return {
    save: vi.fn(),
    load: vi.fn(),
    delete: vi.fn()
  };
}

describe('McpOAuthService', () => {
  let mockGlobalSettingService: ReturnType<
    typeof createMockGlobalSettingService
  >;
  let mockCredentialStoreService: ReturnType<
    typeof createMockCredentialStoreService
  >;
  let mockPendingOAuthFlowService: ReturnType<
    typeof createMockPendingOAuthFlowService
  >;
  let service: McpOAuthService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset per-test state
    capturedOnRedirect = undefined;
    mockClientInfo = { client_id: 'dyn-client', client_secret: 'dyn-secret' };
    mockCodeVerifier = 'pkce-verifier';
    mockTokens = undefined;

    mockGlobalSettingService = createMockGlobalSettingService();
    mockCredentialStoreService = createMockCredentialStoreService();
    mockPendingOAuthFlowService = createMockPendingOAuthFlowService();

    service = new McpOAuthService(
      mockGlobalSettingService as unknown as GlobalSettingService,
      mockCredentialStoreService as unknown as CredentialStoreService,
      mockPendingOAuthFlowService as unknown as PendingOAuthFlowService
    );
  });

  // ---- authorize ----

  describe('authorize', () => {
    const params: OAuthAuthorizeParams = {
      serverName: 'my-mcp-server',
      url: 'https://mcp.example.com/sse',
      clientId: 'client-123',
      clientSecret: 'secret-456'
    };
    const userId = 'user-abc';

    it('should return authorization URL and stateId on happy path', async () => {
      // Simulate the transport.start() triggering the OAuth redirect callback
      const authUrl = new URL('https://auth.example.com/authorize?scope=read');
      mockTransportStart.mockImplementation(() => {
        capturedOnRedirect?.(authUrl);
        throw new Error('Unauthorized');
      });
      mockPendingOAuthFlowService.save.mockResolvedValue(undefined);

      const result = await service.authorize(params, userId);

      // The stateId should be appended to the auth URL
      expect(result.stateId).toBe('test-uuid-1234');
      const resultUrl = new URL(result.authorizationUrl);
      expect(resultUrl.origin).toBe('https://auth.example.com');
      expect(resultUrl.pathname).toBe('/authorize');
      expect(resultUrl.searchParams.get('state')).toBe('test-uuid-1234');

      // Flow data should be persisted
      expect(mockPendingOAuthFlowService.save).toHaveBeenCalledWith(
        'test-uuid-1234',
        userId,
        {
          serverName: 'my-mcp-server',
          url: 'https://mcp.example.com/sse',
          clientId: 'client-123',
          clientSecret: 'secret-456',
          clientInfo: { client_id: 'dyn-client', client_secret: 'dyn-secret' },
          codeVerifier: 'pkce-verifier'
        }
      );
    });

    it('should handle undefined clientInfo and empty codeVerifier', async () => {
      mockClientInfo = undefined;
      mockCodeVerifier = '';

      const authUrl = new URL('https://auth.example.com/authorize');
      mockTransportStart.mockImplementation(() => {
        capturedOnRedirect?.(authUrl);
        throw new Error('Unauthorized');
      });
      mockPendingOAuthFlowService.save.mockResolvedValue(undefined);

      await service.authorize(params, userId);

      expect(mockPendingOAuthFlowService.save).toHaveBeenCalledWith(
        'test-uuid-1234',
        userId,
        expect.objectContaining({
          clientInfo: undefined,
          codeVerifier: undefined
        })
      );
    });

    it('should throw McpOAuthError when transport.start() fails without triggering redirect', async () => {
      // No redirect callback is invoked
      mockTransportStart.mockRejectedValue(new Error('Connection refused'));

      await expect(service.authorize(params, userId)).rejects.toThrow(
        McpOAuthError
      );
      await expect(service.authorize(params, userId)).rejects.toThrow(
        'Failed to initiate OAuth flow: Connection refused'
      );
    });

    it('should throw McpOAuthError when transport.start() succeeds without redirect (already authorized)', async () => {
      // transport.start() succeeds (no error, no redirect)
      mockTransportStart.mockResolvedValue(undefined);
      mockTransportClose.mockResolvedValue(undefined);

      await expect(service.authorize(params, userId)).rejects.toThrow(
        McpOAuthError
      );
      await expect(service.authorize(params, userId)).rejects.toThrow(
        'Failed to get authorization URL'
      );
    });

    it('should throw McpOAuthError with stringified non-Error rejection', async () => {
      // Simulate a non-Error throw (e.g. string thrown)
      mockTransportStart.mockRejectedValue('some string error');

      await expect(service.authorize(params, userId)).rejects.toThrow(
        McpOAuthError
      );
      await expect(service.authorize(params, userId)).rejects.toThrow(
        'Failed to initiate OAuth flow: some string error'
      );
    });
  });

  // ---- handleCallback ----

  describe('handleCallback', () => {
    const callbackParams: OAuthCallbackParams = {
      code: 'auth-code-xyz',
      state: 'state-id-999'
    };

    const flowEntry: PendingOAuthFlowEntry = {
      stateId: 'state-id-999',
      userId: 'user-abc',
      data: {
        serverName: 'my-mcp-server',
        url: 'https://mcp.example.com/sse',
        clientId: 'client-123',
        clientSecret: 'secret-456',
        clientInfo: { client_id: 'dyn-client', client_secret: 'dyn-secret' },
        codeVerifier: 'pkce-verifier'
      }
    };

    it('should complete OAuth flow, persist tokens, and create new server config', async () => {
      mockPendingOAuthFlowService.load.mockResolvedValue(flowEntry);
      mockTransportFinishAuth.mockResolvedValue(undefined);

      // After finishAuth, tokens should be available
      mockTokens = {
        access_token: 'at-123',
        refresh_token: 'rt-456',
        token_type: 'Bearer'
      };

      mockCredentialStoreService.save.mockResolvedValue('cred-id-new');
      // No existing server config
      mockGlobalSettingService.getMcpServersConfig.mockResolvedValue({});
      mockGlobalSettingService.updateMcpServersConfig.mockResolvedValue(
        undefined
      );
      mockPendingOAuthFlowService.delete.mockResolvedValue(undefined);

      const result = await service.handleCallback(callbackParams);

      expect(result).toEqual({ serverName: 'my-mcp-server' });

      // Tokens are persisted
      expect(mockCredentialStoreService.save).toHaveBeenCalledWith(
        JSON.stringify({
          access_token: 'at-123',
          refresh_token: 'rt-456',
          token_type: 'Bearer'
        })
      );

      // New server config entry is created
      expect(
        mockGlobalSettingService.updateMcpServersConfig
      ).toHaveBeenCalledWith(
        {
          'my-mcp-server': {
            type: 'oauth-http',
            url: 'https://mcp.example.com/sse',
            clientId: 'client-123',
            clientSecret: 'secret-456',
            credentialId: 'cred-id-new'
          }
        },
        'user-abc'
      );

      // Pending flow is cleaned up
      expect(mockPendingOAuthFlowService.delete).toHaveBeenCalledWith(
        'state-id-999'
      );

      // The onRedirectToAuthorization callback used in handleCallback is a no-op;
      // invoke it to cover the function branch.
      expect(capturedOnRedirect).toBeDefined();
      capturedOnRedirect?.(new URL('https://ignored.example.com'));
    });

    it('should replace existing oauth-http server config and delete old credential', async () => {
      mockPendingOAuthFlowService.load.mockResolvedValue(flowEntry);
      mockTransportFinishAuth.mockResolvedValue(undefined);
      mockTokens = { access_token: 'at-new', token_type: 'Bearer' };
      mockCredentialStoreService.save.mockResolvedValue('cred-id-new');
      mockCredentialStoreService.delete.mockResolvedValue(true);

      // Existing server config with old credential
      const existingConfig: Record<string, unknown> = {
        'my-mcp-server': {
          type: 'oauth-http',
          url: 'https://mcp.example.com/sse',
          credentialId: 'cred-id-old'
        }
      };
      mockGlobalSettingService.getMcpServersConfig.mockResolvedValue(
        existingConfig
      );
      mockGlobalSettingService.updateMcpServersConfig.mockResolvedValue(
        undefined
      );
      mockPendingOAuthFlowService.delete.mockResolvedValue(undefined);

      const result = await service.handleCallback(callbackParams);

      expect(result).toEqual({ serverName: 'my-mcp-server' });

      // Old credential is deleted
      expect(mockCredentialStoreService.delete).toHaveBeenCalledWith(
        'cred-id-old'
      );

      // Existing config object is updated in-place with new credentialId
      expect(
        mockGlobalSettingService.updateMcpServersConfig
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          'my-mcp-server': expect.objectContaining({
            credentialId: 'cred-id-new'
          })
        }),
        'user-abc'
      );
    });

    it('should throw McpOAuthStateNotFoundError when flow is not found', async () => {
      mockPendingOAuthFlowService.load.mockResolvedValue(null);

      await expect(service.handleCallback(callbackParams)).rejects.toThrow(
        McpOAuthStateNotFoundError
      );
      await expect(service.handleCallback(callbackParams)).rejects.toThrow(
        'Invalid or expired OAuth state'
      );
    });

    it('should throw McpOAuthTokenError when tokens are null after finishAuth', async () => {
      mockPendingOAuthFlowService.load.mockResolvedValue(flowEntry);
      mockTransportFinishAuth.mockResolvedValue(undefined);
      // mockTokens remains undefined — no tokens obtained
      mockPendingOAuthFlowService.delete.mockResolvedValue(undefined);

      await expect(service.handleCallback(callbackParams)).rejects.toThrow(
        McpOAuthTokenError
      );

      // Pending flow is cleaned up even on failure
      expect(mockPendingOAuthFlowService.delete).toHaveBeenCalledWith(
        'state-id-999'
      );
    });

    it('should wrap non-ServiceError exceptions as McpOAuthError', async () => {
      mockPendingOAuthFlowService.load.mockResolvedValue(flowEntry);
      mockTransportFinishAuth.mockRejectedValue(
        new Error('Token exchange failed')
      );
      mockPendingOAuthFlowService.delete.mockResolvedValue(undefined);

      await expect(service.handleCallback(callbackParams)).rejects.toThrow(
        McpOAuthError
      );
      await expect(service.handleCallback(callbackParams)).rejects.toThrow(
        'Token exchange failed'
      );

      // Pending flow is cleaned up even on failure
      expect(mockPendingOAuthFlowService.delete).toHaveBeenCalledWith(
        'state-id-999'
      );
    });

    it('should re-throw ServiceError subclasses without wrapping', async () => {
      mockPendingOAuthFlowService.load.mockResolvedValue(flowEntry);
      mockTransportFinishAuth.mockResolvedValue(undefined);
      // Simulate tokens being present but credentialStore.save throwing a ServiceError
      mockTokens = { access_token: 'at-123', token_type: 'Bearer' };
      const serviceErr = new McpOAuthTokenError('Custom token error');
      mockCredentialStoreService.save.mockRejectedValue(serviceErr);
      mockPendingOAuthFlowService.delete.mockResolvedValue(undefined);

      await expect(service.handleCallback(callbackParams)).rejects.toThrow(
        serviceErr
      );
    });

    it('should handle non-Error thrown values in catch block', async () => {
      mockPendingOAuthFlowService.load.mockResolvedValue(flowEntry);
      mockTransportFinishAuth.mockRejectedValue('string error');
      mockPendingOAuthFlowService.delete.mockResolvedValue(undefined);

      await expect(service.handleCallback(callbackParams)).rejects.toThrow(
        McpOAuthError
      );
      await expect(service.handleCallback(callbackParams)).rejects.toThrow(
        'Unknown error'
      );
    });

    it('should replace existing oauth-http config without old credentialId and skip delete', async () => {
      mockPendingOAuthFlowService.load.mockResolvedValue(flowEntry);
      mockTransportFinishAuth.mockResolvedValue(undefined);
      mockTokens = { access_token: 'at-new', token_type: 'Bearer' };
      mockCredentialStoreService.save.mockResolvedValue('cred-id-new');

      // Existing server config with type oauth-http but NO credentialId
      const existingConfig: Record<string, unknown> = {
        'my-mcp-server': {
          type: 'oauth-http',
          url: 'https://mcp.example.com/sse'
          // no credentialId property
        }
      };
      mockGlobalSettingService.getMcpServersConfig.mockResolvedValue(
        existingConfig
      );
      mockGlobalSettingService.updateMcpServersConfig.mockResolvedValue(
        undefined
      );
      mockPendingOAuthFlowService.delete.mockResolvedValue(undefined);

      const result = await service.handleCallback(callbackParams);

      expect(result).toEqual({ serverName: 'my-mcp-server' });

      // Old credential delete should NOT be called since there was no old credentialId
      expect(mockCredentialStoreService.delete).not.toHaveBeenCalled();

      // New credentialId should be set on the existing config
      expect(
        mockGlobalSettingService.updateMcpServersConfig
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          'my-mcp-server': expect.objectContaining({
            type: 'oauth-http',
            credentialId: 'cred-id-new'
          })
        }),
        'user-abc'
      );
    });

    it('should handle flow without clientInfo and codeVerifier', async () => {
      const flowWithoutOptionals: PendingOAuthFlowEntry = {
        stateId: 'state-id-999',
        userId: 'user-abc',
        data: {
          serverName: 'simple-server',
          url: 'https://mcp.example.com/sse'
        }
      };
      mockPendingOAuthFlowService.load.mockResolvedValue(flowWithoutOptionals);
      mockTransportFinishAuth.mockResolvedValue(undefined);
      mockTokens = { access_token: 'at-123', token_type: 'Bearer' };
      mockCredentialStoreService.save.mockResolvedValue('cred-id-new');
      mockGlobalSettingService.getMcpServersConfig.mockResolvedValue({});
      mockGlobalSettingService.updateMcpServersConfig.mockResolvedValue(
        undefined
      );
      mockPendingOAuthFlowService.delete.mockResolvedValue(undefined);

      const result = await service.handleCallback(callbackParams);

      expect(result).toEqual({ serverName: 'simple-server' });
    });
  });
});
