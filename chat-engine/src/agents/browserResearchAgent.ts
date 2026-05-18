/**
 * Reusable browser-driving research agent. Wraps a ChatClient + the full
 * browser tool set + the persistence-enforcement loop (give-up classifier
 * + forced retry + final-response forcing) so callers don't have to
 * re-implement that logic per use site.
 *
 * Each agent owns its own private {@link BrowserController} (a Chromium
 * process + context + page), so multiple agents running concurrently do
 * not share cookies, scroll position, or navigation history. The
 * controller is reused across runTask calls within the same agent so a
 * follow-up task continues from the previous tab. Call {@link close} when
 * the agent is being decommissioned — otherwise the Chromium process
 * leaks.
 */

import { ChatClient, type ChatStatus } from '../ChatClient';
import type { ChatApiClient } from '../ChatApiClient';
import type { ToolDefinitionRequest } from '../OpenAIChatApiClient';
import { bundleTools, type LocalToolHandler } from '../tools/types';
import {
  BROWSER_TOOL_SYSTEM_HINT,
  BROWSER_ACCESSIBILITY_SYSTEM_HINT,
  BROWSER_RESEARCH_SYSTEM_HINT,
  BROWSER_REPORTING_SYSTEM_HINT,
  BrowserController,
  type BrowserConfig,
  createBrowserTools,
  buildDuckDuckGoSearchUrl,
  sanitizeDuckDuckGoQuery,
} from '../tools/browser/index';
import type { ToolCallStreamEvent } from '../ChatClient';

const DEFAULT_SYSTEM_PROMPT = `Web-research agent. Search the live web before answering — never use training data. Cite sources by URL. ${BROWSER_TOOL_SYSTEM_HINT} ${BROWSER_ACCESSIBILITY_SYSTEM_HINT} MANDATORY: every user message MUST be answered from a live web page you loaded this turn. Use the browser tools to fetch and read at least one source before you reply — pick whichever tool fits the task (browser_duckduckgo_search for general queries, browser_navigate for a known URL, etc.). Answering from training data alone is FORBIDDEN, even when you are confident. If a question seems trivial, search anyway. PERSISTENCE QUOTA — read carefully: you may NOT tell the user "I could not find it" until you have run AT LEAST 3 DISTINCT DuckDuckGo queries (different keywords, not the same query reworded with one synonym). Reading one article that contained *related-but-not-the-asked* information does NOT count as having answered — the user asked for a SPECIFIC fact, and "related context" is not the fact. If the page you read did not contain the asked fact verbatim or in a clearly equivalent form, your next action MUST be another browser_duckduckgo_search with a meaningfully different angle, NOT a giving-up message. When you do retry, vary the ANGLE, not just the wording. Generic angles that work for almost any topic: (a) SPECIFICITY — try a narrower (more specific terms) and a broader (less specific) framing; (b) LANGUAGE — switch between the topic's native language and English (or vice-versa); (c) ENTITY NAME — try alternative names for the entity (full / canonical / technical / common / handle / romanized); (d) SOURCE-TYPE TARGETING — name the kind of source you want by appending a hint that biases results toward it (encyclopedic, official, news, community wiki, primary source, etc.); (e) ASPECT — the same topic from a different facet, since the answer often lives on a page indexed under a related-but-different query than the literal question. Do NOT just append more keywords to your previous failed query. ${BROWSER_RESEARCH_SYSTEM_HINT} ${BROWSER_REPORTING_SYSTEM_HINT}`;

const DEFAULT_MAX_TOOL_ITERATIONS = 30;
const DEFAULT_PERSISTENCE_QUOTA = 3;
/**
 * Fraction of the per-task timeout at which the agent stops starting new
 * research and switches to wrapping up. Picked so the model keeps roughly a
 * third of the budget to actually compose and stream its final answer.
 */
const SOFT_DEADLINE_FRACTION = 0.625;

/**
 * Time-budget reminder appended to the worker's system prompt. Returns an
 * empty string when no timeout is set, so callers can interpolate it
 * unconditionally. The model has no clock, so this cannot make it literally
 * count seconds — it sets the disposition: search efficiently, stop early,
 * and always commit to an answer rather than risk timing out with nothing
 * to show.
 */
function buildTimeBudgetHint(timeoutMs: number): string {
  if (timeoutMs <= 0) return '';
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return ` TIME BUDGET — read carefully: you have only about ${seconds} seconds of wall-clock time for this ENTIRE task, and every search and page load eats into it. Work fast and decisively: lead with your single most promising query, never run near-duplicate searches, and do not open more pages than you need. The instant you have a usable answer, STOP and write it — do not keep polishing or double-checking. If you sense the budget is nearly spent, answer IMMEDIATELY with the best information gathered so far rather than risk returning nothing. A timely partial answer with its sources always beats a perfect answer that never arrives.`;
}

export interface BrowserResearchAgentOptions {
  /**
   * Factory for the chat API client used by the worker + judge. Makes the
   * agent provider-agnostic — pass any ChatApiClient implementation (LM
   * Studio, OpenAI, Ollama, etc.). Called twice: once with the browser tool
   * definitions for the worker, once with an empty tool list for the judge.
   */
  apiClientFactory: (tools: ToolDefinitionRequest[]) => ChatApiClient;
  /** Override the default research-agent system prompt. */
  systemPrompt?: string;
  /**
   * Browser configuration for the agent's PRIVATE Chromium instance. Each
   * agent owns its own browser process so concurrent agents do not share
   * cookies, scroll position, or navigation history. Defaults to a
   * non-headless run with the standard UA — pass {@link BrowserConfig} to
   * override.
   */
  browserConfig?: BrowserConfig;
  /** Max tool-call iterations per task. Default 30. */
  maxToolIterations?: number;
  /** Min number of distinct DDG queries before a give-up is accepted. Default 3. */
  persistenceQuota?: number;
  /**
   * Hard wall-clock budget per {@link BrowserResearchAgent.runTask} call, in
   * milliseconds. When the budget elapses, the in-flight chat-completion
   * request is aborted, the tool-call loop exits, and runTask returns with
   * whatever assistant text has been streamed so far plus a "(Note: research
   * timed out after Ns)" suffix appended to the answer. Tool handlers that
   * are already mid-execution finish on their own — only the API stream is
   * cancelable. Omit / set to 0 to disable. Default: disabled.
   */
  timeoutMs?: number;
}

/**
 * A single browser_duckduckgo_search invocation, paired with the actual
 * search-results-page URL the agent loaded. The URL is produced by
 * {@link buildDuckDuckGoSearchUrl} at the call site so the UI can link to
 * the same page the agent saw without re-deriving the format.
 */
export interface BrowserResearchSearchEntry {
  query: string;
  url: string;
}

export interface BrowserResearchTaskResult {
  /** The final assistant text (what would have been printed to the user). */
  answer: string;
  /** True when the task ran out of tool iterations or could not produce text. */
  incomplete: boolean;
  /** Human-readable note, populated only when something went off the happy path. */
  note?: string;
  /**
   * Distinct browser_duckduckgo_search queries issued during the task, paired
   * with the actual results-page URL the agent loaded.
   */
  searches: BrowserResearchSearchEntry[];
  /**
   * Distinct URLs the agent navigated to via browser_navigate during the
   * task, in first-seen order. Useful for the UI to surface what pages the
   * sub-agent actually read.
   */
  visitedUrls: string[];
  /** True when the task hit the {@link BrowserResearchAgentOptions.timeoutMs} budget. */
  timedOut?: boolean;
}

export interface BrowserResearchAgentEvents {
  /** Fired right before a tool is dispatched. */
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  /**
   * Fired right after a tool returned. `resultJson` is the JSON-stringified
   * result so the caller can decide how to truncate it for display without
   * re-stringifying.
   */
  onToolEnd?: (
    name: string,
    args: Record<string, unknown>,
    result: unknown,
    resultJson: string
  ) => void;
  /** Fired when the persistence-enforcement retry kicks in. */
  onPersistenceRetry?: (distinctQueriesSoFar: number, quota: number) => void;
  /**
   * Fired once at the start of {@link BrowserResearchAgent.runTask}, with
   * the task string the agent is about to work on.
   */
  onTaskStart?: (task: string) => void;
  /**
   * Fired once at the end of {@link BrowserResearchAgent.runTask}, with
   * the same result the method returns. Lets callers stream results into
   * a UI / log without inspecting the return value at every call site.
   */
  onTaskComplete?: (result: BrowserResearchTaskResult) => void;
  /** Fired when the agent went silent / hit the loop limit and is being forced to commit. */
  onForcedFinalResponse?: (info: {
    textLen: number;
    trimmedLen: number;
    hitLimit: boolean;
  }) => void;
  /** Fired exactly once when the per-task timeout budget elapses. */
  onTimeout?: (info: { timeoutMs: number }) => void;
}

/**
 * Research agent wrapping a ChatClient that owns the full browser tool set.
 * Stateful across runTask calls — the conversation history persists so a
 * follow-up task can build on prior context. Call {@link reset} between
 * unrelated tasks.
 */
export class BrowserResearchAgent {
  public readonly client: ChatClient;
  /**
   * Private Chromium controller owned by this agent. Exposed as readonly
   * so callers can reach the underlying Page if they need a browser
   * operation the standard tools don't cover. Closed by {@link close}.
   */
  public readonly browser: BrowserController;
  private readonly judge: ChatClient;
  private readonly handlers: Map<string, LocalToolHandler>;
  private readonly maxToolIterations: number;
  private readonly persistenceQuota: number;
  private readonly systemPrompt: string;
  private readonly timeoutMs: number;

  // Captured assistant text for the in-progress task. Append-mode; reset at
  // the top of every runTask call.
  private capturedText = '';
  // Forwarded user-supplied handlers. The class hijacks the ChatClient's
  // handlers so it can capture text for the give-up classifier and the
  // silent-turn detection — these forwards keep the caller's hooks alive.
  private forwardMessage: (m: string) => void = () => {};
  private forwardThinking: (m: string) => void = () => {};
  private forwardReasoning: (m: string) => void = () => {};
  private forwardStatus: (s: ChatStatus) => void = () => {};
  private forwardToolStream: (e: ToolCallStreamEvent) => void = () => {};
  private events: BrowserResearchAgentEvents = {};
  // Judge's captured text. Reset before every classifyAsGiveUp call.
  private judgeText = '';

  constructor(options: BrowserResearchAgentOptions) {
    // Each agent gets its own Chromium so concurrent agents do not share
    // cookies, scroll position, or navigation history. Lazy: chromium is
    // launched on the first browser tool call, not in this constructor.
    this.browser = new BrowserController(options.browserConfig);
    const { definitions, handlers } = bundleTools(
      createBrowserTools(this.browser)
    );
    this.handlers = handlers;
    this.maxToolIterations =
      options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    this.persistenceQuota =
      options.persistenceQuota ?? DEFAULT_PERSISTENCE_QUOTA;
    this.timeoutMs = options.timeoutMs ?? 0;
    // Fold the time-budget reminder into the stored prompt so both the
    // constructor's setSystemPrompt below and reset() pick it up. The hint
    // is empty when no timeout is set.
    this.systemPrompt = `${options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT}${buildTimeBudgetHint(this.timeoutMs)}`;

    const { apiClientFactory } = options;
    this.client = new ChatClient(apiClientFactory(definitions));
    this.client.setSystemPrompt({
      role: 'system',
      content: this.systemPrompt,
    });

    // Class-owned handlers that capture text, then forward to whatever the
    // caller wired up via setMessageHandler etc.
    this.client.setMessageHandler((m: string) => {
      this.capturedText += m;
      this.forwardMessage(m);
    });
    this.client.setThinkingHandler((m: string) => this.forwardThinking(m));
    this.client.setReasoningHandler((m: string) => this.forwardReasoning(m));
    this.client.setStatusHandler((s: ChatStatus) => this.forwardStatus(s));
    this.client.setToolCallStreamHandler((e: ToolCallStreamEvent) =>
      this.forwardToolStream(e)
    );

    // Stateless single-purpose classifier client. No tools so it can never
    // recurse into a search.
    this.judge = new ChatClient(apiClientFactory([]));
    this.judge.setMessageHandler((m: string) => {
      this.judgeText += m;
    });
    this.judge.setThinkingHandler(() => {});
    this.judge.setReasoningHandler(() => {});
    this.judge.setStatusHandler(() => {});
  }

  // ---- public configuration --------------------------------------------------

  public setMessageHandler(fn: (m: string) => void): void {
    this.forwardMessage = fn;
  }
  public setThinkingHandler(fn: (m: string) => void): void {
    this.forwardThinking = fn;
  }
  public setReasoningHandler(fn: (m: string) => void): void {
    this.forwardReasoning = fn;
  }
  public setStatusHandler(fn: (s: ChatStatus) => void): void {
    this.forwardStatus = fn;
  }
  public setToolCallStreamHandler(fn: (e: ToolCallStreamEvent) => void): void {
    this.forwardToolStream = fn;
  }
  public setEvents(events: BrowserResearchAgentEvents): void {
    this.events = events;
  }

  /** Reset the conversation history so the next runTask starts fresh. */
  public reset(): void {
    this.client.setMessages([]);
    this.client.setSystemPrompt({
      role: 'system',
      content: this.systemPrompt,
    });
  }

  /**
   * Close the agent's private Chromium browser. Call when the agent is
   * being decommissioned — leaving this off leaks the browser process.
   */
  public async close(): Promise<void> {
    await this.browser.close();
  }

  // ---- core --------------------------------------------------------------

  /**
   * Run a single research task end-to-end. Returns when the agent has
   * produced a final textual answer (or has been forced to). Persistence
   * enforcement is applied automatically — the caller does not need to
   * inspect the result and re-send.
   */
  public async runTask(task: string): Promise<BrowserResearchTaskResult> {
    this.capturedText = '';
    this.events.onTaskStart?.(task);
    // Drop any aborted state left over from a previous (timed-out) task so
    // this run starts with a live abort handle.
    this.client.clearAbort();
    // First-seen-order list of {query, url} pairs from browser_duckduckgo_search.
    // The url is built at the source (buildDuckDuckGoSearchUrl) so the UI can
    // link to the same page the agent loaded without re-deriving the format.
    const distinctSearches: BrowserResearchSearchEntry[] = [];
    const distinctSearchQueriesSeen = new Set<string>();
    // First-seen-order list of distinct URLs the agent navigated to via
    // browser_navigate. Surfaces in the result so the UI can show "pages
    // read" without re-deriving from tool-call traffic.
    const visitedUrlsOrdered: string[] = [];
    const visitedUrlsSeen = new Set<string>();

    // Per-task hard timeout. When it fires we abort the in-flight chat API
    // request (tools that are already running cannot be canceled — they
    // finish normally, but the next API call short-circuits). Disabled
    // when timeoutMs <= 0.
    let timedOut = false;
    const timeoutHandle =
      this.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            this.client.abort();
            this.events.onTimeout?.({ timeoutMs: this.timeoutMs });
          }, this.timeoutMs)
        : undefined;

    // Soft deadline, fired well before the hard timeout. Once it elapses the
    // tool-call loop stops dispatching new tools and pushes the model to
    // summarize, so a usable answer lands before the hard abort instead of
    // the task dying mid-research with nothing to show.
    let softTimedOut = false;
    const softTimeoutHandle =
      this.timeoutMs > 0
        ? setTimeout(() => {
            softTimedOut = true;
          }, this.timeoutMs * SOFT_DEADLINE_FRACTION)
        : undefined;
    const isAbortError = (err: unknown): boolean =>
      timedOut ||
      (err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('aborted')));
    const safeSend = async (msg: string): Promise<boolean> => {
      try {
        await this.client.sendMessage(msg);
        return true;
      } catch (err) {
        if (isAbortError(err)) return false;
        throw err;
      }
    };
    const safeValidate = async (): Promise<boolean> => {
      try {
        await this.client.validateToolCallResult();
        return true;
      } catch (err) {
        if (isAbortError(err)) return false;
        throw err;
      }
    };

    const runToolCallLoop = async (): Promise<{ hitLimit: boolean }> => {
      let toolCalls = this.client.getToolCallPlan();
      let iter = 0;
      let hitLimit = false;
      while (toolCalls && toolCalls.length > 0) {
        if (timedOut) break;
        if (iter >= this.maxToolIterations) {
          hitLimit = true;
          break;
        }
        iter++;

        for (const toolCall of toolCalls) {
          if (timedOut) break;
          const { name, arguments: args } = toolCall.function;

          // Past the soft deadline: reject every not-yet-started tool call
          // with a wrap-up instruction. Tools already running finish on
          // their own; this just stops new research and makes the model
          // commit to an answer with the time that remains.
          if (softTimedOut) {
            this.client.addToolCallResult(toolCall.id, {
              error:
                'TIME BUDGET nearly spent — stop researching now. Do NOT call any more tools. Write your final answer to the user immediately using the information you have already gathered, and cite the URLs you visited. If the answer is still incomplete, give your best partial answer and briefly state what remains uncertain.',
            });
            continue;
          }

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(args) as Record<string, unknown>;
          } catch {
            parsed = {};
          }

          const handler = this.handlers.get(name);
          if (!handler) {
            this.client.addToolCallResult(toolCall.id, {
              error: `[unknown tool ${name}]`,
            });
            continue;
          }

          this.events.onToolStart?.(name, parsed);
          const result = await handler(parsed);
          const resultJson = JSON.stringify(result);
          this.events.onToolEnd?.(name, parsed, result, resultJson);
          this.client.addToolCallResult(toolCall.id, result);

          if (name === 'browser_duckduckgo_search') {
            const q =
              typeof parsed.query === 'string'
                ? sanitizeDuckDuckGoQuery(parsed.query)
                : '';
            if (q && !distinctSearchQueriesSeen.has(q)) {
              distinctSearchQueriesSeen.add(q);
              distinctSearches.push({
                query: q,
                url: buildDuckDuckGoSearchUrl(q),
              });
            }
          }

          if (name === 'browser_navigate') {
            const url = typeof parsed.url === 'string' ? parsed.url.trim() : '';
            if (url && !visitedUrlsSeen.has(url)) {
              visitedUrlsSeen.add(url);
              visitedUrlsOrdered.push(url);
            }
          }
        }

        if (timedOut) break;
        if (!(await safeValidate())) break;
        toolCalls = this.client.getToolCallPlan();
      }
      return { hitLimit };
    };

    try {
      if (!(await safeSend(task))) {
        // Aborted before the first response landed.
      }
      let { hitLimit } = timedOut
        ? { hitLimit: false }
        : await runToolCallLoop();

      // Persistence enforcement: if the model emitted a "gave up looking"
      // style answer with fewer than the quota in distinct DDG queries this
      // turn, force another round with different angles. Done at most once
      // per task. Skipped on timeout.
      const meaningfulText = this.capturedText.trim();
      if (
        !timedOut &&
        !softTimedOut &&
        !hitLimit &&
        distinctSearchQueriesSeen.size < this.persistenceQuota &&
        meaningfulText.length > 0 &&
        (await this.classifyAsGiveUp(task, meaningfulText))
      ) {
        this.events.onPersistenceRetry?.(
          distinctSearchQueriesSeen.size,
          this.persistenceQuota
        );
        this.capturedText = '';
        const queriesSoFar =
          distinctSearchQueriesSeen.size === 1 ? 'query' : 'queries';
        if (
          await safeSend(
            `You attempted to answer with "I could not find it" after only ${distinctSearchQueriesSeen.size} distinct DuckDuckGo ${queriesSoFar} this turn. The PERSISTENCE QUOTA in your system prompt requires AT LEAST ${this.persistenceQuota} distinct queries before declaring an answer unfindable. Run more browser_duckduckgo_search calls now with meaningfully different ANGLES — vary specificity, language, entity-name choice, source-type targeting, or aspect. DO NOT just append a synonym to your previous query. After running the additional searches and reading at least one promising page, then answer.`
          )
        ) {
          ({ hitLimit } = await runToolCallLoop());
        }
      }

      // Silent / loop-limit fallback: force a textual answer, refusing any
      // further tool calls. Skipped on timeout — once the client is aborted
      // we cannot make any more API calls.
      const finalText = this.capturedText.trim();
      const wentSilent = finalText.length < 5;
      if (!timedOut && (wentSilent || hitLimit)) {
        this.events.onForcedFinalResponse?.({
          textLen: this.capturedText.length,
          trimmedLen: finalText.length,
          hitLimit,
        });
        this.capturedText = '';
        if (
          await safeSend(
            'You did not answer. STOP calling tools now. Reply to the user with whatever information you already gathered, or briefly explain why you cannot answer. One short paragraph maximum.'
          )
        ) {
          let extraIter = 0;
          let extraTools = this.client.getToolCallPlan();
          while (
            !timedOut &&
            extraTools &&
            extraTools.length > 0 &&
            extraIter < 5
          ) {
            extraIter++;
            for (const tc of extraTools) {
              this.client.addToolCallResult(tc.id, {
                error:
                  'No further tool calls. Respond to the user with text only.',
              });
            }
            if (!(await safeValidate())) break;
            extraTools = this.client.getToolCallPlan();
          }
        }
      }

      const trimmed = this.capturedText.trim();
      const searches = distinctSearches.slice();
      const visitedUrls = visitedUrlsOrdered.slice();
      let result: BrowserResearchTaskResult;
      if (timedOut) {
        const seconds = Math.max(1, Math.round(this.timeoutMs / 1000));
        const timeoutNote = `Research timed out after ${seconds}s.`;
        const answer =
          trimmed.length > 0
            ? `${trimmed}\n\n(Note: ${timeoutNote})`
            : `(Note: ${timeoutNote})`;
        result = {
          answer,
          incomplete: true,
          timedOut: true,
          note: timeoutNote,
          searches,
          visitedUrls,
        };
      } else if (trimmed.length < 5) {
        result = {
          answer: '',
          incomplete: true,
          note: hitLimit
            ? `hit ${this.maxToolIterations}-iteration tool budget without producing a final answer`
            : 'agent produced no usable text',
          searches,
          visitedUrls,
        };
      } else {
        result = {
          answer: trimmed,
          incomplete: hitLimit,
          ...(hitLimit
            ? {
                note: `tool-iteration budget exhausted (${this.maxToolIterations}); answer may be partial`,
              }
            : {}),
          searches,
          visitedUrls,
        };
      }
      this.events.onTaskComplete?.(result);
      return result;
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (softTimeoutHandle !== undefined) clearTimeout(softTimeoutHandle);
    }
  }

  // ---- helpers -----------------------------------------------------------

  private async classifyAsGiveUp(
    userQuestion: string,
    assistantAnswer: string
  ): Promise<boolean> {
    this.judge.setMessages([]);
    this.judge.setSystemPrompt({
      role: 'system',
      content: [
        'You classify assistant replies as either GIVE_UP or OK.',
        'GIVE_UP: the assistant told the user it COULD NOT FIND a specific answer to the question — admitted the info is unknown / unfindable / not present in sources / only described related-but-not-the-asked context.',
        'OK: the assistant gave a concrete, specific answer to the question (even if hedged with sources or uncertainty about the source).',
        'Reply with EXACTLY ONE token: GIVE_UP or OK. No punctuation, no explanation, no other text.',
      ].join(' '),
    });
    this.judgeText = '';
    try {
      await this.judge.sendMessage(
        `USER QUESTION:\n${userQuestion}\n\nASSISTANT REPLY:\n${assistantAnswer}\n\nVerdict:`
      );
    } catch {
      return false;
    }
    const verdict = this.judgeText.trim().toUpperCase();
    if (verdict.includes('GIVE_UP') || verdict.includes('GIVEUP')) return true;
    if (verdict.includes('OK')) return false;
    return false;
  }
}
