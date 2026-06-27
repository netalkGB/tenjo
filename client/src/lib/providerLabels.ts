import type { Model } from '@/api/server/settings';

export const PROVIDER_LABELS: Record<string, string> = {
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  openai: 'OpenAI',
  'openai-compatible': 'OpenAI Compatible'
};

export const MODEL_PROVIDER_OPTIONS = [
  { value: 'lmstudio', label: PROVIDER_LABELS.lmstudio },
  { value: 'ollama', label: PROVIDER_LABELS.ollama },
  { value: 'openai-compatible', label: PROVIDER_LABELS['openai-compatible'] }
];

export function formatProviderLabel(type: string): string {
  return PROVIDER_LABELS[type] ?? type;
}

/**
 * Build a human-readable label for a model. When two models share the same
 * display name the base URL is appended to keep them distinguishable.
 */
export function formatModelLabel(model: Model, allModels: Model[]): string {
  const base = `${formatProviderLabel(model.type)} / ${model.model}`;
  const hasDuplicateName = allModels.some(
    m => m.id !== model.id && m.model === model.model
  );
  if (hasDuplicateName) {
    return `${base} (${model.baseUrl})`;
  }
  return base;
}

export function formatAgentProjectModelLabel(model: {
  provider: string;
  model: string;
  baseUrl: string;
}): string {
  const base = `${formatProviderLabel(model.provider)} / ${model.model}`;
  return model.baseUrl ? `${base} (${model.baseUrl})` : base;
}
