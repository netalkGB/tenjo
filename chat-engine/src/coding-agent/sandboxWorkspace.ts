import { PRIVATE_TMP_DIR, type Sandbox } from '../sandbox/Sandbox.js';

/**
 * Hidden scratch directory bootstrap for the SANDBOXED agent (Docker).
 *
 * Important: this must not move files at turn boundaries. Earlier versions tried
 * to classify final deliverables vs. intermediates after the agent finished, but
 * that misclassified legitimate outputs such as converted videos. The model is
 * prompted to place intermediates in `.tmp` itself and final deliverables in the
 * workspace root.
 */
export interface SandboxDocumentWorkspace {
  /** Initializes scratch storage and workspace state. */
  init(): Promise<void>;
  /** Updates the workspace mode from the turn prompts. */
  onTurnStart(promptTexts: readonly string[]): void;
  /** Runs optional pre-turn maintenance. */
  prepareTurn(): Promise<void>;
  /** Runs post-turn publishing and cleanup. */
  onTurnComplete(result?: WorkspaceTurnResult): Promise<void>;
}

type WorkspaceTurnResult = {
  assistantMessage: { content?: unknown } | null;
};

const DEFAULT_SCRATCH_DIR = PRIVATE_TMP_DIR;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const NOOP_WORKSPACE: SandboxDocumentWorkspace = {
  init: async () => {},
  onTurnStart: () => {},
  prepareTurn: async () => {},
  onTurnComplete: async () => {},
};

export function createSandboxDocumentWorkspace(options: {
  sandbox: Sandbox;
  /** Hidden scratch directory name (relative to the project root). */
  scratchDir?: string;
}): SandboxDocumentWorkspace {
  const { sandbox } = options;
  const scratchDir = options.scratchDir ?? DEFAULT_SCRATCH_DIR;
  const getWorkspaceDir = sandbox.getWorkspaceDir?.bind(sandbox);
  if (!getWorkspaceDir) {
    return NOOP_WORKSPACE;
  }

  return {
    async init(): Promise<void> {
      await sandbox.exec(`mkdir -p -- ${shellQuote(scratchDir)}`);
    },

    onTurnStart(): void {},

    async prepareTurn(): Promise<void> {},

    async onTurnComplete(_result?: WorkspaceTurnResult): Promise<void> {},
  };
}
