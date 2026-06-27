import { MessageRole, type MessageRequest } from './ChatClient';

/**
 * Context-window estimation and compaction helpers for agentic loops.
 *
 * A coding agent accumulates large tool outputs (file reads, bash logs) in its
 * message history. Once the running conversation approaches the model's context
 * window, the next request overflows and the server returns an error (often a
 * bare 500 from a local LM Studio / Ollama backend). These helpers let a
 * consumer (a) see how much of the window is left and (b) shrink the history
 * before it overflows.
 *
 * Token counts here are HEURISTIC estimates (no tokenizer dependency): ~4
 * characters per token plus a small per-message overhead, which tracks real
 * tokenizers closely enough to drive a "compact when we cross N%" decision.
 * They are intentionally conservative — pair with a generous `reservedOutputTokens`.
 */

/** Average characters per token used by the heuristic estimator. */
const CHARS_PER_TOKEN = 4;
/** Per-message structural overhead (role, delimiters) in tokens. */
const PER_MESSAGE_OVERHEAD_TOKENS = 4;
/** Flat token cost charged for an image part (the real cost varies by model). */
const IMAGE_PART_TOKENS = 1000;
/** Text left in place of an image whose base64 payload has been evicted. */
const EVICTED_IMAGE_STUB = '[image omitted to fit the context window]';

const DEFAULT_RESERVED_OUTPUT_TOKENS = 2048;
// Act EARLY: LLM quality degrades ("context rot" / lost-in-the-middle) long
// before the window is full, so compaction triggers at half-full, not near the
// limit, and aims to bring usage back down to ~40% of the window.
const DEFAULT_COMPACT_THRESHOLD_RATIO = 0.5;
const DEFAULT_TARGET_RATIO = 0.4;
const DEFAULT_RECENT_MESSAGES_TO_KEEP = 8;
const DEFAULT_TOOL_RESULT_CHARS = 2000;

export interface ContextUsage {
  /** Heuristic token count of the supplied messages. */
  estimatedTokens: number;
  /** Model context window in tokens, or null when unknown. */
  maxContextTokens: number | null;
  /** Tokens held back for the model's response. */
  reservedTokens: number;
  /**
   * Tokens still available for input (max - estimated - reserved), clamped at
   * 0. null when the window size is unknown.
   */
  remainingTokens: number | null;
  /** estimatedTokens / maxContextTokens, or null when the window is unknown. */
  usedRatio: number | null;
}

export interface CompactionOptions {
  /** Model context window in tokens. */
  maxContextTokens: number;
  /** Tokens to hold back for the response (defines the HARD budget). Default 2048. */
  reservedOutputTokens?: number;
  /**
   * Start compacting once estimated usage crosses this fraction of the window.
   * Default 0.5 — deliberately early, because model quality drops well before
   * the window fills. Below the threshold the input is returned unchanged.
   */
  compactThresholdRatio?: number;
  /**
   * Soft target the compaction aims to bring usage back down to, as a fraction
   * of the window. Default 0.4. Reached by trimming only OLD output; the recent
   * window is never sacrificed just to hit this target.
   */
  targetRatio?: number;
  /** Most recent N messages kept verbatim (never trimmed by the soft pass). Default 8. */
  recentMessagesToKeep?: number;
  /** Char cap applied to older tool/text contents in the first tier. Default 2000. */
  maxToolResultChars?: number;
  /** Builds the elision marker inserted into truncated content. */
  truncationMarker?: (omittedChars: number) => string;
}

export interface CompactionResult {
  /** The (possibly truncated) messages to send. Same array identity when unchanged. */
  messages: MessageRequest[];
  /** True when any content was truncated. */
  compacted: boolean;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

/** Heuristic token estimate for a single text string. */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Heuristic token estimate for one message (string or content-part array). */
export function estimateMessageTokens(message: MessageRequest): number {
  let tokens = PER_MESSAGE_OVERHEAD_TOKENS;
  const { content } = message;
  if (typeof content === 'string') {
    tokens += estimateTextTokens(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === 'text') {
        tokens += estimateTextTokens(part.text);
      } else {
        tokens += IMAGE_PART_TOKENS;
      }
    }
  }
  // Tool-call arguments live alongside content and also cost tokens.
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      tokens += estimateTextTokens(call.function.name);
      tokens += estimateTextTokens(call.function.arguments);
    }
  }
  return tokens;
}

/** Heuristic token estimate for a whole message array. */
export function estimateMessagesTokens(messages: MessageRequest[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }
  return total;
}

/**
 * Report how much of the context window the messages occupy and how much input
 * room is left. `remainingTokens` / `usedRatio` are null when the window size
 * is unknown (for example a remote provider that does not expose it).
 */
export function getContextUsage(
  messages: MessageRequest[],
  options: { maxContextTokens: number | null; reservedOutputTokens?: number }
): ContextUsage {
  const estimatedTokens = estimateMessagesTokens(messages);
  const reservedTokens =
    options.reservedOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS;
  const max = options.maxContextTokens;
  if (max === null) {
    return {
      estimatedTokens,
      maxContextTokens: null,
      reservedTokens,
      remainingTokens: null,
      usedRatio: null,
    };
  }
  return {
    estimatedTokens,
    maxContextTokens: max,
    reservedTokens,
    remainingTokens: Math.max(0, max - estimatedTokens - reservedTokens),
    usedRatio: estimatedTokens / max,
  };
}

function defaultTruncationMarker(omittedChars: number): string {
  return `\n… [${omittedChars} chars truncated to fit the context window] …\n`;
}

/** Keep a head and tail of a long string, eliding the middle. */
function truncateContent(
  content: string,
  maxChars: number,
  marker: (omitted: number) => string
): string {
  if (content.length <= maxChars) return content;
  const headChars = Math.ceil(maxChars * 0.6);
  const tailChars = Math.floor(maxChars * 0.4);
  const omitted = content.length - headChars - tailChars;
  return (
    content.slice(0, headChars) +
    marker(omitted) +
    content.slice(content.length - tailChars)
  );
}

/**
 * Replace every image part of an array-content message with a small text stub,
 * dropping its (often megabyte-scale) base64 payload. Returns the SAME message
 * reference when there is no image part, so callers can cheaply tell whether
 * anything changed.
 */
function evictImageParts(message: MessageRequest): MessageRequest {
  if (!Array.isArray(message.content)) return message;
  if (!message.content.some((part) => part.type === 'image_url'))
    return message;
  const content = message.content.map((part) =>
    part.type === 'image_url'
      ? { type: 'text' as const, text: EVICTED_IMAGE_STUB }
      : part
  );
  return { ...message, content };
}

const THINK_OPEN_TAG = '<think>';
const THINK_CLOSE_TAG = '</think>';

/**
 * Remove chain-of-thought from a text blob: every closed <think>...</think>
 * block, plus any unclosed trailing <think> (a stream cut off mid-thought, so
 * everything after it is reasoning). Returns the SAME string when it holds no
 * think tag, so callers can cheaply detect "unchanged".
 */
function stripThinkBlocks(text: string): string {
  if (!text.includes(THINK_OPEN_TAG)) return text;
  let out = '';
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf(THINK_OPEN_TAG, cursor);
    if (open === -1) {
      out += text.slice(cursor);
      break;
    }
    out += text.slice(cursor, open);
    const close = text.indexOf(THINK_CLOSE_TAG, open + THINK_OPEN_TAG.length);
    if (close === -1) break; // unclosed trailing think — drop to the end
    cursor = close + THINK_CLOSE_TAG.length;
  }
  return out.trim();
}

/** Strip thinking from one message; returns the SAME reference when unchanged. */
function stripThinkingFromMessage(message: MessageRequest): MessageRequest {
  const hadReasoning = message.reasoning !== undefined;
  let nextContent = message.content;
  if (typeof message.content === 'string') {
    nextContent = stripThinkBlocks(message.content);
  } else if (Array.isArray(message.content)) {
    let partsChanged = false;
    const parts = message.content.map((part) => {
      if (part.type !== 'text') return part;
      const stripped = stripThinkBlocks(part.text);
      if (stripped === part.text) return part;
      partsChanged = true;
      return { ...part, text: stripped };
    });
    if (partsChanged) nextContent = parts;
  }
  if (nextContent === message.content && !hadReasoning) return message;
  // Drop the dedicated reasoning field; keep every other field intact.
  const { reasoning: _reasoning, ...rest } = message;
  return { ...rest, content: nextContent };
}

/**
 * Strip chain-of-thought before the history is sent to the model: remove
 * <think>...</think> blocks from text content and drop the `reasoning` field.
 * The stored history keeps the thinking for display — this only reshapes the
 * OUTGOING copy. CoT must NOT accumulate in the history: it bloats the context
 * window and feeds the model its own prior reasoning, which can drive thinking
 * loops. Pure: returns the SAME array reference when nothing changed.
 */
export function stripThinkingFromMessages(
  messages: MessageRequest[]
): MessageRequest[] {
  let changed = false;
  const out = messages.map((message) => {
    const stripped = stripThinkingFromMessage(message);
    if (stripped !== message) changed = true;
    return stripped;
  });
  return changed ? out : messages;
}

/**
 * Keep a message history lean so the model stays in its high-quality regime,
 * WITHOUT dropping or reordering any message. The text content of older messages
 * is truncated, and the base64 of older images is evicted (the model has already
 * seen them, but their bytes otherwise ride along on every later request); the
 * system message (index 0) and the final message are always left intact, and
 * `tool_calls` arrays are never touched — so every assistant tool_call keeps its
 * matching tool result and the request stays structurally valid.
 *
 * Two stages, because avoiding the overflow ERROR and preserving model QUALITY
 * are different goals:
 *
 *  1. Soft pass (quality): once usage crosses `compactThresholdRatio` (early —
 *     ~50% by default, since quality rots long before the window fills), trim
 *     ONLY the bulky output of messages OLDER than the recent window, aiming to
 *     bring usage down to `targetRatio` (~40%). The recent working set is never
 *     sacrificed just to hit this target.
 *  2. Hard pass (overflow safety): only if usage is STILL above the reserved
 *     hard budget after the soft pass does it progressively encroach on the
 *     recent window — a last resort to avoid an actual context-overflow error.
 *
 * Returns the original array unchanged when usage is under the threshold and no
 * old image needs evicting.
 */
export function compactMessages(
  messages: MessageRequest[],
  options: CompactionOptions
): CompactionResult {
  const reserved =
    options.reservedOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS;
  const threshold =
    options.compactThresholdRatio ?? DEFAULT_COMPACT_THRESHOLD_RATIO;
  const targetRatio = options.targetRatio ?? DEFAULT_TARGET_RATIO;
  const recentKeep =
    options.recentMessagesToKeep ?? DEFAULT_RECENT_MESSAGES_TO_KEEP;
  const toolCap = options.maxToolResultChars ?? DEFAULT_TOOL_RESULT_CHARS;
  const marker = options.truncationMarker ?? defaultTruncationMarker;

  const hardBudget = Math.max(0, options.maxContextTokens - reserved);
  const triggerAt = options.maxContextTokens * threshold;
  const softTarget = Math.min(
    hardBudget,
    options.maxContextTokens * targetRatio
  );
  const hasSystem = messages[0]?.role === 'system';
  const lastIdx = messages.length - 1;
  const recentStart = Math.max(0, messages.length - recentKeep);

  // Build a truncated copy from the ORIGINAL messages at the given caps (always
  // from the original, so re-running at a smaller cap never nests markers).
  // `oldCap` applies to messages before the recent window; `recentCap`
  // (Infinity = untouched) to the recent window. System + last are never cut.
  // OLD images additionally have their base64 evicted (independent of the char
  // caps, so it also runs in the no-truncation pass); recent images are kept so
  // the active task can still reference a just-attached screenshot.
  const build = (oldCap: number, recentCap: number): MessageRequest[] =>
    messages.map((message, index) => {
      const isProtected = (index === 0 && hasSystem) || index === lastIdx;
      if (isProtected) return message;
      const isOld = index < recentStart;
      if (typeof message.content !== 'string') {
        return isOld ? evictImageParts(message) : message;
      }
      const cap = isOld ? oldCap : recentCap;
      if (message.content.length <= cap) return message;
      return {
        ...message,
        content: truncateContent(message.content, cap, marker),
      };
    });

  // True when an OLD (pre-recent-window, non-system) message still carries an
  // image: its base64 is invisible to the token estimate yet costs real
  // bandwidth on every request, so it is worth evicting even below the threshold.
  const hasOldImages = messages.some((message, index) => {
    if (index >= recentStart || (index === 0 && hasSystem)) return false;
    return (
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image_url')
    );
  });

  const before = estimateMessagesTokens(messages);
  if (before <= triggerAt) {
    // Under the text-compaction threshold: skip text truncation, but still evict
    // old image base64 so an image-heavy session does not grow the on-wire
    // payload unbounded. Silent (compacted=false) to avoid a per-turn log once
    // an image has scrolled out of the recent window.
    const trimmed = hasOldImages ? build(Infinity, Infinity) : messages;
    return {
      messages: trimmed,
      compacted: false,
      estimatedTokensBefore: before,
      estimatedTokensAfter:
        trimmed === messages ? before : estimateMessagesTokens(trimmed),
    };
  }

  // Stage 1 — soft pass: trim only OLD output (recent window untouched) until we
  // reach the soft target or run out of old material to trim.
  let compacted = messages;
  let after = before;
  for (const oldCap of [toolCap, 1000, 500, 200]) {
    compacted = build(oldCap, Infinity);
    after = estimateMessagesTokens(compacted);
    if (after <= softTarget) break;
  }

  // Stage 2 — hard pass: only if we are still over the hard budget (for example the
  // recent window alone is enormous), encroach on the recent window too.
  if (after > hardBudget) {
    for (const [oldCap, recentCap] of [
      [200, 4000],
      [200, 1500],
      [200, 400],
    ] as Array<[number, number]>) {
      compacted = build(oldCap, recentCap);
      after = estimateMessagesTokens(compacted);
      if (after <= hardBudget) break;
    }
  }

  return {
    messages: compacted,
    compacted: after < before,
    estimatedTokensBefore: before,
    estimatedTokensAfter: after,
  };
}

// ---- Summarization-based compaction --------------------------------------
//
// compactMessages above is non-destructive TRUNCATION (cheap, instant, lossy in
// a "keep head+tail" way). The functions below are the heavier, higher-quality
// alternative: fold the messages OLDER than the recent window into a rolling
// LLM-generated summary kept in the system message, then drop them. This
// preserves decisions / plan / what-was-tried that blind truncation discards, at
// the cost of one extra model call — so it runs at a turn boundary, and callers
// keep the truncation transform installed as the real overflow backstop.

/** Per-message char cap when rendering the old span for the summarizer, so a
 *  single huge tool output cannot blow the summarizer's own context window. */
const SUMMARY_INPUT_PER_MESSAGE_CHARS = 2000;
/** Heading under which the rolling summary is embedded in the system message. */
const SUMMARY_SYSTEM_HEADING = '# Summary of earlier conversation';

export interface SummarizeInput {
  /** The running summary so far ('' on the first compaction). */
  previousSummary: string;
  /** The newly-evicted conversation span, rendered as plain text. */
  conversationText: string;
}

export interface SummarizeOldMessagesOptions {
  /** Model context window in tokens. */
  maxContextTokens: number;
  /**
   * Summarize once estimated usage crosses this fraction of the window.
   * Default 0.5. Below it the history is returned unchanged.
   */
  compactThresholdRatio?: number;
  /** Most recent N messages kept verbatim (never summarized). Default 8. */
  recentMessagesToKeep?: number;
  /** Original system prompt WITHOUT any embedded summary. */
  baseSystemPrompt: string;
  /** The running summary so far ('' if none yet). */
  previousSummary: string;
  /** Performs the LLM summarization. Return '' to signal "skip" (history kept). */
  summarize: (input: SummarizeInput) => Promise<string>;
  /** Embed the summary into the system message. Default appends under a heading. */
  renderSystem?: (baseSystemPrompt: string, summary: string) => string;
  /** Render one message into the summarizer's text input. */
  renderMessage?: (message: MessageRequest) => string;
}

export interface SummarizeOldMessagesResult {
  /** New history when summarized; the SAME reference when not. */
  messages: MessageRequest[];
  /** Updated running summary (unchanged when not summarized). */
  summary: string;
  /** True when old messages were folded into the summary. */
  summarized: boolean;
  /** Count of messages folded into the summary. */
  summarizedMessageCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

/** Default: append the rolling summary to the original system prompt. */
function renderSystemWithSummary(
  baseSystemPrompt: string,
  summary: string
): string {
  if (!summary) return baseSystemPrompt;
  return (
    `${baseSystemPrompt}\n\n${SUMMARY_SYSTEM_HEADING}\n` +
    'Earlier turns were condensed to fit the context window. Treat the ' +
    'following as established context for what has already happened:\n\n' +
    summary
  );
}

/** Default: render one message as `ROLE: text` for the summarizer's input. */
function renderMessageForSummary(message: MessageRequest): string {
  // Strip thinking first: the summary is fed back to the model as context, so
  // folding raw chain-of-thought into it would re-introduce the very CoT the
  // outgoing transform removes.
  let text: string;
  if (typeof message.content === 'string') {
    text = stripThinkBlocks(message.content);
  } else if (Array.isArray(message.content)) {
    text = message.content
      .map((part) =>
        part.type === 'text' ? stripThinkBlocks(part.text) : '[image]'
      )
      .join(' ');
  } else {
    text = '';
  }
  if (text.length > SUMMARY_INPUT_PER_MESSAGE_CHARS) {
    text = truncateContent(
      text,
      SUMMARY_INPUT_PER_MESSAGE_CHARS,
      defaultTruncationMarker
    );
  }
  let line = `${message.role.toUpperCase()}: ${text}`.trim();
  if (message.tool_calls && message.tool_calls.length > 0) {
    const calls = message.tool_calls
      .map((call) => `${call.function.name}(${call.function.arguments})`)
      .join(', ');
    line += `\n[called tools: ${calls}]`;
  }
  return line;
}

/**
 * Compaction by SUMMARIZATION. When estimated usage crosses the threshold, the
 * messages older than the recent window are folded into a rolling summary
 * embedded in the system message, and those messages are dropped — returning a
 * NEW, shorter array meant to REPLACE the stored history (unlike compactMessages,
 * which is a non-destructive outgoing transform). Run it at a turn boundary, not
 * mid-tool-loop.
 *
 * Safety:
 *  - The cut never orphans a tool result (it is advanced past the leading tool
 *    messages of the kept window), so tool_call/result pairing stays valid.
 *  - If `summarize` returns '' (failure / empty), the history is returned
 *    UNCHANGED — a failed summary never destroys context. Pair it with the
 *    truncation transform as the real overflow backstop.
 *  - Returns the input unchanged when usage is under the threshold or there is
 *    nothing older than the recent window to summarize.
 */
export async function summarizeOldMessages(
  messages: MessageRequest[],
  options: SummarizeOldMessagesOptions
): Promise<SummarizeOldMessagesResult> {
  const threshold =
    options.compactThresholdRatio ?? DEFAULT_COMPACT_THRESHOLD_RATIO;
  const recentKeep =
    options.recentMessagesToKeep ?? DEFAULT_RECENT_MESSAGES_TO_KEEP;
  const renderSystem = options.renderSystem ?? renderSystemWithSummary;
  const renderMessage = options.renderMessage ?? renderMessageForSummary;

  const before = estimateMessagesTokens(messages);
  const unchanged: SummarizeOldMessagesResult = {
    messages,
    summary: options.previousSummary,
    summarized: false,
    summarizedMessageCount: 0,
    estimatedTokensBefore: before,
    estimatedTokensAfter: before,
  };
  if (before <= options.maxContextTokens * threshold) return unchanged;

  const hasSystem = messages[0]?.role === MessageRole.SYSTEM;
  const firstIdx = hasSystem ? 1 : 0;
  const recentStart = Math.max(firstIdx, messages.length - recentKeep);
  let cut = recentStart;
  // Never start the kept window on an orphaned tool result (its tool_call would
  // have been summarized away); pull leading tool messages into the old span.
  while (cut < messages.length && messages[cut]?.role === MessageRole.TOOL) {
    cut++;
  }
  if (cut <= firstIdx) return unchanged; // nothing old enough to summarize

  const span = messages.slice(firstIdx, cut);
  const conversationText = span.map(renderMessage).join('\n\n');
  const newSummary = (
    await options.summarize({
      previousSummary: options.previousSummary,
      conversationText,
    })
  ).trim();
  if (!newSummary) return unchanged; // summarizer failed / empty: keep history

  const systemMessage: MessageRequest = {
    role: MessageRole.SYSTEM,
    content: renderSystem(options.baseSystemPrompt, newSummary),
  };
  const newMessages = [systemMessage, ...messages.slice(cut)];
  return {
    messages: newMessages,
    summary: newSummary,
    summarized: true,
    summarizedMessageCount: span.length,
    estimatedTokensBefore: before,
    estimatedTokensAfter: estimateMessagesTokens(newMessages),
  };
}

// ---- Non-destructive summarization (full history preserved) ----------------
//
// summarizeOldMessages above REPLACES the stored history (for callers that keep
// only what the model sees). The pieces below keep the FULL history as the single
// source of truth and treat the summary as DATA applied only on the way out:
//
//  - CompactionState = { summary, coveredCount }: the first `coveredCount`
//    non-system messages are represented by `summary`.
//  - applySummaryToMessages(full, state): build the condensed OUTGOING array from
//    the full history + state (pure; never mutates the full history).
//  - summarizeIncremental(full, state, ...): generate the NEXT state by folding
//    only the newly-aged-out span into the rolling summary; triggers on the
//    OUTGOING size (the full history grows forever, so it must not be the gauge).
//
// A consumer keeps the full history in ChatClient, applies the state in the
// outgoing transform, and persists the state for restore. See ChatAgent's
// get/setCompactionState + export/restoreState and the coding-agent example.

/** Rolling-summary compaction state held alongside the full message history. */
export interface CompactionState {
  /** Rolling summary of the covered span ('' = none yet). */
  summary: string;
  /** Number of leading non-system messages represented by `summary`. */
  coveredCount: number;
}

/**
 * Build the condensed OUTGOING message array from the FULL history and a
 * CompactionState: the first `coveredCount` non-system messages are dropped and
 * the rolling summary is embedded in the system message. Pure — the full history
 * is never mutated. Returns the input unchanged when there is nothing to apply.
 */
export function applySummaryToMessages(
  messages: MessageRequest[],
  state: CompactionState,
  options: { renderSystem?: (base: string, summary: string) => string } = {}
): MessageRequest[] {
  const covered = Math.max(0, state.coveredCount);
  if (!state.summary && covered === 0) return messages;
  const renderSystem = options.renderSystem ?? renderSystemWithSummary;
  const hasSystem = messages[0]?.role === MessageRole.SYSTEM;
  const firstIdx = hasSystem ? 1 : 0;
  const kept = messages.slice(firstIdx + covered);
  if (!hasSystem) {
    return state.summary
      ? [
          {
            role: MessageRole.SYSTEM,
            content: renderSystem('', state.summary),
          },
          ...kept,
        ]
      : kept;
  }
  const base =
    typeof messages[0].content === 'string' ? messages[0].content : '';
  const system: MessageRequest = state.summary
    ? { role: MessageRole.SYSTEM, content: renderSystem(base, state.summary) }
    : messages[0];
  return [system, ...kept];
}

export interface SummarizeIncrementalOptions {
  /** Model context window in tokens. */
  maxContextTokens: number;
  /** Summarize once the OUTGOING view crosses this fraction. Default 0.5. */
  compactThresholdRatio?: number;
  /** Most recent N messages kept verbatim (never summarized). Default 8. */
  recentMessagesToKeep?: number;
  /** Current rolling summary ('' if none). */
  previousSummary: string;
  /** Current covered-message count. */
  coveredCount: number;
  /** Performs the LLM summarization. Return '' to signal "skip". */
  summarize: (input: SummarizeInput) => Promise<string>;
  /** Render one message into the summarizer's text input. */
  renderMessage?: (message: MessageRequest) => string;
}

export interface SummarizeIncrementalResult {
  /** Updated rolling summary (unchanged when not summarized). */
  summary: string;
  /** Updated covered-message count (unchanged when not summarized). */
  coveredCount: number;
  /** True when more messages were folded into the summary. */
  summarized: boolean;
  /** Count of messages folded in this pass. */
  summarizedMessageCount: number;
  estimatedOutgoingTokensBefore: number;
  estimatedOutgoingTokensAfter: number;
}

/**
 * Compute the NEXT CompactionState for a full history, folding only the span that
 * has newly aged out of the recent window into the rolling summary. Triggers on
 * the OUTGOING (condensed) token count, not the full history. Non-destructive:
 * returns state only — the caller keeps the full history and re-applies the state
 * via applySummaryToMessages. Returns the input state unchanged when under the
 * threshold, when there is nothing new to summarize, or when `summarize` yields
 * '' (a failed summary must never advance coverage and lose context).
 */
export async function summarizeIncremental(
  messages: MessageRequest[],
  options: SummarizeIncrementalOptions
): Promise<SummarizeIncrementalResult> {
  const threshold =
    options.compactThresholdRatio ?? DEFAULT_COMPACT_THRESHOLD_RATIO;
  const recentKeep =
    options.recentMessagesToKeep ?? DEFAULT_RECENT_MESSAGES_TO_KEEP;
  const renderMessage = options.renderMessage ?? renderMessageForSummary;
  const covered = Math.max(0, options.coveredCount);
  const hasSystem = messages[0]?.role === MessageRole.SYSTEM;
  const firstIdx = hasSystem ? 1 : 0;

  const outgoingBefore = estimateMessagesTokens(
    applySummaryToMessages(messages, {
      summary: options.previousSummary,
      coveredCount: covered,
    })
  );
  const unchanged: SummarizeIncrementalResult = {
    summary: options.previousSummary,
    coveredCount: covered,
    summarized: false,
    summarizedMessageCount: 0,
    estimatedOutgoingTokensBefore: outgoingBefore,
    estimatedOutgoingTokensAfter: outgoingBefore,
  };
  if (outgoingBefore <= options.maxContextTokens * threshold) return unchanged;

  const recentStart = Math.max(
    firstIdx + covered,
    messages.length - recentKeep
  );
  let cut = recentStart;
  // Never start the kept window on an orphaned tool result.
  while (cut < messages.length && messages[cut]?.role === MessageRole.TOOL) {
    cut++;
  }
  if (cut <= firstIdx + covered) return unchanged; // nothing new old enough

  const span = messages.slice(firstIdx + covered, cut);
  const conversationText = span.map(renderMessage).join('\n\n');
  const newSummary = (
    await options.summarize({
      previousSummary: options.previousSummary,
      conversationText,
    })
  ).trim();
  if (!newSummary) return unchanged; // failed/empty: keep state, never lose context

  const newCovered = cut - firstIdx;
  const outgoingAfter = estimateMessagesTokens(
    applySummaryToMessages(messages, {
      summary: newSummary,
      coveredCount: newCovered,
    })
  );
  return {
    summary: newSummary,
    coveredCount: newCovered,
    summarized: true,
    summarizedMessageCount: span.length,
    estimatedOutgoingTokensBefore: outgoingBefore,
    estimatedOutgoingTokensAfter: outgoingAfter,
  };
}
