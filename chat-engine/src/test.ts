import * as readline from 'readline';
//import { OpenAIChatApiClient } from './OpenAIChatApiClient.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ChatClient, ChatStatus } from './ChatClient.js';
import { McpClientManager } from './McpClientManager.js';
import { LmStudioChatApiClient } from './LmStudioChatApiClient.js';

async function main() {
  const mcpClientManager = new McpClientManager(
    'mcp-lm-studio-client',
    '0.0.0'
  );
  mcpClientManager.setTransports([
    new StdioClientTransport({
      command: '/Users/gb/.nodenv/shims/npx',
      args: [
        '-y',
        '@modelcontextprotocol/server-filesystem',
        '/Users/gb/Desktop',
      ],
    }),
  ]);
  await mcpClientManager.connect();
  console.log('MCP Client connected');

  const tools = await mcpClientManager.getTools();

  const client = new ChatClient(
    new LmStudioChatApiClient({
      apiBaseUrl: 'http://localhost:1234/',
      apiKey: null,
      model: 'openai/gpt-oss-120b',
      tools,
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
    console.log(`[Status] ${status}`);
  });

  // Reference implementation of onContextAdded event
  // Called each time context is added
  // In the future, database writes will be performed at this timing
  client.onContextAdded((message, allMessages) => {
    console.log('\n[Context Added Event]');
    console.log(`Role: ${message.role}`);
    console.log(`Content length: ${message.content?.length || 0}`);
    console.log(`Total messages: ${allMessages.length}`);
    console.log('---');

    // Example implementation for future DB persistence:
    // await db.saveMessage({
    //   role: message.role,
    //   content: message.content,
    //   tool_calls: message.tool_calls,
    //   timestamp: new Date(),
    // });
  });

  client.setSystemPrompt({
    role: 'system',
    content: 'You are a kind AI assistant. You can also execute MCP.',
  });

  const askQuestion = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question('> ', (answer) => {
        resolve(answer);
      });
    });
  };

  const confirmToolExecution = async (
    toolName: string,
    toolArgs: string
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      rl.question(
        `\n[Tool Execution Confirmation]\nTool: ${toolName}\nArgs: ${toolArgs}\nExecute this tool? (y/n): `,
        (answer) => {
          resolve(
            answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
          );
        }
      );
    });
  };

  async function sendMessage(msg: string, imageUrls?: string[]) {
    await client.sendMessage(msg, imageUrls);
    const toolCalls = client.getToolCallPlan();
    if (toolCalls == null) {
      return;
    }
    for (const toolCall of toolCalls) {
      const { name, arguments: args } = toolCall.function;
      console.log(`\n[Tool execution requested: ${name}]`);

      // Confirmation of tool execution
      const confirmed = await confirmToolExecution(name, args);
      if (!confirmed) {
        console.log('[Tool execution cancelled by user]');
        client.addToolCallResult(toolCall.id, {
          error: 'Tool execution cancelled by user',
        });
        await client.validateToolCallResult();
        continue;
      }

      console.log(`[Executing tool: ${name}]`);
      try {
        const toolResult = await mcpClientManager.callTool(
          name,
          JSON.parse(args)
        );
        client.addToolCallResult(toolCall.id, toolResult);
      } catch (error) {
        console.error(`Failed to execute MCP tool ${name}:`, error);
        client.addToolCallResult(toolCall.id, {
          error: error instanceof Error ? error.message : '',
        });
        throw error;
      }
      await client.validateToolCallResult();
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(
    'Starting chat. Enter a message and press Enter to send. Type "exit" to exit.'
  );

  while (true) {
    try {
      const userInput = await askQuestion();

      if (userInput.toLowerCase() === 'exit') {
        console.log('Ending chat.');
        break;
      }

      if (userInput.startsWith('/message')) {
        console.log(JSON.stringify(client.getMessages(), null, 2));
        continue;
      }

      if (userInput.trim() === '') {
        continue;
      }

      if (!userInput.includes('/image')) {
        await sendMessage(userInput);
      } else {
        // Extract the path after the space following /image
        const match = userInput.match(/\/image\s+(.+)$/);
        if (match) {
          const imagePath = match[1].trim();

          // Pass the file path as-is (base64 conversion is performed by OpenAIChatApiClient during transmission)
          const messageWithoutImage = userInput
            .replace(/\/image\s+.+$/, '')
            .trim();
          await sendMessage(messageWithoutImage, [imagePath]);
        } else {
          console.log(
            'Invalid /image command format. Use: /image <path-to-image-file>'
          );
        }
      }
      process.stdout.write('\n');
    } catch (error) {
      console.error('An error occurred:', error);
    }
  }

  rl.close();

  mcpClientManager.close();
}

main().catch(console.error);
