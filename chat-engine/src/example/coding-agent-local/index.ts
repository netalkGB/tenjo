import * as fs from 'fs';
import * as path from 'path';
import { LocalSandbox } from '../../sandbox/LocalSandbox.js';
import { runCodingAgentCli } from '../../coding-agent/agentCli.js';
import { createWorkspace } from './workspace.js';

// Scratch directory, pre-created at startup. In document mode the Workspace uses
// it as the agent's working directory, so intermediates stay hidden here and only
// the finished deliverable is published to the visible dir.
const SCRATCH_DIR = '.tmp';

/**
 * Coding agent CLI — NON-sandboxed example that runs on the HOST filesystem.
 *
 * File operations are rooted at process.cwd(), so running this from a project
 * folder lets the agent build source code right there. There is NO isolation —
 * the agent's bash runs on your machine. For real per-project isolation use the
 * sandboxed CLI (`coding-agent/cli.ts`, Docker). This example also enables the
 * document/scratch workspace mode (see workspace.ts).
 */
async function main(): Promise<void> {
  const root = process.cwd();
  // Pre-create the scratch dir so it is ready the moment a document task starts.
  await fs.promises.mkdir(path.join(root, SCRATCH_DIR), { recursive: true });
  const workspace = createWorkspace({
    root,
    scratchDir: SCRATCH_DIR,
  });
  // Tools resolve paths against the workspace cwd, evaluated per call so a turn
  // boundary can switch the agent into / out of the scratch dir.
  const sandbox = new LocalSandbox(() => workspace.getCwd());
  await runCodingAgentCli({ sandbox, workspace, workingDirLabel: root });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
