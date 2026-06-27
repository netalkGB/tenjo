import { SandboxManager } from '../sandbox/SandboxManager.js';
import { color } from './colors.js';
import { runCodingAgentCli } from './agentCli.js';
import { buildDevServerHint } from './devServerHint.js';
import {
  SANDBOX_TOOLCHAIN_HINT,
  SANDBOX_WORKSPACE_HINT,
} from './sandboxToolchain.js';

const DEFAULT_PROJECT_ID = 'default';

const DEV_PORT_SPECS = ['127.0.0.1:5173-5183:5173-5183'];
const DEV_PORTS_PER_PROJECT = 11;

function parseProjectArg(argv: readonly string[]): string {
  const flagIndex = argv.indexOf('--project');
  if (flagIndex !== -1 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1];
  }
  const inline = argv.find((arg) => arg.startsWith('--project='));
  return inline ? inline.slice('--project='.length) : DEFAULT_PROJECT_ID;
}

async function main(): Promise<void> {
  const projectId = parseProjectArg(process.argv);
  const manager = new SandboxManager({
    publishPorts: DEV_PORT_SPECS,
    portsPerProject: DEV_PORTS_PER_PROJECT,
  });
  if (!(await manager.isDockerAvailable())) {
    console.error(
      color.error(
        'Docker is not available. Install Docker Engine/Desktop and ensure the daemon is running.'
      )
    );
    process.exit(1);
  }
  console.log(
    color.status(
      `[sandbox] preparing project "${projectId}" (first run builds the image, which can take a while)...`
    )
  );
  await manager.ensureImage();
  const sandbox = await manager.getSandbox(projectId);
  console.log(
    color.status(
      `[sandbox] project "${projectId}" ready — isolated workspace at /workspace`
    )
  );

  await runCodingAgentCli({
    sandbox,
    onExit: () => manager.markIdle(),
    workingDirLabel: `sandbox container, /workspace`,
    systemPromptSuffix: [
      SANDBOX_WORKSPACE_HINT,
      buildDevServerHint(sandbox.devPorts ?? DEV_PORT_SPECS),
      SANDBOX_TOOLCHAIN_HINT,
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
