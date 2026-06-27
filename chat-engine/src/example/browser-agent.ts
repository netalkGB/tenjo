/**
 * CUI verification of the browser-automation tool. Drives a real Chromium
 * window so the user can watch the agent navigate.
 *
 * The actual agent loop (tool dispatch, give-up classifier,
 * persistence-enforcement retry, silent-turn fallback) lives
 * in {@link BrowserResearchAgent}. This file is just the REPL wrapper:
 * read a line from stdin, hand it to the agent, repeat.
 */

import * as readline from 'readline';

import { BrowserResearchAgent } from '../agents/browserResearchAgent.js';
import { type ChatStatus } from '../ChatClient.js';
import { LmStudioChatApiClient } from '../LmStudioChatApiClient.js';

async function main() {
  const agent = new BrowserResearchAgent({
    apiClientFactory: (tools) =>
      new LmStudioChatApiClient({
        apiBaseUrl: process.env.LMSTUDIO_URL ?? 'http://localhost:1234/',
        apiKey: null,
        model: 'google/gemma-4-26b-a4b',
        tools,
      }),
    browserConfig: {
      headless: true,
      headlessMode: 'new',
      userAgent: 'Tenjo Browser Agent',
      requestDelay: { min: 100, max: 300 },
    },
  });

  agent.setMessageHandler((m) => process.stdout.write(m));
  agent.setThinkingHandler((m) => process.stdout.write(m));
  agent.setReasoningHandler((m) => process.stdout.write(m));
  agent.setStatusHandler((status: ChatStatus) => {
    process.stdout.write(`\n[status: ${status}]\n`);
  });
  agent.setToolCallStreamHandler((event) => {
    process.stdout.write(
      `\n[stream ${event.toolName}] ${event.argumentsDelta}`
    );
  });

  agent.setEvents({
    onToolStart: (name, args) => {
      console.log(`\n--- ${name} ${JSON.stringify(args)} ---`);
    },
    onToolEnd: (_name, _args, result, resultJson) => {
      console.log(`--- result (${resultJson.length} chars JSON) ---`);
      if (resultJson.length > 1000) {
        console.log(resultJson.slice(0, 1000) + ' ...[truncated in console]');
      } else {
        console.log(result);
      }
    },
    onPersistenceRetry: (distinctQueries, quota) => {
      const queriesSoFar = distinctQueries === 1 ? 'query' : 'queries';
      console.log(
        `\n[persistence enforcement] classifier flagged answer as give-up after only ${distinctQueries} distinct DDG ${queriesSoFar} (need >=${quota}) — forcing retry`
      );
    },
    onForcedFinalResponse: (info) => {
      console.log(
        `\n[forcing final response] textLen=${info.textLen}, trimmedLen=${info.trimmedLen}, hitLimit=${info.hitLimit}`
      );
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (): Promise<string> =>
    new Promise((resolve) => rl.question('> ', resolve));

  try {
    while (true) {
      const userInput = await ask();
      if (userInput.toLowerCase() === 'exit') break;
      if (userInput.trim() === '') continue;
      try {
        const result = await agent.runTask(userInput);
        if (result.answer.length === 0) {
          console.log(
            `\n[no response] ${result.note ?? 'agent could not produce an answer this turn'}`
          );
        }
        process.stdout.write('\n');
      } catch (err) {
        console.error('Error:', err);
      }
    }
  } finally {
    rl.close();
    await agent.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
