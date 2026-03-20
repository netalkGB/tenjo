import {
  McpClientManager,
  type ToolDefinitionRequest
} from 'tenjo-chat-engine';
import {
  type McpServersConfig,
  createTransport,
  createTransportsFromConfig
} from '../utils/mcpTransportFactory';

export interface ValidateServersResult {
  tools: Record<string, string[]>;
  errors: Record<string, string>;
}

export interface McpConnectionResult {
  mcpClientManager: McpClientManager;
  tools: ToolDefinitionRequest[];
}

export class McpToolService {
  /**
   * Validates connectivity to all MCP servers and returns discovered tools.
   * Collects per-server errors instead of throwing on first failure.
   */
  async validateAndGetToolsByServer(
    mcpServers: McpServersConfig
  ): Promise<ValidateServersResult> {
    const tools: Record<string, string[]> = {};
    const errors: Record<string, string> = {};

    for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
      const mcpClientManager = new McpClientManager(
        'mcp-settings-client',
        '0.0.0'
      );

      try {
        mcpClientManager.setTransports([createTransport(serverConfig)]);
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
   */
  async initializeMcpConnection(
    mcpServers: McpServersConfig,
    enabledTools?: string[]
  ): Promise<McpConnectionResult> {
    const mcpClientManager = new McpClientManager(
      'mcp-lm-studio-client',
      '0.0.0'
    );

    const transports = createTransportsFromConfig(mcpServers);

    if (transports.length > 0) {
      mcpClientManager.setTransports(transports);
    }

    await mcpClientManager.connect();

    const allTools = await mcpClientManager.getTools();

    const tools = enabledTools
      ? allTools.filter((t: ToolDefinitionRequest) =>
          enabledTools.includes(t.function.name)
        )
      : allTools;

    return { mcpClientManager, tools };
  }
}
