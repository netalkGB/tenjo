import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import logger from './logger.js';

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

export interface OAuthHttpMcpServerConfig {
  type: 'oauth-http';
  url: string;
  clientId?: string;
  clientSecret?: string;
}

export type McpServerConfig =
  | StdioMcpServerConfig
  | HttpMcpServerConfig
  | OAuthHttpMcpServerConfig;

export type McpServersConfig = Record<string, McpServerConfig>;

/**
 * For backward compatibility, normalizes configs without a type field as stdio.
 */
export function normalizeMcpServerConfig(
  config: Record<string, unknown>,
): McpServerConfig {
  const type = (config.type as string) || 'stdio';

  if (type === 'http') {
    return {
      type: 'http',
      url: config.url as string,
      headers: (config.headers as Record<string, string>) || undefined,
    };
  }

  if (type === 'oauth-http') {
    return {
      type: 'oauth-http',
      url: config.url as string,
      clientId: (config.clientId as string) || undefined,
      clientSecret: (config.clientSecret as string) || undefined,
    };
  }

  return {
    type: 'stdio',
    command: config.command as string,
    args: (config.args as string[]) || undefined,
    env: (config.env as Record<string, string>) || undefined,
  };
}

/**
 * Probes whether a URL supports the StreamableHTTP protocol by sending
 * a JSON-RPC POST request and checking the response status.
 * Returns true if the server accepts POST (even with 401), false if 404/405.
 */
async function supportsStreamableHttp(
  url: URL,
  headers?: Record<string, string>,
  authProvider?: OAuthClientProvider,
): Promise<boolean> {
  const reqHeaders: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    ...headers,
  };

  // Include auth token if available
  if (authProvider) {
    const tokens = await authProvider.tokens();
    if (tokens?.access_token) {
      reqHeaders.Authorization = `Bearer ${tokens.access_token}`;
    }
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: '_probe',
      }),
    });

    // 404/405 means the server doesn't accept POST → SSE-only
    if (response.status === 404 || response.status === 405) {
      return false;
    }

    // Any other status (200, 401, etc.) means the endpoint accepts POST
    return true;
  } catch {
    // Network error — let the actual transport handle it
    return true;
  }
}

/**
 * Creates an HTTP transport with StreamableHTTP → SSE fallback.
 * Probes the endpoint to detect protocol support before creating the transport.
 */
export async function createHttpTransportWithFallback(
  url: string,
  options?: {
    headers?: Record<string, string>;
    authProvider?: OAuthClientProvider;
  },
): Promise<Transport> {
  const parsedUrl = new URL(url);
  const customHeaders = options?.headers;
  const requestInit: RequestInit | undefined =
    customHeaders && Object.keys(customHeaders).length > 0
      ? { headers: customHeaders }
      : undefined;

  const isStreamable = await supportsStreamableHttp(
    parsedUrl,
    customHeaders,
    options?.authProvider,
  );

  if (isStreamable) {
    logger.debug(`Using StreamableHTTP transport for ${url}`);
    return new StreamableHTTPClientTransport(parsedUrl, {
      ...(requestInit ? { requestInit } : {}),
      ...(options?.authProvider ? { authProvider: options.authProvider } : {}),
    });
  }

  logger.debug(`Using SSE transport for ${url}`);
  return new SSEClientTransport(parsedUrl, {
    ...(requestInit
      ? {
          requestInit,
          eventSourceInit: {
            fetch: (u: string | URL, init?: RequestInit) =>
              fetch(u, { ...init, ...requestInit }),
          },
        }
      : {}),
    ...(options?.authProvider ? { authProvider: options.authProvider } : {}),
  });
}

/**
 * Creates a single Transport from a McpServerConfig.
 * For HTTP configs, tries StreamableHTTP first and falls back to SSE.
 * OAuth-HTTP configs must be handled separately (tokens need to be resolved first).
 */
export async function createTransport(
  serverConfig: McpServerConfig,
): Promise<Transport> {
  if (serverConfig.type === 'oauth-http') {
    throw new Error(
      'OAuth HTTP transport requires token resolution before creation',
    );
  }

  if (serverConfig.type === 'http') {
    return createHttpTransportWithFallback(serverConfig.url, {
      headers: serverConfig.headers,
    });
  }

  return new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args || [],
    env: serverConfig.env,
  });
}
