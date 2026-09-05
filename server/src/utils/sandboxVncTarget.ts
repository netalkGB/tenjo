import { mapContainerPortToHostPort } from 'tenjo-chat-engine';

const LOOPBACK_OR_DOCKER_HOST = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  'host.docker.internal'
]);

/**
 * Host the VNC relay connects to.
 * `AGENT_SANDBOX_VNC_HOST` / `AGENT_SANDBOX_HOST` win; otherwise the
 * sandbox container IP; otherwise loopback (published-port setups).
 */
export function resolveSandboxVncHost(
  override: string | undefined,
  containerIp: string | undefined
): string {
  const trimmed = override?.trim();
  if (trimmed) {
    return trimmed;
  }
  const ip = containerIp?.trim();
  if (ip) {
    return ip;
  }
  return '127.0.0.1';
}

/** True when `host` is reached via docker `-p` on the Docker host, not the container net. */
export function usesPublishedHostPort(host: string): boolean {
  return LOOPBACK_OR_DOCKER_HOST.has(host);
}

/**
 * TCP port the relay should dial. Container IP / network name → in-container
 * VNC port. Loopback / host.docker.internal → mapped host port when published.
 */
export function resolveSandboxVncPort(
  host: string,
  containerPort: number,
  publishPorts: readonly string[]
): number {
  if (!usesPublishedHostPort(host)) {
    return containerPort;
  }
  return (
    mapContainerPortToHostPort(publishPorts, containerPort) ?? containerPort
  );
}
