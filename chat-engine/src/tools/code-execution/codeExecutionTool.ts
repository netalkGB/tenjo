import type { Tool } from '../types';
import { executeCode } from './codeExecutor';

export const CODE_EXECUTION_TOOL_NAME = 'tenjo_execute_code';

/**
 * System-prompt nudge appended only when the user has enabled the
 * code-execution toggle. Tells the model the tool exists but constrains
 * its use to questions that genuinely benefit from running code, so
 * conversational queries (recipes, explanations, opinions, etc.) are
 * answered from the model's own knowledge instead.
 */
export const CODE_EXECUTION_SYSTEM_HINT = [
  'The tenjo_execute_code tool is available. Use it ONLY when the user is asking something that is best answered by actually running JavaScript — for example: numerical computation, data parsing/transformation, regex testing, hashing/UUID generation, fetching live data over the network, or verifying programmatic behavior.',
  "Do NOT call tenjo_execute_code for general knowledge questions, explanations, recipes, opinions, translations, conversational chit-chat, or anything you can answer directly from your own knowledge. Calling the tool unnecessarily wastes the user's time.",
  'When in doubt, answer directly without the tool.',
  "When you do call it, write the source as an ES Module: use `import ... from 'node:fs'` (not `require`) and feel free to use top-level `await`.",
  'Priority over the HTML preview: while this tool is enabled, prefer calling tenjo_execute_code for any "run this", "compute X", "generate Y", or "test this code" request. The HTML preview is only for visible web pages the user wants rendered — do not return an `' +
    '```html' +
    '` block as a workaround for executing code.',
].join(' ');

export const codeExecutionTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: CODE_EXECUTION_TOOL_NAME,
      description:
        "Execute JavaScript source code in a sandboxed Node.js subprocess and return its stdout/stderr. Use ONLY when the user's request genuinely requires running code — e.g. numerical computation, data parsing, regex testing, hashing, UUID/random generation, fetching live data over the network, or verifying programmatic behavior. Do NOT use for conversational questions, explanations, recipes, opinions, or anything answerable from general knowledge. The code runs as an ES Module: use `import ... from 'node:fs'` etc., NOT `require(...)`. Top-level `await` is available. Sandbox: filesystem writes / child processes / workers / native addons are blocked; networking via fetch is allowed; wall-clock cap 30s.",
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'Self-contained JavaScript source. Use console.log to surface results.',
          },
        },
        required: ['code'],
      },
    },
  },
  handler: async (args) => {
    const code = typeof args.code === 'string' ? args.code : '';
    if (!code) {
      return { error: 'Missing required argument: code' };
    }
    const result = await executeCode(code);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
  },
};
