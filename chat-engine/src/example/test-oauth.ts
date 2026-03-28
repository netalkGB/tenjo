import * as readline from 'readline';
import * as http from 'http';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ChatClient, ChatStatus, MessageRequest } from '../ChatClient.js';
import { McpClientManager } from '../McpClientManager.js';
import { LmStudioChatApiClient } from '../LmStudioChatApiClient.js';
import { McpOAuthClientProvider } from '../McpOAuthClientProvider.js';

const CALLBACK_PORT = 9876;
const CALLBACK_PATH = '/oauth/callback';
const REDIRECT_URL = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const MCP_SERVER_URL = 'https://mcp.notion.com/sse';

/**
 * Start a local HTTP server to receive the OAuth callback.
 * Returns a promise that resolves with the authorization code.
 */
function startCallbackServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith(CALLBACK_PATH)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        const errorDescription =
          url.searchParams.get('error_description') ?? error;
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<html><body><h1>Authorization Failed</h1><p>${errorDescription}</p></body></html>`
        );
        server.close();
        reject(new Error(`OAuth error: ${errorDescription}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body><h1>Error</h1><p>No authorization code received.</p></body></html>'
        );
        server.close();
        reject(new Error('No authorization code in callback'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html><body><h1>Authorization Successful</h1><p>You can close this tab and return to the terminal.</p></body></html>'
      );

      server.close();
      resolve(code);
    });

    server.on('error', (err) => {
      reject(new Error(`Callback server error: ${err.message}`));
    });

    server.listen(CALLBACK_PORT, () => {
      console.log(
        `[OAuth] Callback server listening on http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`
      );
    });
  });
}

/**
 * Create an OAuth-authenticated StreamableHTTPClientTransport.
 * Performs the OAuth flow if needed, then returns a ready-to-use transport.
 */
async function createAuthenticatedTransport(): Promise<StreamableHTTPClientTransport> {
  const authProvider = new McpOAuthClientProvider({
    redirectUrl: REDIRECT_URL,
    clientName: 'MCP OAuth Test Client',
    onRedirectToAuthorization: (authorizationUrl) => {
      console.log('\n========================================');
      console.log('[OAuth] Authorization required.');
      console.log('[OAuth] Open the following URL in your browser:');
      console.log(authorizationUrl.toString());
      console.log('========================================\n');
    },
    onTokensSaved: () => {
      console.log('[OAuth] Tokens saved');
    },
    onClientInformationSaved: () => {
      console.log('[OAuth] Client information saved');
    },
    onCredentialsInvalidated: (scope) => {
      console.log(`[OAuth] Credentials invalidated (scope: ${scope})`);
    },
  });

  const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), {
    authProvider,
  });

  // Test if transport can start (i.e. already authorized)
  try {
    await transport.start();
    console.log('[OAuth] Already authorized.');
    // Transport started successfully but we need to return a fresh one
    // because McpClientManager.connect() will call start() again.
    await transport.close();
    return new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), { authProvider });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.constructor.name === 'UnauthorizedError' ||
        err.message.includes('Unauthorized'))
    ) {
      console.log(
        '[OAuth] Not yet authorized. Waiting for OAuth callback...'
      );

      const authorizationCode = await startCallbackServer();
      console.log('[OAuth] Authorization code received.');

      await transport.finishAuth(authorizationCode);
      console.log('[OAuth] Token exchange completed.');

      return new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), { authProvider });
    }

    throw err;
  }
}

async function main() {
  console.log('=== MCP OAuth Client Example ===');
  console.log(`Target: ${MCP_SERVER_URL}`);
  console.log();

  // 1. Authenticate and get transport
  const transport = await createAuthenticatedTransport();

  // 2. Connect via McpClientManager (same pattern as test.ts)
  const mcpClientManager = new McpClientManager(
    'mcp-oauth-test-client',
    '0.0.1'
  );
  mcpClientManager.setTransports([transport]);
  await mcpClientManager.connect();
  console.log('MCP Client connected');

  const tools = await mcpClientManager.getTools();

  // 3. Set up ChatClient with LM Studio
  const chatClient = new ChatClient(
    new LmStudioChatApiClient({
      apiBaseUrl: 'http://localhost:1234/',
      apiKey: null,
      model: 'openai/gpt-oss-120b',
      tools,
    })
  );

  chatClient.setMessageHandler((message: string) => {
    process.stdout.write(message);
  });

  chatClient.setThinkingHandler((message: string) => {
    process.stdout.write(message);
  });

  chatClient.setReasoningHandler((message: string) => {
    process.stdout.write(message);
  });

  chatClient.setStatusHandler((status: ChatStatus) => {
    console.log(`[Status] ${status}`);
  });

  chatClient.onContextAdded(
    (message: MessageRequest, allMessages: MessageRequest[]) => {
      console.log('\n[Context Added Event]');
      console.log(`Role: ${message.role}`);
      console.log(`Content length: ${message.content?.length || 0}`);
      console.log(`Total messages: ${allMessages.length}`);
      console.log('---');
    }
  );

  chatClient.setSystemPrompt({
    role: 'system',
    content:
      'You are a kind AI assistant. You can also execute MCP tools connected to Notion.',
  });

  // 4. Interactive chat loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question('> ', (answer) => {
        resolve(answer);
      });
    });
  };

  const confirmToolExecution = (
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
    await chatClient.sendMessage(msg, imageUrls);

    // Agentic tool-calling loop: keep executing until LLM gives a final text response
    let toolCalls = chatClient.getToolCallPlan();
    while (toolCalls && toolCalls.length > 0) {
      // Execute all tool calls in the current round
      for (const toolCall of toolCalls) {
        const { name, arguments: args } = toolCall.function;
        console.log(`\n[Tool execution requested: ${name}]`);

        const confirmed = await confirmToolExecution(name, args);
        if (!confirmed) {
          console.log('[Tool execution cancelled by user]');
          chatClient.addToolCallResult(toolCall.id, {
            error: 'Tool execution cancelled by user',
          });
          continue;
        }

        console.log(`[Executing tool: ${name}]`);
        try {
          const toolResult = await mcpClientManager.callTool(
            name,
            JSON.parse(args)
          );
          chatClient.addToolCallResult(toolCall.id, toolResult);
        } catch (error) {
          console.error(`Failed to execute MCP tool ${name}:`, error);
          chatClient.addToolCallResult(toolCall.id, {
            error: error instanceof Error ? error.message : '',
          });
        }
      }

      // Send all tool results back to LLM and get next response
      await chatClient.validateToolCallResult();
      toolCalls = chatClient.getToolCallPlan();
    }
  }

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
        console.log(JSON.stringify(chatClient.getMessages(), null, 2));
        continue;
      }

      if (userInput.trim() === '') {
        continue;
      }

      if (!userInput.includes('/image')) {
        await sendMessage(userInput);
      } else {
        const match = userInput.match(/\/image\s+(.+)$/);
        if (match) {
          const imagePath = match[1].trim();
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

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});
