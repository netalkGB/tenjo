import {
  type MessageRequest,
  CODE_EXECUTION_SYSTEM_HINT,
  BROWSER_DELEGATE_SYSTEM_HINT
} from 'tenjo-chat-engine';

const BASE_PROMPT = 'You are a helpful AI assistant.';
// Used in place of BASE_PROMPT when web search is on. The phrasing matters:
// "research assistant" + "delegate first, answer second" reframes the model's
// default helpfulness instinct so it no longer competes with the delegate
// hint that follows. Keep it short and imperative.
const BASE_PROMPT_WEB_SEARCH =
  'You are a research assistant with a web-research sub-agent at your disposal. Your default reflex is to delegate factual questions to that sub-agent rather than to answer from memory.';
const KNOWLEDGE_HEADER =
  'I have been informed about and am aware of the following in advance.';
const HTML_PREVIEW_HINT = [
  'HTML preview capability: when the user explicitly asks for a renderable web page, UI mockup, or visual demo, return one self-contained `' +
    '```html' +
    '` code block with inline CSS and JavaScript. The UI shows a Preview button on `html` code blocks that renders them live in a side panel.',
  'This is ONLY for visible web content the user wants to look at. Do NOT use an `' +
    '```html' +
    '` block as a substitute for actually running code, computing a value, or producing a script — those are different intents and should be answered as a normal code block (or via the code-execution tool when available).'
].join(' ');

interface BuildOptions {
  /**
   * Knowledge entries selected by the user. Embedded verbatim under a fixed
   * header so the model treats it as background context.
   */
  knowledgeContent?: string;
  /** Whether the user has enabled the in-process code-execution tool. */
  executeCodeEnabled?: boolean;
  /** Whether the user has enabled the browser-driving web-search sub-agent. */
  webSearchEnabled?: boolean;
}

/**
 * Single source of truth for the assistant's system prompt. Anything that
 * conditionally adjusts the prompt (knowledge embedding, optional tools, etc.)
 * is composed here so route handlers don't have to repeat the assembly logic.
 */
export class SystemPromptBuilder {
  build(options: BuildOptions = {}): MessageRequest {
    const sections: string[] = [];

    // Swap the base prompt depending on web-search mode. The default
    // "You are a helpful AI assistant." line, when paired with the delegate
    // hint, observably caused mid-size local models (gemma-class) to lean
    // into the "be helpful" instinct and answer from memory. The
    // research-assistant variant reframes the default reflex as "delegate
    // first" so it stops fighting the directive that follows. HTML preview,
    // code execution, and knowledge are kept either way because they
    // describe capabilities used *after* the delegate-vs-answer decision.
    if (options.webSearchEnabled) {
      sections.push(BASE_PROMPT_WEB_SEARCH, BROWSER_DELEGATE_SYSTEM_HINT);
    } else {
      sections.push(BASE_PROMPT);
    }

    sections.push(HTML_PREVIEW_HINT);

    if (options.knowledgeContent) {
      sections.push(`${KNOWLEDGE_HEADER}\n${options.knowledgeContent}`);
    }

    if (options.executeCodeEnabled) {
      sections.push(CODE_EXECUTION_SYSTEM_HINT);
    }

    return {
      role: 'system',
      content: [{ type: 'text', text: sections.join('\n\n') }]
    };
  }
}

export const systemPromptBuilder = new SystemPromptBuilder();
