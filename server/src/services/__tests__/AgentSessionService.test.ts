import { describe, expect, it, vi } from 'vitest';
import { LocalChatApiClient, type Sandbox } from 'tenjo-chat-engine';
import {
  buildPreviewAvailableEvent,
  buildAgentSystemPromptContent,
  MAX_AGENT_SYSTEM_PROMPT_CHARS,
  resolveAgentSessionMaxContext
} from '../AgentSessionService';

class TestLocalChatApiClient extends LocalChatApiClient {
  constructor(private readonly maxContext: number | null) {
    super({
      apiBaseUrl: 'http://localhost:1234',
      apiKey: null,
      model: 'test-model',
      tools: []
    });
  }

  async getMaxContextLength(): Promise<number | null> {
    return this.maxContext;
  }
}

describe('AgentSessionService prompt', () => {
  it('keeps the runnable-app prompt within the compact prompt budget', () => {
    const prompt = buildAgentSystemPromptContent({
      sandbox: {},
      documentTask: false
    });

    expect(prompt.length).toBeLessThanOrEqual(MAX_AGENT_SYSTEM_PROMPT_CHARS);
    expect(prompt).toContain('`.tenjo/dev-servers.json`');
    expect(prompt).toContain('restart_preview');
    expect(prompt).toContain('Runnable web or');
    expect(prompt).toContain('decks default to root PPTX');
    expect(prompt).toContain('`.tmp`');
  });

  it('keeps the document prompt within the compact prompt budget', () => {
    const prompt = buildAgentSystemPromptContent({
      sandbox: {},
      documentTask: true
    });

    expect(prompt.length).toBeLessThanOrEqual(MAX_AGENT_SYSTEM_PROMPT_CHARS);
    expect(prompt).not.toContain('`.tenjo/dev-servers.json`');
    expect(prompt).toContain('xlsx/docx');
    expect(prompt).toContain('python-pptx');
  });
});

describe('AgentSessionService preview availability', () => {
  it('reports preview available when the manifest exists', async () => {
    const sandbox = {
      readFile: async (relPath: string) => {
        expect(relPath).toBe('.tenjo/dev-servers.json');
        return {
          content: JSON.stringify([
            {
              command: 'npm run dev',
              port: 5173,
              cwd: '/workspace'
            }
          ])
        };
      }
    } as unknown as Sandbox;

    await expect(buildPreviewAvailableEvent(sandbox)).resolves.toEqual({
      type: 'preview-available',
      available: true,
      kind: 'web'
    });
  });
});

describe('resolveAgentSessionMaxContext', () => {
  it('keeps compaction disabled when a non-local provider has no context length', async () => {
    const apiClient = {
      getMaxContextLength: vi.fn().mockResolvedValue(128000)
    };

    await expect(
      resolveAgentSessionMaxContext(null, apiClient)
    ).resolves.toBeNull();
    expect(apiClient.getMaxContextLength).not.toHaveBeenCalled();
  });

  it('uses live context length for local providers', async () => {
    const apiClient = new TestLocalChatApiClient(32768);

    await expect(resolveAgentSessionMaxContext(null, apiClient)).resolves.toBe(
      32768
    );
  });

  it('falls back to stored context length when local lookup returns null', async () => {
    const apiClient = new TestLocalChatApiClient(null);

    await expect(resolveAgentSessionMaxContext(8192, apiClient)).resolves.toBe(
      8192
    );
  });
});
