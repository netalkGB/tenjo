import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  McpClientManager,
  McpOAuthClientProvider,
  type ToolDefinitionRequest,
  type McpServersConfig,
  type OAuthHttpMcpServerConfig,
  createTransport,
  createHttpTransportWithFallback
} from 'tenjo-chat-engine';
import type { CredentialStoreService } from './CredentialStoreService';
import type { StoredOAuthTokens } from './McpOAuthService';
import { ServiceError } from '../errors/ServiceError';
import { getAppName, getOAuthRedirectUrl } from '../utils/env';
import logger from '../logger';

export class McpOAuthRequiredError extends ServiceError {
  constructor(message: string = 'OAuth authorization required') {
    super(message);
  }
}

export class McpConnectionError extends ServiceError {}

export interface ValidateServersResult {
  tools: Record<string, string[]>;
  errors: Record<string, string>;
}

export interface McpConnectionResult {
  mcpClientManager: McpClientManager;
  tools: ToolDefinitionRequest[];
}

/**
 * Extracts the server-side credentialId from a runtime config object.
 * The credentialId is stored in the DB JSON but is not part of
 * chat-engine's OAuthHttpMcpServerConfig type.
 */
function getCredentialId(config: OAuthHttpMcpServerConfig): string | undefined {
  return (config as unknown as Record<string, unknown>).credentialId as
    | string
    | undefined;
}

export class McpToolService {
  /** Credential IDs that have failed OAuth and should not be retried until re-authorized. */
  private readonly suspendedCredentials = new Set<string>();

  constructor(
    private readonly credentialStoreService: CredentialStoreService
  ) {}

  /**
   * Removes a credential ID from the suspended set.
   * Called after successful re-authorization so the server is retried on the next request.
   */
  unsuspendCredential(credentialId: string): void {
    this.suspendedCredentials.delete(credentialId);
  }

  /**
   * Creates an HTTP transport with OAuth authentication for oauth-http servers.
   * Tries StreamableHTTP first, falls back to SSE.
   * Looks up saved tokens by credentialId — throws if not yet authorized.
   */
  private async createOAuthTransport(
    config: OAuthHttpMcpServerConfig
  ): Promise<Transport> {
    const credentialId = getCredentialId(config);
    if (!credentialId) {
      throw new McpOAuthRequiredError(
        'OAuth authorization required. Please authorize from settings.'
      );
    }

    // Skip servers already known to need re-authorization
    if (this.suspendedCredentials.has(credentialId)) {
      throw new McpOAuthRequiredError(
        'OAuth token has expired. Please re-authorize from settings.'
      );
    }

    const tokenJson = await this.credentialStoreService.load(credentialId);
    if (!tokenJson) {
      this.suspendedCredentials.add(credentialId);
      throw new McpOAuthRequiredError(
        'OAuth tokens not found. Please re-authorize from settings.'
      );
    }

    // Check token expiration before attempting connection
    const tokenData = JSON.parse(tokenJson) as StoredOAuthTokens;
    if (tokenData.expires_at && Date.now() >= tokenData.expires_at) {
      this.suspendedCredentials.add(credentialId);
      throw new McpOAuthRequiredError(
        'OAuth token has expired. Please re-authorize from settings.'
      );
    }

    const authProvider = new McpOAuthClientProvider({
      clientName: getAppName(),
      redirectUrl: getOAuthRedirectUrl(),
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      onRedirectToAuthorization: () => {
        throw new McpOAuthRequiredError(
          'OAuth authorization required. Please authorize from settings.'
        );
      }
    });

    authProvider.saveTokens(tokenData);

    return createHttpTransportWithFallback(config.url, { authProvider });
  }

  /**
   * Suspends the credential for an oauth-http server so it is skipped on future requests.
   */
  private suspendOAuthServer(
    serverName: string,
    serverConfig: McpServersConfig[string]
  ): void {
    if (serverConfig.type === 'oauth-http') {
      const credentialId = getCredentialId(serverConfig);
      if (credentialId) {
        this.suspendedCredentials.add(credentialId);
        logger.info(
          `OAuth server suspended until re-authorization: ${serverName}`
        );
      }
    }
  }

  /**
   * Creates a transport for a single server config, handling oauth-http async case.
   */
  private async createTransportForConfig(
    serverConfig: McpServersConfig[string]
  ): Promise<Transport> {
    if (serverConfig.type === 'oauth-http') {
      return this.createOAuthTransport(serverConfig);
    }
    return createTransport(serverConfig);
  }

  /**
   * Returns true if the given oauth-http server is suspended
   * (failed auth and awaiting re-authorization).
   */
  private isOAuthServerSuspended(
    serverConfig: McpServersConfig[string]
  ): boolean {
    if (serverConfig.type !== 'oauth-http') return false;
    const credentialId = getCredentialId(serverConfig);
    return !!credentialId && this.suspendedCredentials.has(credentialId);
  }

  /**
   * Validates connectivity to all MCP servers and returns discovered tools.
   * Collects per-server errors instead of throwing on first failure.
   * OAuth servers without credentials or suspended are skipped silently.
   */
  async validateAndGetToolsByServer(
    mcpServers: McpServersConfig
  ): Promise<ValidateServersResult> {
    const tools: Record<string, string[]> = {};
    const errors: Record<string, string> = {};

    for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
      // Skip OAuth servers that have not been authorized or need re-authorization
      if (serverConfig.type === 'oauth-http') {
        if (!getCredentialId(serverConfig)) {
          tools[serverName] = [];
          continue;
        }
        if (this.isOAuthServerSuspended(serverConfig)) {
          logger.info(
            `Skipped OAuth server (re-authorization required): ${serverName}`
          );
          tools[serverName] = [];
          errors[serverName] =
            'OAuth token has expired. Please re-authorize from settings.';
          continue;
        }
      }

      const mcpClientManager = new McpClientManager(
        'mcp-settings-client',
        '0.0.0'
      );

      try {
        const transport = await this.createTransportForConfig(serverConfig);
        mcpClientManager.setTransports([transport]);
        await mcpClientManager.connect();

        const serverTools = await mcpClientManager.getTools();
        tools[serverName] = serverTools.map((t) => t.function.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors[serverName] = message;
        // Suspend OAuth servers on any failure — the MCP SDK wraps auth errors
        // as UnauthorizedError so instanceof McpOAuthRequiredError won't match.
        this.suspendOAuthServer(serverName, serverConfig);
      } finally {
        await mcpClientManager.close();
      }
    }

    return { tools, errors };
  }

  /**
   * Connects to MCP servers and returns the manager and discovered tools.
   * OAuth servers without credentials are silently skipped.
   */
  async initializeMcpConnection(
    mcpServers: McpServersConfig,
    enabledTools?: string[]
  ): Promise<McpConnectionResult> {
    const mcpClientManager = new McpClientManager(
      'mcp-lm-studio-client',
      '0.0.0'
    );

    // No MCP servers configured or no tools selected — skip connection entirely
    if (
      Object.keys(mcpServers).length === 0 ||
      (enabledTools && enabledTools.length === 0)
    ) {
      return { mcpClientManager, tools: [] };
    }

    const transports: Transport[] = [];
    const serverNames: string[] = [];
    const failedServers: Record<string, string> = {};

    for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
      // Skip OAuth servers that have not been authorized yet or are suspended
      if (
        serverConfig.type === 'oauth-http' &&
        (!getCredentialId(serverConfig) ||
          this.isOAuthServerSuspended(serverConfig))
      ) {
        if (this.isOAuthServerSuspended(serverConfig)) {
          logger.info(
            `Skipped OAuth server (re-authorization required): ${serverName}`
          );
        }
        continue;
      }

      try {
        const transport = await this.createTransportForConfig(serverConfig);
        transports.push(transport);
        serverNames.push(serverName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failedServers[serverName] = message;
        this.suspendOAuthServer(serverName, serverConfig);
        logger.warn(
          `Failed to create transport for MCP server: ${serverName}`,
          { error: message }
        );
      }
    }

    if (transports.length === 0) {
      if (Object.keys(failedServers).length > 0) {
        const details = Object.entries(failedServers)
          .map(([name, msg]) => `${name}: ${msg}`)
          .join(', ');
        throw new McpConnectionError(
          `MCP server connection failed: ${details}`
        );
      }
      return { mcpClientManager, tools: [] };
    }

    mcpClientManager.setTransports(transports);
    const connectErrors = await mcpClientManager.connectWithPartialFailure();

    // Map transport-index errors back to server names and suspend OAuth servers
    for (const [idx, msg] of Object.entries(connectErrors)) {
      const i = Number(idx);
      const name = serverNames[i];
      failedServers[name] = msg;

      // Suspend OAuth servers that failed during connection (e.g. 401 from provider)
      const serverConfig = mcpServers[name];
      if (serverConfig) {
        this.suspendOAuthServer(name, serverConfig);
      }
    }

    if (Object.keys(failedServers).length > 0) {
      logger.warn(
        'Some MCP servers failed to connect, continuing with others',
        { failedServers }
      );
    }

    const allTools = await mcpClientManager.getTools();

    const tools = enabledTools
      ? allTools.filter((t: ToolDefinitionRequest) =>
          enabledTools.includes(t.function.name)
        )
      : allTools;

    return { mcpClientManager, tools };
  }
}
