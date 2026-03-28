import crypto from 'node:crypto';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { McpOAuthClientProvider } from 'tenjo-chat-engine';
import type { GlobalSettingService } from './GlobalSettingService';
import type { CredentialStoreService } from './CredentialStoreService';
import type { PendingOAuthFlowService } from './PendingOAuthFlowService';
import { ServiceError } from '../errors/ServiceError';
import { getAppName, getOAuthRedirectUrl } from '../utils/env';
import logger from '../logger';

export class McpOAuthError extends ServiceError {}

export class McpOAuthStateNotFoundError extends ServiceError {
  constructor(message: string = 'Invalid or expired OAuth state') {
    super(message);
  }
}

export class McpOAuthTokenError extends ServiceError {
  constructor(message: string = 'Failed to obtain tokens') {
    super(message);
  }
}

export interface OAuthAuthorizeParams {
  serverName: string;
  url: string;
  clientId?: string;
  clientSecret?: string;
}

export interface OAuthAuthorizeResult {
  authorizationUrl: string;
  stateId: string;
}

export interface OAuthCallbackParams {
  code: string;
  state: string;
}

export interface OAuthCallbackResult {
  serverName: string;
}

export class McpOAuthService {
  constructor(
    private readonly globalSettingService: GlobalSettingService,
    private readonly credentialStoreService: CredentialStoreService,
    private readonly pendingOAuthFlowService: PendingOAuthFlowService
  ) {}

  /**
   * Initiate the OAuth flow for an MCP server.
   * Returns an authorization URL and a state ID for correlation.
   */
  async authorize(
    params: OAuthAuthorizeParams,
    userId: string
  ): Promise<OAuthAuthorizeResult> {
    const { serverName, url, clientId, clientSecret } = params;

    let authorizationUrl: URL | undefined;

    const provider = new McpOAuthClientProvider({
      clientName: getAppName(),
      redirectUrl: getOAuthRedirectUrl(),
      clientId,
      clientSecret,
      onRedirectToAuthorization: (redirectUrl: URL) => {
        authorizationUrl = redirectUrl;
      }
    });

    // Use SSE transport to initiate the OAuth flow.
    // SSEClientTransport.start() makes a real GET request that triggers the OAuth redirect,
    // whereas StreamableHTTPClientTransport.start() is a no-op.
    // After tokens are obtained, the actual connection will use protocol auto-detection.
    const transport = new SSEClientTransport(new URL(url), {
      authProvider: provider
    });

    try {
      await transport.start();
      await transport.close();
      // Already authorized — should not normally happen on first setup
    } catch (err: unknown) {
      if (!authorizationUrl) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error('OAuth authorize: unexpected error', { error: errMsg });
        throw new McpOAuthError(`Failed to initiate OAuth flow: ${errMsg}`);
      }
    }

    if (!authorizationUrl) {
      throw new McpOAuthError('Failed to get authorization URL');
    }

    const stateId = crypto.randomUUID();

    // Persist flow data (encrypted) in DB including OAuth state from provider
    const clientInfo = provider.clientInformation();
    await this.pendingOAuthFlowService.save(stateId, userId, {
      serverName,
      url,
      clientId,
      clientSecret,
      clientInfo: clientInfo
        ? {
            client_id: clientInfo.client_id,
            client_secret: clientInfo.client_secret
          }
        : undefined,
      codeVerifier: provider.codeVerifier() || undefined
    });

    // Append our stateId so the callback can correlate
    authorizationUrl.searchParams.set('state', stateId);

    return {
      authorizationUrl: authorizationUrl.toString(),
      stateId
    };
  }

  /**
   * Handle the OAuth callback with an authorization code and state.
   * Exchanges the code for tokens, persists them, and updates the MCP server config.
   *
   * This method can be called from the HTTP route handler or directly
   * from an Electron host process (bypassing HTTP).
   */
  async handleCallback(
    params: OAuthCallbackParams
  ): Promise<OAuthCallbackResult> {
    const { code, state: stateId } = params;

    const flow = await this.pendingOAuthFlowService.load(stateId);
    if (!flow) {
      throw new McpOAuthStateNotFoundError();
    }

    try {
      const {
        serverName,
        url,
        clientId,
        clientSecret,
        clientInfo,
        codeVerifier
      } = flow.data;

      // Reconstruct provider and transport to finish the OAuth exchange
      const provider = new McpOAuthClientProvider({
        clientName: getAppName(),
        redirectUrl: getOAuthRedirectUrl(),
        clientId,
        clientSecret,
        onRedirectToAuthorization: () => {
          // No-op: authorization already happened before callback
        }
      });

      // Restore OAuth state captured during the authorize step
      if (clientInfo) {
        provider.saveClientInformation(clientInfo);
      }
      if (codeVerifier) {
        provider.saveCodeVerifier(codeVerifier);
      }

      const transport = new SSEClientTransport(new URL(url), {
        authProvider: provider
      });

      await transport.finishAuth(code);

      const tokens = provider.tokens();
      if (!tokens) {
        throw new McpOAuthTokenError();
      }

      // Persist encrypted tokens in credential_store
      const credentialId = await this.credentialStoreService.save(
        JSON.stringify(tokens)
      );

      // Update or create the MCP server config with the credential reference
      const mcpServers = await this.globalSettingService.getMcpServersConfig();
      const existingRaw = mcpServers[serverName] as unknown as
        | (Record<string, unknown> & { type: string })
        | undefined;

      if (existingRaw && existingRaw.type === 'oauth-http') {
        // Remove old credential if replaced
        const oldCredentialId = existingRaw.credentialId as string | undefined;
        if (oldCredentialId) {
          await this.credentialStoreService.delete(oldCredentialId);
        }
        existingRaw.credentialId = credentialId;
      } else {
        // Create new server config entry
        (mcpServers as Record<string, unknown>)[serverName] = {
          type: 'oauth-http',
          url,
          clientId,
          clientSecret,
          credentialId
        };
      }
      await this.globalSettingService.updateMcpServersConfig(
        mcpServers,
        flow.userId
      );

      // Clean up the pending flow
      await this.pendingOAuthFlowService.delete(stateId);

      return { serverName };
    } catch (error: unknown) {
      // Clean up the pending flow even on failure
      await this.pendingOAuthFlowService.delete(stateId);

      if (error instanceof ServiceError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('OAuth callback error', { error: message });
      throw new McpOAuthError(message);
    }
  }
}
