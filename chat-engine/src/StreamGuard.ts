import { ChatStreamGuardError } from './ChatApiError';
import type {
  ChatCompletionMessageRepsonse,
  ToolCallResponse,
} from './OpenAIChatApiClient';
import {
  extractTaggedThinkingContent,
  isRepetitionLoop,
} from './thinkingUtils';

/** Watchdog limits for a single streaming response. */
export interface StreamGuardOptions {
  /**
   * Abort after this many reasoning characters without answer text or tool
   * calls. 0/undefined disables this check.
   */
  maxReasoningCharsWithoutOutput?: number;
  /**
   * Abort after this many milliseconds. Also used as a hard read deadline.
   * 0/undefined disables this check.
   */
  maxDurationMs?: number;
}

/** Streamed-so-far classification used by local-model stream guards. */
export interface StreamProgress {
  /** True once the response has produced a real answer or a tool call. */
  hasOutput: boolean;
  /** Characters of pure reasoning streamed so far (no answer yet). */
  reasoningChars: number;
  /** Pure reasoning text streamed so far. */
  reasoningText: string;
}

export class OpenAIStreamGuard {
  constructor(protected readonly options: StreamGuardOptions) {}

  getMaxDurationMs(): number {
    return this.options.maxDurationMs ?? 0;
  }

  createDeadlineError(): ChatStreamGuardError {
    return new ChatStreamGuardError(
      'duration',
      `Stream aborted: the response ran longer than ${this.getMaxDurationMs()}ms without completing.`
    );
  }

  check(
    message: ChatCompletionMessageRepsonse,
    toolCallsTmp: Map<number, ToolCallResponse>,
    startedAt: number
  ): ChatStreamGuardError | null {
    if (
      this.options.maxDurationMs &&
      Date.now() - startedAt > this.options.maxDurationMs
    ) {
      return new ChatStreamGuardError(
        'duration',
        `Stream aborted: the response ran longer than ${this.options.maxDurationMs}ms without completing.`
      );
    }

    return null;
  }

  protected classifyStreamProgress(
    message: ChatCompletionMessageRepsonse,
    toolCallsTmp: Map<number, ToolCallResponse>
  ): StreamProgress {
    const reasoningText = message.reasoning ?? '';
    return {
      hasOutput: (message.content?.length ?? 0) > 0 || toolCallsTmp.size > 0,
      reasoningChars: reasoningText.length,
      reasoningText,
    };
  }
}

export class LocalStreamGuard extends OpenAIStreamGuard {
  override check(
    message: ChatCompletionMessageRepsonse,
    toolCallsTmp: Map<number, ToolCallResponse>,
    startedAt: number
  ): ChatStreamGuardError | null {
    const { hasOutput, reasoningChars, reasoningText } =
      this.classifyStreamProgress(message, toolCallsTmp);

    if (
      this.options.maxReasoningCharsWithoutOutput &&
      !hasOutput &&
      reasoningChars > this.options.maxReasoningCharsWithoutOutput
    ) {
      return new ChatStreamGuardError(
        'reasoning-loop',
        `Stream aborted: the model streamed ${reasoningChars} reasoning characters without producing any answer or tool call (likely a thinking loop).`
      );
    }

    if (!hasOutput && isRepetitionLoop(reasoningText)) {
      return new ChatStreamGuardError(
        'reasoning-loop',
        'Stream aborted: the model kept repeating the same reasoning without producing any answer or tool call (thinking loop).'
      );
    }

    return super.check(message, toolCallsTmp, startedAt);
  }

  protected override classifyStreamProgress(
    message: ChatCompletionMessageRepsonse,
    toolCallsTmp: Map<number, ToolCallResponse>
  ): StreamProgress {
    const content = message.content ?? '';
    const taggedThinking = extractTaggedThinkingContent(content);
    if (!taggedThinking.hasThinkingTag) {
      return super.classifyStreamProgress(message, toolCallsTmp);
    }

    const reasoningText =
      (message.reasoning ?? '') + taggedThinking.thinkingText;
    return {
      hasOutput: toolCallsTmp.size > 0 || taggedThinking.hasAnswer,
      reasoningChars: reasoningText.length,
      reasoningText,
    };
  }
}

export { isRepetitionLoop } from './thinkingUtils';
