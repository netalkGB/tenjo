import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ToolDefinitionRequest } from './OpenAIChatApiClient.js';

export class McpClientManager {
  private transports: Transport[] = [];
  private clients: Client[] = [];
  private mcpClientName: string;
  private mcpClientVersion: string;

  constructor(clientName: string, clientVersion: string) {
    this.mcpClientName = clientName;
    this.mcpClientVersion = clientVersion;
  }

  public setTransports(transports: Transport[]) {
    this.transports = transports;
  }

  public async connect() {
    for (const transport of this.transports) {
      const client = new Client(
        {
          name: this.mcpClientName,
          version: this.mcpClientVersion,
        },
        {
          capabilities: {},
        }
      );
      await client.connect(transport);
      this.clients.push(client);
    }
  }

  public async getTools(): Promise<ToolDefinitionRequest[]> {
    const allTools: ToolDefinitionRequest[] = [];
    for (const client of this.clients) {
      const toolsResponse = await client.listTools();
      const availableTools = toolsResponse?.tools || [];

      const tools = availableTools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || `Execute ${tool.name} tool`,
          parameters:
            (tool.inputSchema as ToolDefinitionRequest['function']['parameters']) || {
              type: 'object',
              properties: {},
              required: [],
            },
        },
      }));
      allTools.push(...tools);
    }
    return allTools;
  }

  public async callTool(name: string, args: Record<string, unknown>) {
    for (const client of this.clients) {
      const toolsResponse = await client.listTools();
      const toolExists = toolsResponse?.tools?.some(
        (tool) => tool.name === name
      );

      if (toolExists) {
        const response = await client.callTool({
          name,
          arguments: args,
        });
        return response;
      }
    }

    throw new Error(`Tool ${name} not found in any connected MCP server`);
  }

  public async close() {
    const clients = this.clients;
    const transports = this.transports;
    this.clients = [];
    this.transports = [];
    await Promise.allSettled(
      clients.map(async (client, i) => {
        if (client) {
          await client.close();
        }
        if (transports[i]) {
          await transports[i].close();
        }
      })
    );
  }
}
