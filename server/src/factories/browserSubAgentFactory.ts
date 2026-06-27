import { BrowserResearchAgent } from 'tenjo-chat-engine';
import { createChatApiClient } from './chatClientFactory';
import type { ModelConfig } from '../repositories/GlobalSettingRepository';

/**
 * Hard wall-clock budget per research delegation. Past this the sub-agent
 * returns whatever it has so far with a timeout note appended to the answer.
 */
export const BROWSER_SUB_AGENT_TIMEOUT_MS = 200000;
export const BROWSER_SUB_AGENT_EXTENDED_TIMEOUT_MS = 600000;

/**
 * Build the browser-driving web-research sub-agent with the settings shared by
 * every surface (chat request and Agent session). Each caller gets its
 * own private Chromium so concurrent research tasks never share cookies or
 * scroll position — the caller is responsible for `close()`ing it.
 */
export function createBrowserSubAgent(
  modelConfig: ModelConfig,
  options: { extendedTimeoutEnabled?: boolean } = {}
): BrowserResearchAgent {
  return new BrowserResearchAgent({
    apiClientFactory: (subTools) => createChatApiClient(modelConfig, subTools),
    browserConfig: {
      headless: true,
      headlessMode: 'new',
      userAgent: 'Tenjo Browser Agent',
      requestDelay: { min: 100, max: 300 }
    },
    timeoutMs: options.extendedTimeoutEnabled
      ? BROWSER_SUB_AGENT_EXTENDED_TIMEOUT_MS
      : BROWSER_SUB_AGENT_TIMEOUT_MS
  });
}
