/**
 * Shared argv builders for talking to the ROOTLESS PODMAN that runs inside the
 * outer sandbox container. Used by both SandboxManager (pod lifecycle) and
 * DockerSandbox (per-command exec), so the normal/compat difference lives in
 * exactly one place.
 *
 * normal mode — the host's Docker setup lets the sandbox user create a usable
 * user namespace (`unshare -Ur` passes), so podman runs as the plain `sandbox`
 * user with no extra container capabilities.
 *
 * compat mode — the normal-mode probe failed, so the outer container was
 * recreated with CAP_SYS_ADMIN and podman is entered through a root `docker
 * exec` plus `setpriv`. Ubuntu-family native Docker Engine is the known case
 * this fixes, but the selection is probe-based rather than OS-name based. A
 * capability in the container's bounding set does nothing for a non-root exec
 * user, so `setpriv` puts SYS_ADMIN in the podman process's ambient set. It
 * does not leak into the project containers: the OCI runtime resets every
 * capability set from the container spec.
 */
export type SandboxMode = 'normal' | 'compat';

/** Unprivileged user inside the outer container that owns podman + workspaces. */
export const SANDBOX_USER = 'sandbox';
/** Its uid (fixed by agent-sandbox.Dockerfile). */
export const SANDBOX_UID = 2000;

/** Hand the ambient capability to an unprivileged process (run from root). */
export const SETPRIV_PREFIX = [
  'setpriv',
  '--reuid',
  SANDBOX_USER,
  '--regid',
  SANDBOX_USER,
  '--init-groups',
  '--inh-caps',
  '+sys_admin',
  '--ambient-caps',
  '+sys_admin',
];

/** Env podman needs when entered via `docker exec` (no login shell). */
const PODMAN_ENV = [
  'env',
  `HOME=/home/${SANDBOX_USER}`,
  `XDG_RUNTIME_DIR=/run/user/${SANDBOX_UID}`,
];

/**
 * Build the full `docker` argv (starting at `exec`) that runs
 * `podman <podmanArgv...>` inside the outer container in the given mode.
 */
export function buildPodmanExecArgs(
  containerName: string,
  mode: SandboxMode,
  podmanArgv: readonly string[],
  opts?: { interactive?: boolean }
): string[] {
  const interactive = opts?.interactive ? ['-i'] : [];
  if (mode === 'compat') {
    return [
      'exec',
      ...interactive,
      '-u',
      'root',
      containerName,
      ...SETPRIV_PREFIX,
      ...PODMAN_ENV,
      'podman',
      ...podmanArgv,
    ];
  }
  return [
    'exec',
    ...interactive,
    '-u',
    SANDBOX_USER,
    containerName,
    ...PODMAN_ENV,
    'podman',
    ...podmanArgv,
  ];
}
