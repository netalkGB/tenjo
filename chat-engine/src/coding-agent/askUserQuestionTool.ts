import type { ToolDefinitionRequest } from '../OpenAIChatApiClient.js';
import type { AgentToolFailure, AgentToolSuccess } from './agentToolResult.js';

/** Tool name, exported so callers can intercept/route it (for example on the server). */
export const ASK_USER_QUESTION_TOOL_NAME = 'ask_user_question';

/** A single offered choice. `description` is an optional one-line explanation. */
export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

/** The validated arguments of an {@link ASK_USER_QUESTION_TOOL_NAME} call. */
export interface AskUserQuestionArgs {
  question: string;
  /** A very short category chip (≤12 chars), optional. */
  header?: string;
  options: AskUserQuestionOption[];
  /** Whether several options may be chosen together. Default false. */
  multiSelect: boolean;
}

export type AskUserQuestionParseResult =
  AgentToolSuccess<{ value: AskUserQuestionArgs }> | AgentToolFailure;

export const ASK_USER_QUESTION_TOOL_DEFINITION: ToolDefinitionRequest = {
  type: 'function',
  function: {
    name: ASK_USER_QUESTION_TOOL_NAME,
    description:
      'Ask the user a single multiple-choice question and wait for their ' +
      'answer. Use ONLY when you genuinely need a decision that you cannot make ' +
      'yourself: an ambiguous requirement, a choice between valid approaches, or ' +
      'information only the user has. Do not use it to ask permission to run a ' +
      'tool or to confirm work you can just do. Offer 2-6 concise options; the ' +
      'user may also type their own answer instead of picking one. The chosen ' +
      'answer is returned as the tool result.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user.',
        },
        header: {
          type: 'string',
          description:
            'A very short label/category for the question (≤12 chars), shown as a chip.',
        },
        options: {
          type: 'array',
          description:
            'The choices to offer (ideally 2-6). The user may also type their own answer.',
          items: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: 'Short text for this choice.',
              },
              description: {
                type: 'string',
                description: 'Optional one-line explanation of this choice.',
              },
            },
            required: ['label'],
          },
        },
        multiSelect: {
          type: 'boolean',
          description:
            'Set true to let the user pick several options at once. Default false.',
        },
      },
      required: ['question', 'options'],
    },
  },
};

/**
 * System-prompt guidance for the ask_user_question tool. Appended to the coding
 * agent's prompt by hosts that wire the tool in. English-only, like the rest of
 * the agent prompt.
 */
export const ASK_USER_QUESTION_SYSTEM_HINT = [
  'You also have an ask_user_question(question, options, header?, multiSelect?)',
  'tool to ask the user ONE multiple-choice question when you genuinely need',
  'their decision — an ambiguous requirement, a choice between equally valid',
  'approaches, or information only they have. It blocks until they answer and',
  'returns their choice as the tool result; the user can also type their own',
  'answer instead of picking an option. Use it sparingly: prefer acting on a',
  'reasonable assumption, and never use it to ask permission to run a tool or to',
  'confirm work you could simply do.',
  '',
  'CRITICAL: ask at most ONE question, then ACT on the answer. Never call',
  'ask_user_question again for something already answered, and never call it',
  'repeatedly — if a point is still unclear after an answer, pick a sensible',
  'default and proceed instead of asking again.',
].join('\n');

export const ASK_USER_QUESTION_COMPACT_HINT =
  'Use ask_user_question only when a user-only decision is required. Ask at most one concise question; otherwise choose a sensible default and continue.';

/** First non-empty string among the given record keys, trimmed. */
function pickString(
  record: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/** Coerce a raw option entry to {@link AskUserQuestionOption} or null if empty. */
function parseOption(raw: unknown): AskUserQuestionOption | null {
  if (typeof raw === 'string') {
    const label = raw.trim();
    return label ? { label } : null;
  }
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  // Accept the common label aliases a model might emit instead of `label`.
  const label = pickString(record, ['label', 'text', 'value', 'name', 'title']);
  if (!label) {
    return null;
  }
  const description = pickString(record, ['description', 'detail', 'hint']);
  return description ? { label, description } : { label };
}

/**
 * Validate and normalize already-parsed ask_user_question arguments. Lenient by
 * design: a malformed call that errors synchronously is re-tried by the model in
 * a tight loop (no chance for the user to answer), so we only HARD-fail when
 * there is no question text at all. Missing/odd options degrade to a free-text
 * answer rather than an error — the card always blocks for the user.
 */
export function parseAskUserQuestionArgs(
  args: Record<string, unknown>
): AskUserQuestionParseResult {
  const question = pickString(args, ['question', 'prompt', 'title', 'text']);
  if (!question) {
    return { ok: false, error: 'Missing argument: question is required.' };
  }
  // Accept `options` or the `choices` alias; tolerate a single object/string.
  const rawOptions = Array.isArray(args.options)
    ? args.options
    : Array.isArray(args.choices)
      ? args.choices
      : args.options != null
        ? [args.options]
        : args.choices != null
          ? [args.choices]
          : [];
  const options = rawOptions
    .map(parseOption)
    .filter((option): option is AskUserQuestionOption => option !== null);
  const header = pickString(args, ['header', 'category', 'label']);
  return {
    ok: true,
    value: {
      question,
      header,
      options,
      multiSelect: args.multiSelect === true || args.multiple === true,
    },
  };
}
