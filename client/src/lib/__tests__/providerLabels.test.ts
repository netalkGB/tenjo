import { describe, expect, it } from 'vitest';
import {
  formatProviderLabel,
  MODEL_PROVIDER_OPTIONS
} from '@/lib/providerLabels';

describe('providerLabels', () => {
  it('formats known provider labels', () => {
    expect(formatProviderLabel('lmstudio')).toBe('LM Studio');
    expect(formatProviderLabel('ollama')).toBe('Ollama');
    expect(formatProviderLabel('openai')).toBe('OpenAI');
    expect(formatProviderLabel('openai-compatible')).toBe('OpenAI Compatible');
  });

  it('includes OpenAI Compatible in model provider options', () => {
    expect(MODEL_PROVIDER_OPTIONS).toContainEqual({
      value: 'openai-compatible',
      label: 'OpenAI Compatible'
    });
  });
});
