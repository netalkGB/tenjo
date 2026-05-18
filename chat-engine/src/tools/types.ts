import type { ToolDefinitionRequest } from '../OpenAIChatApiClient';

/**
 * Local tool handler shape: receives parsed JSON arguments from a tool call
 * and returns the result fed back to the LLM via addToolCallResult.
 */
export type LocalToolHandler = (
  args: Record<string, unknown>
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
      throw new Error(`Duplicate tool name: ${name}`);
    }
    handlers.set(name, tool.handler);
  }
  return {
    definitions: tools.map((t) => t.definition),
    handlers,
  };
}
