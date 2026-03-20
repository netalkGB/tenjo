import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface StdioMcpServerConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpMcpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = StdioMcpServerConfig | HttpMcpServerConfig;

export type McpServersConfig = Record<string, McpServerConfig>;

/**
 * For backward compatibility, normalizes configs without a type field as stdio.
 */
export function normalizeMcpServerConfig(
  config: Record<string, unknown>
): McpServerConfig {
  const type = (config.type as string) || 'stdio';

  if (type === 'http') {
    return {
      type: 'http',
      url: config.url as string,
      headers: (config.headers as Record<string, string>) || undefined
    };
  }

  return {
    type: 'stdio',
    command: config.command as string,
    args: (config.args as string[]) || undefined,
    env: (config.env as Record<string, string>) || undefined
  };
}

/**
 * Creates a single Transport from a McpServerConfig.
 */
export function createTransport(serverConfig: McpServerConfig): Transport {
  if (serverConfig.type === 'http') {
    const options: { requestInit?: RequestInit } = {};
    if (serverConfig.headers && Object.keys(serverConfig.headers).length > 0) {
      options.requestInit = { headers: serverConfig.headers };
    }
    return new StreamableHTTPClientTransport(
      new URL(serverConfig.url),
      options
    );
  }

  return new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args || [],
    env: serverConfig.env
  });
}

/**
 * Generates a Transport array from McpServersConfig.
 */
export function createTransportsFromConfig(
  mcpServers: McpServersConfig
): Transport[] {
  return Object.values(mcpServers).map(createTransport);
}
