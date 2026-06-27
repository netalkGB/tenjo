export type AgentToolSuccess<T extends Record<string, unknown>> = {
  ok: true;
} & T;

export type AgentToolFailure = {
  ok: false;
  error: string;
};
