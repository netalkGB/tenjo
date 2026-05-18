/**
 * CUI demo: a parent chat agent that delegates web research to a
 * browser-driving sub-agent.
 *
 * Architecture:
 *
 *   user
 *    │
 *    ▼
 *   parent ChatClient (text-only, no browser tools)
 *    │  decides: "does this need fresh web data?"
 *    │  if yes → calls the single tool below
 *    ▼
 *   tenjo_browser_agent(task)
 *    │  forwards `task` to a {@link BrowserResearchAgent}.runTask call.
 *    │  Returns ONLY the final text answer + the URLs the sub-agent
 *    │  loaded — the parent never sees the raw tool traffic.
 *    ▼
 *   parent uses the returned summary to answer the user
 *
 * The sub-agent is the *same* class example/browser-agent.ts uses for its
 * REPL, so persistence enforcement (give-up classifier + forced retry) and
 * the silent-turn fallback all behave identically to the standalone CLI.
 *
 * Usage: ts-node chat-engine/src/example/sub-agent-browser.ts
 *   (or compile with `tsc` and run dist/example/sub-agent-browser.js)
 */

import * as readline from 'readline';

import {
  createBrowserDelegateTool,
  BROWSER_DELEGATE_SYSTEM_HINT,
} from '../agents/subAgentDelegate.js';
import { BrowserResearchAgent } from '../agents/browserResearchAgent.js';
import { ChatClient, ChatStatus } from '../ChatClient.js';
import { LmStudioChatApiClient } from '../LmStudioChatApiClient.js';
import { bundleTools } from '../tools/types.js';

const LMSTUDIO_URL = process.env.LMSTUDIO_URL ?? 'http://localhost:1234/';
const MODEL = 'google/gemma-4-26b-a4b';

async function main() {
  // Sub-agent: the same class example/browser-agent.ts uses for its REPL.
  // It owns its own private Chromium browser (passed via browserConfig) so
  // it does not share cookies / scroll position with anything else.
  // The sub-agent's internal chatter (text streaming, status, tool args
  // for unrelated tools, persistence-retry warnings, etc.) is intentionally
  // NOT logged here — the only things surfaced to the operator are:
  //   1. when the sub-agent starts a search or a navigation, so progress
  //      is visible
  //   2. the final research result, via onTaskComplete
  const subAgent = new BrowserResearchAgent({
    apiClientFactory: (tools) =>
      new LmStudioChatApiClient({
        apiBaseUrl: LMSTUDIO_URL,
        apiKey: null,
        model: MODEL,
        tools,
      }),
    browserConfig: {
      headless: true,
      headlessMode: 'new',
      userAgent: 'Tenjo Browser SubAgent',
      requestDelay: { min: 500, max: 3000 },
    },
  });
  subAgent.setEvents({
    onToolStart: (name, args) => {
      if (name !== 'browser_duckduckgo_search' && name !== 'browser_navigate') {
        return;
      }
      const detail =
        name === 'browser_duckduckgo_search'
          ? typeof args.query === 'string'
            ? args.query
            : ''
          : typeof args.url === 'string'
            ? args.url
            : '';
      process.stdout.write(`\n\x1b[2m  · ${name}: ${detail}\x1b[0m`);
    },
    onTaskComplete: (result) => {
      const queryCount = result.searches.length;
      const queriesLabel = queryCount === 1 ? 'query' : 'queries';
      process.stdout.write(
        `\n\x1b[36m[research result] (${queryCount} DDG ${queriesLabel}${result.incomplete ? ', incomplete' : ''})\n${result.answer || '(no answer)'}\x1b[0m\n`
      );
    },
  });

  const delegateTool = createBrowserDelegateTool(subAgent);
  const { definitions, handlers } = bundleTools([delegateTool]);

  // Parent: text-only chat client whose only tool is the delegate above.
  // Browser tools are deliberately hidden behind that boundary so the
  // parent's context window stays small.
  const parent = new ChatClient(
    new LmStudioChatApiClient({
      apiBaseUrl: LMSTUDIO_URL,
      apiKey: null,
      model: MODEL,
      tools: definitions,
    })
  );
  parent.setMessageHandler((m) => process.stdout.write(m));
  parent.setThinkingHandler((m) => process.stdout.write(m));
  parent.setReasoningHandler((m) => process.stdout.write(m));
  parent.setStatusHandler((status: ChatStatus) => {
    process.stdout.write(`\n[parent: ${status}]\n`);
  });

  // To turn off the sub-agent in the future, omit
  // BROWSER_DELEGATE_SYSTEM_HINT here and stop passing the delegate tool
  // into the parent's tool list.
  parent.setSystemPrompt({
    role: 'system',
    content: BROWSER_DELEGATE_SYSTEM_HINT,
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (): Promise<string> =>
    new Promise((resolve) => rl.question('\n> ', resolve));

  const PARENT_MAX_ITER = 8;

  const sendMessage = async (msg: string) => {
    await parent.sendMessage(msg);
    let toolCalls = parent.getToolCallPlan();
    let iter = 0;
    while (toolCalls && toolCalls.length > 0) {
      if (iter >= PARENT_MAX_ITER) {
        console.log(`\n[parent loop guard] hit ${PARENT_MAX_ITER} iterations`);
        for (const tc of toolCalls) {
          parent.addToolCallResult(tc.id, {
            error: 'Parent loop budget exhausted; answer with what you have.',
          });
        }
        await parent.validateToolCallResult();
        break;
      }
      iter++;

      for (const toolCall of toolCalls) {
        const { name, arguments: args } = toolCall.function;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(args) as Record<string, unknown>;
        } catch {
          parsed = {};
        }
        const handler = handlers.get(name);
        if (!handler) {
          parent.addToolCallResult(toolCall.id, {
            error: `[unknown tool ${name}]`,
          });
          continue;
        }
        const result = await handler(parsed);
        parent.addToolCallResult(toolCall.id, result);
      }

      await parent.validateToolCallResult();
      toolCalls = parent.getToolCallPlan();
    }
  };

  console.log(
    'Sub-agent browser demo. The parent delegates web research to a child agent.'
  );
  console.log('Type "exit" to quit.\n');

  try {
    while (true) {
      const userInput = await ask();
      if (userInput.toLowerCase() === 'exit') break;
      if (userInput.trim() === '') continue;
      try {
        await sendMessage(userInput);
        process.stdout.write('\n');
      } catch (err) {
        console.error('Error:', err);
      }
    }
  } finally {
    rl.close();
    await subAgent.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
