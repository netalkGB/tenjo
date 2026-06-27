export const THINKING_OPEN_TAG = '<think>';
export const THINKING_CLOSE_TAG = '</think>';

export interface TaggedThinkingContent {
  hasThinkingTag: boolean;
  hasAnswer: boolean;
  thinkingText: string;
}

/** Detect local models repeatedly emitting the same reasoning block. */
export function isRepetitionLoop(text: string): boolean {
  const WINDOW = 4000;
  const UNIT = 150;
  const MIN_REPEATS = 4;
  if (text.length < WINDOW) return false;
  const tail = text.slice(-WINDOW);
  const probe = tail.slice(-UNIT);
  // Ignore an all-whitespace probe (for example a long run of newlines) because it is
  // not meaningful repeated reasoning.
  if (probe.trim().length < UNIT / 2) return false;
  let count = 0;
  let idx = tail.indexOf(probe);
  while (idx !== -1) {
    count++;
    idx = tail.indexOf(probe, idx + UNIT);
  }
  return count >= MIN_REPEATS;
}

/** Split local-model <think> blocks from answer text streamed as content. */
export function extractTaggedThinkingContent(
  content: string
): TaggedThinkingContent {
  const hasThinkingTag = content.includes(THINKING_OPEN_TAG);
  if (!hasThinkingTag) {
    return {
      hasThinkingTag,
      hasAnswer: content.length > 0,
      thinkingText: '',
    };
  }

  // An unclosed trailing <think> means the model is still reasoning.
  let thinkingText = '';
  let hasAnswer = false;
  let cursor = 0;
  while (cursor < content.length) {
    const open = content.indexOf(THINKING_OPEN_TAG, cursor);
    const answerEnd = open === -1 ? content.length : open;
    if (content.slice(cursor, answerEnd).trim().length > 0) {
      hasAnswer = true;
    }
    if (open === -1) {
      break;
    }
    const bodyStart = open + THINKING_OPEN_TAG.length;
    const close = content.indexOf(THINKING_CLOSE_TAG, bodyStart);
    if (close === -1) {
      thinkingText += content.slice(bodyStart);
      break;
    }
    thinkingText += content.slice(bodyStart, close);
    cursor = close + THINKING_CLOSE_TAG.length;
  }

  return {
    hasThinkingTag,
    hasAnswer,
    thinkingText,
  };
}
