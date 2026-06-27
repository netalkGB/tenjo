export class McpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class McpToolNotFoundError extends McpError {
  constructor(toolName: string) {
    super(`Tool ${toolName} not found in any connected MCP server`);
  }
}

export class McpUnsupportedTransportError extends McpError {
  constructor(message: string) {
    super(message);
  }
}
