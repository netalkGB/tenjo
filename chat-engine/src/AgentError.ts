export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AgentTurnAbortedError extends AgentError {
  constructor(message = 'Turn aborted by user') {
    super(message);
  }
}

export class AgentUnknownError extends AgentError {
  constructor(message: string) {
    super(message);
  }
}
