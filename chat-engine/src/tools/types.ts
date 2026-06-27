import type { ToolDefinitionRequest } from '../OpenAIChatApiClient';
import { DuplicateToolNameError } from './errors.js';

/**
 * Per-call execution context handed to a tool handler. Currently carries the
 * turn's abort signal so a long-running tool (for example bash) is killed the instant
 * the user stops the agent, instead of running to completion first.
 */
export interface ToolExecContext {
  signal?: AbortSignal;
}

/**
 * Local tool handler shape: receives parsed JSON arguments from a tool call
 * (and an optional execution context) and returns the result fed back to the
 * LLM via addToolCallResult.
 */
export type LocalToolHandler = (
  args: Record<string, unknown>,
  context?: ToolExecContext
) => Promise<unknown>;

/**
 * A tool bundled with its handler. Keeping the LLM-facing definition and the
 * locally-executed handler in the same object means callers never have to
 * pair them up by name on the dispatch side.
 */
export interface Tool {
  definition: ToolDefinitionRequest;
  handler: LocalToolHandler;
}

export interface BundledTools {
  /** Tool definitions to advertise to the LLM (`tools: [...]`). */
  definitions: ToolDefinitionRequest[];
  /** Handlers keyed by tool name for the dispatch loop. */
  handlers: Map<string, LocalToolHandler>;
}

/**
 * Split a list of {@link Tool}s into the two shapes the runtime needs:
 * a flat array of definitions for the chat client, and a name→handler map
 * for the dispatch loop. Throws if two tools share a name.
 */
export function bundleTools(tools: Tool[]): BundledTools {
  const handlers = new Map<string, LocalToolHandler>();
  for (const tool of tools) {
    const name = tool.definition.function.name;
    if (handlers.has(name)) {
      throw new DuplicateToolNameError(name);
    }
    handlers.set(name, tool.handler);
  }
  return {
    definitions: tools.map((t) => t.definition),
    handlers,
  };
}
