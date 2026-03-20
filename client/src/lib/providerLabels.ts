const PROVIDER_LABELS: Record<string, string> = {
  lmstudio: 'LM Studio',
  ollama: 'Ollama'
};

export function formatProviderLabel(type: string): string {
  return PROVIDER_LABELS[type] ?? type;
}
