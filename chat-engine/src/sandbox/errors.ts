export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SandboxCommandError extends SandboxError {
  constructor(message: string) {
    super(message);
  }
}

export class SandboxConfigurationError extends SandboxError {
  constructor(message: string) {
    super(message);
  }
}

export type SandboxFileOperation = 'read' | 'write' | 'list';

export class SandboxFileOperationError extends SandboxError {
  readonly operation: SandboxFileOperation;
  readonly path: string;

  constructor(operation: SandboxFileOperation, path: string, message: string) {
    super(message);
    this.operation = operation;
    this.path = path;
  }
}

export class SandboxGuiError extends SandboxError {
  constructor(message: string) {
    super(message);
  }
}

export class SandboxResourceExhaustedError extends SandboxError {
  constructor(message: string) {
    super(message);
  }
}

export class SandboxSetupError extends SandboxError {
  constructor(message: string) {
    super(message);
  }
}

export class DockerUnavailableError extends SandboxError {
  constructor(
    message = 'Docker is not available. Install Docker Engine/Desktop and ensure the daemon is running.'
  ) {
    super(message);
  }
}
