import {
  OpenAIChatApiClient,
  type StreamGuardOptions,
} from './OpenAIChatApiClient';
import {
  LocalStreamGuard,
  OpenAIStreamGuard,
  isRepetitionLoop,
} from './StreamGuard';

export { isRepetitionLoop };

/**
 * Abstract base class for local LLM providers (LM Studio, Ollama, etc.).
 * Adds local-model stream handling on top of the OpenAI-compatible API.
 */
export abstract class LocalChatApiClient extends OpenAIChatApiClient {
  /**
   * Fetch the max context length for the configured model
   * from the provider's API.
   */
  abstract getMaxContextLength(): Promise<number | null>;

  protected override createStreamGuard(
    streamGuard: StreamGuardOptions
  ): OpenAIStreamGuard {
    return new LocalStreamGuard(streamGuard);
  }
}
