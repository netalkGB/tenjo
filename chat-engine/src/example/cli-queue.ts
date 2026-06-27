import * as readline from 'readline';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ChatClient, ChatStatus, MessageRequest } from '../ChatClient.js';
import { ChatAgent, AgentToolCall, QueuedItem } from '../ChatAgent.js';
import { McpClientManager } from '../McpClientManager.js';
import { LmStudioChatApiClient } from '../LmStudioChatApiClient.js';

async function main() {
  const mcpClientManager = new McpClientManager(
    'mcp-lm-studio-client',
    '0.0.0'
  );
  const npxCommand = process.env.MCP_NPX ?? 'npx';
  const fsDir = process.env.MCP_FS_DIR ?? process.env.HOME ?? process.cwd();
  mcpClientManager.setTransports([
    new StdioClientTransport({
      command: npxCommand,
      args: ['-y', '@modelcontextprotocol/server-filesystem', fsDir],
    }),
  ]);
  await mcpClientManager.connect();
  console.log('MCP Client connected');

  const tools = await mcpClientManager.getTools();

  const client = new ChatClient(
    new LmStudioChatApiClient({
      apiBaseUrl: 'http://localhost:1234/',
      apiKey: null,
      model: 'google/gemma-4-26b-a4b',
      tools,
    })
  );

  client.setSystemPrompt({
    role: 'system',
    content: 'You are a kind AI assistant. You can also execute MCP.',
  });

  let approvalResolver: ((approved: boolean) => void) | null = null;

  const askApproval = (toolCall: AgentToolCall): Promise<boolean> => {
    return new Promise((resolve) => {
      console.log(
        `\n[Tool approval required]\nTool: ${toolCall.function.name}\nArgs: ${toolCall.function.arguments}\nApprove? (y/n): `
      );
      approvalResolver = resolve;
    });
  };

  const agent = new ChatAgent(client, {
    drainStrategy: 'coalesce',
    executeTool: async (toolCall: AgentToolCall) => {
      const approved = await askApproval(toolCall);
      if (!approved) {
        console.log('[Tool rejected]');
        return { approved: false };
      }
      const { name, arguments: args } = toolCall.function;
      console.log(`\n[Executing tool: ${name}]`);
      try {
        const result = await mcpClientManager.callTool(name, JSON.parse(args));
        return { approved: true, result };
      } catch (error) {
        return {
          approved: true,
          result: { error: error instanceof Error ? error.message : '' },
        };
      }
    },
  });

  agent.onMessage((message: string) => {
    process.stdout.write(message);
  });
  agent.onThinking((message: string) => {
    process.stdout.write(message);
  });
  agent.onReasoning((message: string) => {
    process.stdout.write(message);
  });
  agent.onStatus((status: ChatStatus) => {
    console.log(`\n[Status] ${status}`);
  });
  agent.onToolCallStream((event) => {
    process.stdout.write(
      `[ToolCallStream ${event.toolName}] ${event.argumentsDelta}`
    );
  });
  agent.onMessageAdded(
    (message: MessageRequest, allMessages: MessageRequest[]) => {
      console.log(
        `\n[Message Added] role=${message.role} total=${allMessages.length}`
      );
    }
  );

  const printQueue = (queue: readonly QueuedItem[]): void => {
    if (queue.length === 0) {
      console.log('  (queue empty)');
      return;
    }
    for (const item of queue) {
      const label = item.text.length > 0 ? item.text : '(image only)';
      console.log(`  [${item.status}] ${item.id.slice(0, 8)} ${label}`);
    }
  };

  agent.onTurnStart((items) => {
    console.log(`\n[turn start] ${items.map((i) => i.text).join(' | ')}`);
  });
  agent.onTurnComplete((items, result) => {
    const answer =
      typeof result.assistantMessage?.content === 'string'
        ? result.assistantMessage.content
        : '';
    console.log(
      `\n[turn done] ${items.map((i) => i.text).join(' | ')}` +
        (answer ? ` -> ${answer.length} chars` : '')
    );
  });
  agent.onError((error, items) => {
    console.error(
      `\n[turn error] "${items.map((i) => i.text).join(' | ')}": ${error.message}`
    );
  });
  agent.onIdle(() => {
    console.log('\n[idle — queue empty]');
  });
  agent.onQueueChanged((queue) => {
    const pending = queue.filter((i) => i.status === 'queued').length;
    if (pending > 0) {
      console.log(`\n[pending queued: ${pending}]`);
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(
    'Queueing chat. Type and press Enter to submit (you can type while a response streams).'
  );
  console.log('Commands: /exit, /queue, /image <path> [text]');

  rl.on('line', (line) => {
    const input = line.trim();

    if (approvalResolver) {
      const resolve = approvalResolver;
      approvalResolver = null;
      const yes = input.toLowerCase() === 'y' || input.toLowerCase() === 'yes';
      resolve(yes);
      return;
    }

    if (input === '/exit') {
      rl.close();
      return;
    }

    if (input === '/queue') {
      printQueue(agent.getQueue());
      return;
    }

    if (input === '') {
      return;
    }

    if (input.startsWith('/image')) {
      const match = input.match(/\/image\s+(\S+)\s*(.*)$/);
      if (!match) {
        console.log('Usage: /image <path> [text]');
        return;
      }
      const imagePath = match[1];
      const text = match[2] ?? '';
      const id = agent.submit(text, [imagePath]);
      console.log(`[queued ${id.slice(0, 8)}] (image) ${text}`);
      return;
    }

    const id = agent.submit(input);
    if (agent.isRunning()) {
      console.log(`[queued ${id.slice(0, 8)}] ${input}`);
    }
  });

  rl.on('close', async () => {
    console.log('\nDraining queue before exit...');
    await agent.waitForIdle();
    await mcpClientManager.close();
    process.exit(0);
  });
}

main().catch(console.error);
