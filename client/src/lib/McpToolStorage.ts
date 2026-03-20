const STORAGE_KEY_TOOLS = 'mcpAvailableTools';
const STORAGE_KEY_DISABLED = 'mcpDisabledTools';

function buildToolFingerprint(allTools: string[]): string {
  return [...allTools].sort().join('\0');
}

export class McpToolStorage {
  /**
   * Load disabled tools from localStorage.
   * Returns the disabled set if the available tool list matches, otherwise null (meaning reset).
   */
  static load(allTools: string[]): Set<string> | null {
    const savedTools = localStorage.getItem(STORAGE_KEY_TOOLS);
    const savedDisabled = localStorage.getItem(STORAGE_KEY_DISABLED);
    const fingerprint = buildToolFingerprint(allTools);

    if (savedTools === fingerprint && savedDisabled) {
      return new Set<string>(JSON.parse(savedDisabled) as string[]);
    }

    // Tool list changed or first load — clear stale data
    localStorage.setItem(STORAGE_KEY_TOOLS, fingerprint);
    localStorage.removeItem(STORAGE_KEY_DISABLED);
    return null;
  }

  /**
   * Save the current disabled tools and tool list snapshot to localStorage.
   */
  static save(enabledTools: Set<string>, allTools: string[]): void {
    const disabled = allTools.filter(t => !enabledTools.has(t));
    localStorage.setItem(STORAGE_KEY_TOOLS, buildToolFingerprint(allTools));
    localStorage.setItem(STORAGE_KEY_DISABLED, JSON.stringify(disabled));
  }
}
