import { createChatClient } from '../factories/chatClientFactory';
import type { ModelConfig } from '../repositories/GlobalSettingRepository';
import logger from '../logger';

/** Short fallback title: the trimmed message, capped at 30 chars with an ellipsis. */
export function createFallbackTitle(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= 30) {
    return trimmed;
  }
  return `${trimmed.slice(0, 30)}...`;
}

/**
 * Generate a concise title from a message using the configured model, falling
 * back to a trimmed prefix when no model is set or the LLM call fails/aborts.
 * Shared by the chat threads and Agent projects so both title the
 * same way (and the agent stops just echoing the raw prompt). The call is
 * bounded (≤50 chars / 30s, then abort) so it can never hang a caller.
 */
export async function generateTitle(
  message: string,
  modelConfig: ModelConfig | null
): Promise<string | undefined> {
  if (!modelConfig) {
    return createFallbackTitle(message);
  }

  try {
    const chatClient = createChatClient({
      config: modelConfig,
      systemPrompt: {
        role: 'system',
        content: [
          {
            type: 'text',
            text: 'Do not use <think> tags. Respond directly. Summarize.'
          }
        ]
      }
    });

    // Abort after enough characters or a timeout to avoid long waits.
    const MAX_TITLE_CHARS = 50;
    const TIMEOUT_MS = 30000;
    const abortController = new AbortController();
    let collected = '';

    const timeout = setTimeout(() => {
      abortController.abort();
    }, TIMEOUT_MS);

    // Ignore thinking chunks — only collect actual response text.
    chatClient.setThinkingHandler(() => {});
    chatClient.setMessageHandler((chunk: string) => {
      collected += chunk;
      if (collected.length >= MAX_TITLE_CHARS) {
        abortController.abort();
      }
    });

    try {
      await chatClient.sendMessage(
        `Summarize the following in ~15 characters, preserving the original language: ${message}`,
        undefined,
        { signal: abortController.signal }
      );
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    const title = collected.trim();
    if (!title) return createFallbackTitle(message);
    return title.slice(0, 150) || undefined;
  } catch (error) {
    logger.warn('Failed to generate title via LLM, using fallback', {
      error: error instanceof Error ? error.message : String(error)
    });
    return createFallbackTitle(message);
  }
}
