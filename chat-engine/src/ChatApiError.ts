export class ChatApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export type ChatStreamGuardReason = 'reasoning-loop' | 'duration';

/**
 * Error thrown when an OpenAI-compatible chat endpoint returns a non-2xx
 * response.
 *
 * Includes the response body because local servers (LM Studio, Ollama) put the
 * real cause there — for example a context overflow surfaces as a 500/400 with that
 * text in the body.
 */
export class ChatApiHttpError extends ChatApiError {
  public readonly status: number;
  public readonly statusText: string;
  public readonly url: string;
  public readonly method: string;
  /** Raw response body (truncated to MAX_BODY_CHARS). Empty when unreadable. */
  public readonly body: string;

  private static readonly MAX_BODY_CHARS = 2000;

  constructor(params: {
    status: number;
    statusText: string;
    url: string;
    method: string;
    body: string;
  }) {
    const target = `${params.method} ${params.url}`;
    const bodyPart = params.body ? `\n${params.body}` : '';
    super(
      `Chat API request failed: ${target} returned ${params.status} ${params.statusText}${bodyPart}`
    );
    this.status = params.status;
    this.statusText = params.statusText;
    this.url = params.url;
    this.method = params.method;
    this.body = params.body;
  }

  /**
   * Build a ChatApiHttpError from a failed fetch Response, reading and
   * truncating its body. Safe to call on any non-ok response; never throws.
   */
  static async fromResponse(
    response: Response,
    request: { url: string; method: string }
  ): Promise<ChatApiHttpError> {
    let body = '';
    try {
      body = await response.text();
    } catch {
      // Body already consumed or not readable — keep the status-only message.
    }
    if (body.length > ChatApiHttpError.MAX_BODY_CHARS) {
      const omitted = body.length - ChatApiHttpError.MAX_BODY_CHARS;
      body = `${body.slice(0, ChatApiHttpError.MAX_BODY_CHARS)}… [${omitted} more chars truncated]`;
    }
    return new ChatApiHttpError({
      status: response.status,
      statusText: response.statusText,
      url: request.url,
      method: request.method,
      body: body.trim(),
    });
  }
}

/**
 * Thrown when the stream watchdog aborts an in-flight response because the model
 * kept streaming without finishing — typically a reasoning model (for example Gemma /
 * Qwen) stuck in an endless "thinking" loop that emits reasoning forever and
 * never produces an answer or a tool call. Without this, a single request never
 * returns and the agent appears frozen; the iteration cap cannot help because
 * the loop is INSIDE one request, not across turns.
 */
export class ChatStreamGuardError extends ChatApiError {
  public readonly reason: ChatStreamGuardReason;

  constructor(reason: ChatStreamGuardReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export class ChatApiValidationError extends ChatApiError {
  constructor(message: string) {
    super(message);
  }
}
