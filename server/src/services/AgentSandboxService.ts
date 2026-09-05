import {
  SandboxError,
  SandboxManager,
  type SandboxPrewarmPhase
} from 'tenjo-chat-engine';
import logger from '../logger';

export const AGENT_SANDBOX_UNAVAILABLE_MESSAGE =
  'The agent sandbox is not available.';

/**
 * Optional docker `-p` specs for the sandbox container. Empty (the default)
 * does not publish VNC to the host; the WebSocket relay dials the container.
 */
export const SANDBOX_PUBLISH_PORTS = process.env.AGENT_SANDBOX_PORTS
  ? process.env.AGENT_SANDBOX_PORTS.split(',').filter(Boolean)
  : [];

/** Override for the VNC relay TCP host. Unset → container IP, else 127.0.0.1. */
export const SANDBOX_VNC_HOST =
  process.env.AGENT_SANDBOX_VNC_HOST || process.env.AGENT_SANDBOX_HOST;

export const sandboxManager = new SandboxManager({
  portMode: 'vnc-single',
  publishPorts: SANDBOX_PUBLISH_PORTS,
  guiKeyboard: process.env.AGENT_GUI_KEYBOARD
});

/**
 * Shared sandbox lifecycle status surfaced to the UI.
 */
export type SandboxStatus = 'unknown' | 'unavailable' | 'preparing' | 'ready';

export interface SandboxStatusInfo {
  status: SandboxStatus;
  detail?: string;
}

const PHASE_DETAIL: Record<SandboxPrewarmPhase, string> = {
  'building-image': 'Building the sandbox image (first run only)…',
  'starting-container': 'Starting the sandbox container…',
  'building-toolchain': 'Building the project toolchain image (first run only)…'
};

let current: SandboxStatusInfo = { status: 'unknown' };
const listeners = new Set<(info: SandboxStatusInfo) => void>();

function setStatus(status: SandboxStatus, detail?: string): void {
  current = { status, detail };
  for (const listener of listeners) {
    try {
      listener(current);
    } catch (error) {
      logger.error('[sandbox] status listener failed', { error });
    }
  }
}

export function getSandboxStatus(): SandboxStatusInfo {
  return current;
}

export function onSandboxStatusChange(
  listener: (info: SandboxStatusInfo) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let initialized = false;

/**
 * Probe Docker once and prewarm the sandbox in the background.
 */
export async function initAgentSandbox(): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;
  try {
    if (!(await sandboxManager.isDockerAvailable())) {
      logger.warn(
        '[sandbox] Docker is not available - the agent feature is disabled'
      );
      setStatus('unavailable', 'Docker is not available.');
      return;
    }
    setStatus('preparing', PHASE_DETAIL['building-image']);
    await sandboxManager.prewarm((phase) => {
      setStatus('preparing', PHASE_DETAIL[phase]);
    });
    setStatus('ready');
    logger.info('[sandbox] agent sandbox ready');
  } catch (error) {
    logger.error('[sandbox] failed to initialize sandbox', { error });
    setStatus(
      'unavailable',
      error instanceof SandboxError ? error.message : 'Sandbox setup failed.'
    );
  }
}

export function isAgentSandboxReady(): boolean {
  return current.status === 'ready';
}

export function isAgentSandboxUsable(): boolean {
  return current.status !== 'unavailable';
}
