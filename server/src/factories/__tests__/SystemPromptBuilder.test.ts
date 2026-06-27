import { describe, it, expect } from 'vitest';
import {
  SystemPromptBuilder,
  systemPromptBuilder
} from '../SystemPromptBuilder';
import {
  BROWSER_DELEGATE_SYSTEM_HINT,
  CODE_EXECUTION_SYSTEM_HINT
} from 'tenjo-chat-engine';

const BASE_PROMPT = 'You are a helpful AI assistant.';
const KNOWLEDGE_HEADER =
  'I have been informed about and am aware of the following in advance.';
const DEFAULT_PROMPT_PREFIX_PATTERN = /^You are a helpful AI assistant\.\n\n/;

const getText = (msg: ReturnType<SystemPromptBuilder['build']>): string => {
  const content = msg.content;
  if (!Array.isArray(content)) {
    throw new Error('expected array content');
  }
  const first = content[0] as { type: string; text?: string };
  if (first.type !== 'text' || typeof first.text !== 'string') {
    throw new Error('expected text segment');
  }
  return first.text;
};

describe('SystemPromptBuilder', () => {
  const builder = new SystemPromptBuilder();
  const defaultPrompt = getText(builder.build());

  it('returns a system message that always starts with the base prompt', () => {
    const result = builder.build();

    expect(result.role).toBe('system');
    expect(getText(result)).toMatch(DEFAULT_PROMPT_PREFIX_PATTERN);
  });

  it('always advertises the HTML preview capability', () => {
    expect(defaultPrompt).toContain('Preview button');
    expect(defaultPrompt).toContain('```html');
  });

  it('treats empty options the same as no options', () => {
    expect(getText(builder.build({}))).toBe(defaultPrompt);
  });

  it('embeds knowledge content under the fixed header', () => {
    const text = getText(
      builder.build({ knowledgeContent: 'Some background facts.' })
    );

    expect(text).toContain(BASE_PROMPT);
    expect(text).toContain(`${KNOWLEDGE_HEADER}\nSome background facts.`);
    // Sections are separated by a blank line so models treat them distinctly.
    expect(text).toBe(
      `${defaultPrompt}\n\n${KNOWLEDGE_HEADER}\nSome background facts.`
    );
  });

  it('omits the knowledge section when knowledgeContent is empty string', () => {
    const text = getText(builder.build({ knowledgeContent: '' }));

    expect(text).toBe(defaultPrompt);
    expect(text).not.toContain(KNOWLEDGE_HEADER);
  });

  it('appends the code-execution hint when executeCodeEnabled is true', () => {
    const text = getText(builder.build({ executeCodeEnabled: true }));

    expect(text).toBe(`${defaultPrompt}\n\n${CODE_EXECUTION_SYSTEM_HINT}`);
  });

  it('does not append the code-execution hint when executeCodeEnabled is false', () => {
    const text = getText(builder.build({ executeCodeEnabled: false }));

    expect(text).toBe(defaultPrompt);
    expect(text).not.toContain(CODE_EXECUTION_SYSTEM_HINT);
  });

  it('combines knowledge and code-execution hint in deterministic order', () => {
    const text = getText(
      builder.build({
        knowledgeContent: 'Pre-loaded notes',
        executeCodeEnabled: true
      })
    );

    expect(text).toBe(
      [
        defaultPrompt,
        `${KNOWLEDGE_HEADER}\nPre-loaded notes`,
        CODE_EXECUTION_SYSTEM_HINT
      ].join('\n\n')
    );
  });

  it('exposes a singleton with the same behavior', () => {
    expect(getText(systemPromptBuilder.build())).toBe(defaultPrompt);
  });

  // Web-search mode swaps the base prompt for a research-assistant variant
  // and prepends the delegate hint. The default "be helpful" base prompt is
  // dropped because it competes with the delegate directive on mid-size
  // models (gemma-class). HTML preview, code execution, and user knowledge
  // stay — they describe capabilities the model uses *after* deciding what
  // to do, so they don't fight the delegate decision itself.
  describe('webSearchEnabled', () => {
    it('uses the research-assistant base prompt instead of the default one', () => {
      const text = getText(builder.build({ webSearchEnabled: true }));

      expect(text).toContain('research assistant');
      expect(text).toContain(BROWSER_DELEGATE_SYSTEM_HINT);
      expect(text).not.toContain(BASE_PROMPT);
    });

    it('still advertises the HTML preview capability', () => {
      const text = getText(builder.build({ webSearchEnabled: true }));

      expect(text).toContain('```html');
      expect(text).toContain('Preview button');
    });

    it('keeps the code-execution hint alongside the delegate hint', () => {
      const text = getText(
        builder.build({ webSearchEnabled: true, executeCodeEnabled: true })
      );

      expect(text).toContain(BROWSER_DELEGATE_SYSTEM_HINT);
      expect(text).toContain(CODE_EXECUTION_SYSTEM_HINT);
    });

    it('still embeds knowledge content under the fixed header', () => {
      const text = getText(
        builder.build({
          webSearchEnabled: true,
          knowledgeContent: 'pre-loaded notes'
        })
      );

      expect(text).toContain(BROWSER_DELEGATE_SYSTEM_HINT);
      expect(text).toContain(`${KNOWLEDGE_HEADER}\npre-loaded notes`);
    });
  });
});
