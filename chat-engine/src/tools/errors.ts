export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DuplicateToolNameError extends ToolError {
  constructor(toolName: string) {
    super(`Duplicate tool name: ${toolName}`);
  }
}
