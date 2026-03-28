import {
  OpenAIChatApiClient,
  type ChatCompletionMessageRequest,
  type ChatCompletionMessageRepsonse,
} from './OpenAIChatApiClient';

/**
 * Abstract base class for local LLM providers (LM Studio, Ollama, etc.).
 * Ensures a model is loaded before the first chat request.
 * If a model is already running, it is used as-is.
 * If nothing is running, the subclass loads the model with max context length.
 */
export abstract class LocalChatApiClient extends OpenAIChatApiClient {
  private modelLoaded = false;

  /**
   * Check whether a model is already running and load one if not.
   * Called once before the first request. Implementations should:
   * 1. Return immediately if a model is already running.
   * 2. Otherwise, load this.model with its maximum context length.
   */
  protected abstract loadModelIfNeeded(): Promise<void>;

  /**
   * Fetch the max context length for the configured model
   * from the provider's API.
   */
  abstract getMaxContextLength(): Promise<number | null>;

  private async ensureModelLoaded(): Promise<void> {
    if (this.modelLoaded) return;
    this.modelLoaded = true;
    await this.loadModelIfNeeded();
  }

  public override async chatStream(
    messages: ChatCompletionMessageRequest[],
    signal?: AbortSignal
  ): Promise<ChatCompletionMessageRepsonse> {
    await this.ensureModelLoaded();
    return super.chatStream(messages, signal);
  }

  public override async validateToolCallResult(
    messages: ChatCompletionMessageRequest[],
    signal?: AbortSignal
  ): Promise<ChatCompletionMessageRepsonse> {
    await this.ensureModelLoaded();
    return super.validateToolCallResult(messages, signal);
  }
}
