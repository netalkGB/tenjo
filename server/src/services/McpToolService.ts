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
  constructor(
    private readonly credentialStoreService: CredentialStoreService
  ) {}

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

    const tokenJson = await this.credentialStoreService.load(credentialId);
    if (!tokenJson) {
      throw new McpOAuthRequiredError(
        'OAuth tokens not found. Please re-authorize from settings.'
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

    const tokens = JSON.parse(tokenJson) as Parameters<
      typeof authProvider.saveTokens
    >[0];
    authProvider.saveTokens(tokens);

    return createHttpTransportWithFallback(config.url, { authProvider });
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
   * Validates connectivity to all MCP servers and returns discovered tools.
   * Collects per-server errors instead of throwing on first failure.
   * OAuth servers without credentials are skipped (not treated as errors).
   */
  async validateAndGetToolsByServer(
    mcpServers: McpServersConfig
  ): Promise<ValidateServersResult> {
    const tools: Record<string, string[]> = {};
    const errors: Record<string, string> = {};

    for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
      // Skip OAuth servers that have not been authorized yet
      if (
        serverConfig.type === 'oauth-http' &&
        !getCredentialId(serverConfig)
      ) {
        tools[serverName] = [];
        continue;
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
      // Skip OAuth servers that have not been authorized yet
      if (
        serverConfig.type === 'oauth-http' &&
        !getCredentialId(serverConfig)
      ) {
        continue;
      }

      try {
        const transport = await this.createTransportForConfig(serverConfig);
        transports.push(transport);
        serverNames.push(serverName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failedServers[serverName] = message;
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

    // Map transport-index errors back to server names
    for (const [idx, msg] of Object.entries(connectErrors)) {
      const name = serverNames[Number(idx)];
      failedServers[name] = msg;
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
