/**
 * Helpers for exposing a {@link BrowserResearchAgent} to a parent chat agent
 * as a single delegate tool, so callers can wire web research into a normal
 * chat session without re-implementing the contract.
 */

import type { BrowserResearchAgent } from './browserResearchAgent';
import type { Tool } from '../tools/types';

export const BROWSER_DELEGATE_TOOL_NAME = 'tenjo_browser_agent';

/**
 * System-prompt fragment that teaches a parent agent how to use the
 * tenjo_browser_agent tool correctly. Concatenate into the parent's
 * system prompt only when the sub-agent is enabled — when the feature is
 * turned off, drop this hint and the delegate tool together.
 *
 * Tightly coupled to the field names (`userMessage`, `parentNote`) defined
 * in {@link createBrowserDelegateTool}: keep them in sync.
 */
export const BROWSER_DELEGATE_SYSTEM_HINT = [
  // Lead rule, kept short on purpose: mid-size local models latch onto the
  // first imperative sentence and ignore long preambles, so the very first
  // thing the model reads has to be the punchline.
  'PRIMARY RULE: if the answer is not something you can derive from first principles or basic, well-established knowledge, you MUST call tenjo_browser_agent. Do not answer from memory. Do not say "I think" or "I recall" — call the tool instead.',
  'YOUR TRAINING DATA IS NOT A SOURCE. In particular, you do NOT reliably know: any specific named entity (a username, handle, SNS account, channel, repo, product, song, paper, book, person), any quote/post/tweet attributed to such an entity, any current or dated information (news, prices, schedules, weather, statuses), any niche or local fact, anything that might have changed since your training. For ALL of these, call tenjo_browser_agent. If you feel tempted to answer "this is a username on X / YouTube / etc.", that is the exact case where you MUST delegate instead.',
  "PASS THE USER'S MESSAGE VERBATIM: copy the user's most recent message into `userMessage` character-for-character. No paraphrasing, no translation, no summarization, no expanding pronouns, no adding context, no removing politeness. The sub-agent is tuned to answer the user's literal phrasing; rewriting degrades results.",
  "If the user's latest message relies on the prior conversation (pronouns, follow-ups like 'How about X?' / 'What about X?' / 'And X?' or equivalents in other languages, ellipsis, comparatives), set `parentNote` to a one-sentence summary of the current topic. Example: the user just asked about today's weather in city A, then says 'How about city B?' → userMessage='How about city B?', parentNote='The current topic is today\\'s weather; the user is now asking about city B\\'s weather.' Leave parentNote empty when the message is fully self-contained.",
  'NEVER bake the conversation context into `userMessage` itself — keep userMessage verbatim and put the flow into parentNote.',
  'After the tool returns, answer the user using the sub-agent summary and preserve the URLs it cited.',
  'You MAY answer directly only for: greetings, acknowledgements, math you can compute deterministically, and definitions of well-established general concepts. Everything else — DELEGATE.',
].join(' ');

/**
 * Wrap a {@link BrowserResearchAgent} as a single tool. Each invocation
 * resets the sub-agent's chat history so unrelated delegations do not bleed
 * into each other; the underlying Chromium session is still reused (cookies,
 * scroll position) within the same agent instance.
 */
export function createBrowserDelegateTool(
  subAgent: BrowserResearchAgent
): Tool {
  return {
    definition: {
      type: 'function',
      function: {
        name: BROWSER_DELEGATE_TOOL_NAME,
        description:
          "Delegate web research to a browser-driving sub-agent that runs an isolated browser session and returns the final answer + the URLs it loaded. CRITICAL CONTRACT: pass the user's most recent message as `userMessage` EXACTLY as they wrote it — character-for-character verbatim, no rephrasing, no translation, no summarization, no expansion, no quote marks added or removed. The sub-agent is tuned to answer the user's literal phrasing; any rewriting on your part is observed to degrade results, especially when the message contains handles, IDs, slang, romanized names, or quoted strings. If you would like to add disambiguation, add it as a separate `parentNote` field — do NOT bake it into `userMessage`.",
        parameters: {
          type: 'object',
          properties: {
            userMessage: {
              type: 'string',
              description:
                "The user's most recent message, copied VERBATIM (character-for-character). Do not paraphrase, translate, summarize, or 'clean up'.",
            },
            parentNote: {
              type: 'string',
              description:
                "REQUIRED whenever the user's message is a follow-up that relies on prior conversation (pronouns, 'How about X?' / 'What about X?' / 'And X?' or their equivalents in other languages, ellipsis, comparatives). The sub-agent has NO memory of this conversation — set parentNote to a one-sentence summary of the current topic so the sub-agent can interpret the message correctly. Leave empty ONLY when the user message is fully self-contained.",
            },
          },
          required: ['userMessage'],
        },
      },
    },
    handler: async (args) => {
      const userMessage =
        typeof args.userMessage === 'string' ? args.userMessage : '';
      const parentNote =
        typeof args.parentNote === 'string' ? args.parentNote.trim() : '';
      if (!userMessage.trim()) {
        return { error: 'Missing required argument: userMessage' };
      }
      // Forward the user's literal message to the sub-agent. parentNote, if
      // present, is appended in a clearly-separated block so the sub-agent
      // can see the parent's hint but knows it is *not* part of the
      // user's wording.
      const task = parentNote
        ? `${userMessage}\n\n---\n[parent agent note]: ${parentNote}`
        : userMessage;
      try {
        // Fresh history per delegation so unrelated parent requests do not
        // share sub-agent context. The sub-agent's private Chromium browser
        // session itself persists across delegations within the same agent
        // instance.
        subAgent.reset();
        return await subAgent.runTask(task);
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Unknown sub-agent error',
        };
      }
    },
  };
}
