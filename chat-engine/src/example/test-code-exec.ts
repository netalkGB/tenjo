/**
 * CUI verification of the in-process code-execution tool. Uses the same
 * tool exported by chat-engine that the llm-chat-ui server runs in
 * production.
 */

import * as readline from 'readline';

import { ChatClient, ChatStatus } from '../ChatClient.js';
import { LmStudioChatApiClient } from '../LmStudioChatApiClient.js';
import { bundleTools } from '../tools/types.js';
import { codeExecutionTool } from '../tools/code-execution/index.js';

async function main() {
  const { definitions, handlers } = bundleTools([codeExecutionTool]);

  const client = new ChatClient(
    new LmStudioChatApiClient({
      apiBaseUrl: process.env.LMSTUDIO_URL ?? 'http://localhost:1234/',
      apiKey: null,
      model: 'google/gemma-4-26b-a4b',
      tools: definitions,
    })
  );

  client.setMessageHandler((message: string) => {
    process.stdout.write(message);
  });
  client.setThinkingHandler((message: string) => {
    process.stdout.write(message);
  });
  client.setReasoningHandler((message: string) => {
    process.stdout.write(message);
  });
  client.setStatusHandler((status: ChatStatus) => {
    process.stdout.write(`\n[status: ${status}]\n`);
  });

  client.setToolCallStreamHandler((event) => {
    process.stdout.write(
      `\n[stream ${event.toolName}] ${event.argumentsDelta}`
    );
  });

  client.setSystemPrompt({
    role: 'system',
    content:
      'You are a helpful assistant. You may call the tenjo_execute_code tool to run JavaScript and observe its stdout/stderr.',
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (): Promise<string> =>
    new Promise((resolve) => rl.question('> ', resolve));

  const sendMessage = async (msg: string) => {
    await client.sendMessage(msg);

    let toolCalls = client.getToolCallPlan();
    while (toolCalls && toolCalls.length > 0) {
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
          const errorMsg = `[unknown tool ${name} — not wired in this demo]`;
          console.log(errorMsg);
          client.addToolCallResult(toolCall.id, { error: errorMsg });
          continue;
        }

        if (typeof parsed.code === 'string') {
          console.log('\n--- generated source ---');
          console.log(parsed.code);
          console.log('--- executing ---');
        }

        const result = await handler(parsed);

        if (
          result &&
          typeof result === 'object' &&
          'stdout' in result &&
          'stderr' in result
        ) {
          const r = result as {
            stdout: string;
            stderr: string;
            exitCode: number | null;
            signal: string | null;
            timedOut: boolean;
            durationMs: number;
          };
          console.log(
            `--- finished (exit=${r.exitCode}, signal=${r.signal}, timedOut=${r.timedOut}, ${r.durationMs}ms) ---`
          );
          if (r.stdout) console.log('[stdout]\n' + r.stdout);
          if (r.stderr) console.log('[stderr]\n' + r.stderr);
        }

        client.addToolCallResult(toolCall.id, result);
      }

      await client.validateToolCallResult();
      toolCalls = client.getToolCallPlan();
    }
  };

  console.log(
    'CUI code-execution demo. Type a request that should be answered by running JavaScript. Type "exit" to quit.'
  );

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

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
