# Sandbox (chat-engine)

Per-project **Docker sandbox** for the Tenjo coding agent, plus the host
fallback used for the CLI/tests. It gives the agent an isolated container to run
shell commands and edit files in, so an LLM driving `bash` can never touch the
host. Everything is driven through the `docker` CLI — no Docker SDK, no socket
handling — which is what keeps it working identically on **macOS, Windows and
Linux**.

This lives inside `chat-engine` (it was briefly a separate `tenjo-sandbox`
package; merged back in so `DockerSandbox` can be imported directly, with no
dependency-cycle workaround).

> Status: this is the **CLI-proven** first slice. Server integration and UI are
> deliberately **not** built yet — see [Roadmap](#roadmap). Prove the sandbox in
> the CLI, then decide.

---

## Why this exists

The coding agent (`chat-engine/src/coding-agent/`) is a ReAct loop with four
tools: `bash`, `read_file`, `str_replace`, `write_file`. Running those directly
on the host is fine for a local CLI, but to use the agent inside Tenjo — a
self-hosted app — the agent must run **sandboxed away from the host**. Docker
gives us that, and a Linux container also gives a uniform `bash` environment on
every host OS (Windows has no native bash). The host sees ONE container; inside
it a rootless podman runs each project as a pod (own mount + network namespace,
root inside) — see the isolation model below.

Hard constraints that shaped the design:

- **No DinD, no `--privileged`.** Never required. (On hosts that block
  unprivileged user namespaces — Ubuntu-family native Engine — the container is
  recreated once with `CAP_SYS_ADMIN`; that is probed, stamped on a label, and
  never assumed. The host OS is never modified.)
- **No Docker socket mounted into Tenjo, no daemon TCP reconfiguration.** A unix
  socket doesn't behave portably on Windows, and exposing the daemon over TCP is
  fiddly (certs + firewall). We avoid both.
- **Cross-platform.** The host may be macOS, Windows or Linux.

---

## Pieces

| File                                      | Role                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Sandbox.ts`                              | The `Sandbox` interface every coding tool depends on (+ explorer/diff types).                                                                             |
| `pathJail.ts`                             | `jailRelative` — fail-closed path jail for file ops.                                                                                                      |
| `LocalSandbox.ts`                         | Host-backed `Sandbox` (dev/test/CLI only — **no isolation**).                                                                                             |
| `DockerSandbox.ts`                        | Project-pod-backed `Sandbox`; bash enters the pod, file ops run on the outer fs.                                                                          |
| `SandboxManager.ts`                       | Lifecycle of the ONE shared container + volume: images, probe/mode, per-project pods, idle/orphan reaping.                                                |
| `dockerCli.ts`                            | The single `docker` CLI driver (string + binary capture).                                                                                                 |
| `podmanExec.ts`                           | Shared argv builders for entering the in-container rootless podman (normal vs compat mode).                                                               |
| `portRanges.ts`                           | Parsing of docker `-p` specs into host port ranges (dev-port block allocation + prompt hint).                                                             |
| `diffSnapshots.ts`                        | Pure diff of two workspace snapshots → created/updated/deleted.                                                                                           |
| `../../docker/agent-sandbox.Dockerfile`   | OUTER image (`tenjo-agent-sandbox:N`): `node:24-trixie` + rootless podman + `inotify-tools`.                                                              |
| `../../docker/agent-toolchain.Dockerfile` | INNER per-project image (`tenjo-agent-toolchain:N`), built by podman inside: node toolchain, CJK fonts, Chromium, GUI preview desktop, and Xvfb fallback. |
| `../../docker/agent-sandbox-seccomp.json` | Seccomp profile for the outer container (podman's default — allows the user namespaces rootless podman needs).                                            |

The agent **itself** (the LLM tool loop) runs in the host process. Only the
_effects_ — the shell command and the file write — execute inside the container.

---

## The `Sandbox` contract

`createCodingTools(sandbox)` depends only on this, so the exact same tools run on
`LocalSandbox` (host) or `DockerSandbox` (container):

```ts
interface Sandbox {
  exec(command, opts?): Promise<ExecResult>; // bash
  readFile(relPath): Promise<ReadFileResult>; // text
  readBinary(relPath): Promise<Buffer>; // PDF/image download
  writeFile(relPath, content): Promise<{ bytesWritten }>;
  listDir(relPath): Promise<DirEntry[]>; // file explorer
  snapshot(opts?): Promise<FileSnapshot>; // point-in-time change detection
  watch?(onEvent, opts?): SandboxWatcher; // REAL-TIME change stream (optional)
  dispose?(): Promise<void>;
}
```

- **File ops are path-jailed** to the workspace root (`jailRelative`, fail-closed):
  a `..` that climbs above the root is rejected; an empty/absolute path resolves
  to the root, never the host/container root.
- **`exec` is NOT path-jailed** — its isolation boundary is the _container_, so the
  model may run any command inside it.

### File explorer & change visualization

Two capabilities for a UI (and used by the CLI today):

- **`listDir(relPath)`** → `DirEntry[]` (`name`, `type: file|dir|other`, `size`),
  directories first. Lazy, per-directory navigation. `readFile`/`readBinary`
  back text and binary preview/download (e.g. a generated PDF).
- **`snapshot(opts?)`** → `Map<path, {size, mtimeMs}>` of every workspace file
  (excludes `node_modules`/`.git` by default). `diffSnapshots(before, after)`
  returns `{path, kind: created|updated|deleted}[]`. This catches files made as a
  side effect of `bash` (a generated PDF!), which the edit-tool calls never see.
- **`watch(onEvent, opts?)`** → streams `{path, kind}` changes in REAL TIME (see
  below). Optional: backends that can't watch omit it.

### Real-time file watching (`watch`)

Snapshots only see file state at the moment you snapshot — so changes from a
long-running, async process (a Vite dev server, a `--watch` build, anything
backgrounded with `&`) are missed at tool boundaries. `DockerSandbox.watch`
streams changes live instead:

- Backed by `inotifywait -m -r` (from `inotify-tools` in the OUTER image) on the
  outer filesystem — the workspace is bind-mounted into the pod on the same
  superblock, so pod-side writes are seen; the host parses the event stream into
  `{path, kind}` and calls `onEvent`. `stop()` ends it.
- Catches writes from **any** source (a tool, a bash-spawned server, a watcher),
  not just tool calls. `node_modules`/`.git` are excluded from the watch; the CLI
  additionally suppresses hidden-file noise (HOME caches like `.npm`/`.cache`,
  created because the project dir is `HOME`) but keeps `.tmp`. Directories show
  with a trailing `/` (so a bare `mkdir src` is visible as `+src/`).
- The CLI debounces (~400 ms) and prints `[files] +created ~updated -deleted`
  live. `LocalSandbox` has no `watch`; and if `inotifywait` is absent (older
  image) the CLI falls back to a per-tool snapshot diff — so reporting never
  silently breaks.

---

## How `DockerSandbox` works

- **`exec` (the agent's bash) runs INSIDE the project's pod** —
  `docker exec → podman exec <proj-…-main> bash -lc` — where the agent is root
  (apt installs work) and sees only its own workspace and network namespace. In
  compat mode the podman entry is wrapped with `setpriv --ambient-caps
+sys_admin` from root (a capability in the container's bounding set does
  nothing for a non-root exec user); the OCI runtime resets capability sets from
  the container spec, so it never leaks into the pod.
- **File ops (read/write/list/snapshot/watch) run on the OUTER filesystem** via
  plain `docker exec` — the workspace is bind-mounted into the pod at the SAME
  path, so no path translation exists anywhere. Reads run as root (files made by
  non-root inner uids map to subordinate uids outside); writes run as the
  sandbox user so they land owned by what the pod's root maps to. These are
  trusted, path-jailed server-side code paths; the agent itself can only reach
  files through `exec`, which the pod's mount namespace confines.
- The host filesystem is never read or written by Tenjo. File writes stream
  content over stdin; paths are passed as `$0` so a filename can never break out
  of the shell string. `listDir`/`snapshot` use GNU `find -printf`; `readBinary`
  captures raw stdout bytes; `watch` is a long-lived `inotifywait` spawn.

## How `SandboxManager` works (one container, one pod per project)

The host sees **ONE container and ONE volume** (`tenjo-sandbox-data`). Inside
the volume, project workspaces live at `/workspaces/<id>` and podman's storage
lives under `/workspaces/.tenjo-podman-storage`. Rootless podman runs each
project as a pod. `getSandbox(projectId)` returns a `DockerSandbox` bound to
that pod and the project's workspace subdir. The manager knows nothing about
HTTP or a database (a project id is an opaque string), so the same manager backs
the CLI and the server.

- **Privilege is probed, not assumed.** The container is created WITHOUT extra
  capabilities, with podman's own seccomp profile (allows the user-namespace
  syscalls Docker's default gates on SYS_ADMIN), `systempaths=unconfined`
  (unmasked /proc for the nested runtime), `/dev/fuse` + `/dev/net/tun`, and the
  LSM flag the host needs (`apparmor=unconfined` / `label=disable`, from
  `docker info`). Then a USABLE user namespace is probed with `unshare -Ur` —
  `-r` matters: Ubuntu's restriction lets the namespace be created but denies
  the uid_map write. If the probe fails (Ubuntu-family native Engine), the
  container is recreated once with `CAP_SYS_ADMIN` (**compat mode**); the mode
  is stamped on a label and re-verified on reuse. The host OS is never touched.
  NOTE: no `no-new-privileges` — it would break the setuid `newuidmap` behind
  the pods' multi-uid mappings (what makes `apt` work in projects).
- **Per-project isolation by pod**: a project container only sees its own
  bind-mounted workspace (mount namespace) and its own network namespace — one
  project's bash cannot read a sibling's files or reach its in-pod servers. The
  agent is **root inside its project container** (apt/global npm work), which
  the user namespace maps to the unprivileged sandbox uid outside. CPU/mem/pids
  limits remain container-wide (rootless podman can't delegate cgroups without
  systemd).
- **Two images**: the OUTER image (`tenjo-agent-sandbox:N`, podman host) is
  built by docker; the INNER toolchain image (`tenjo-agent-toolchain:N`) is
  built BY PODMAN inside the container on first use, fed the Dockerfile over
  stdin. Bump either tag on change — the container (outer) or the project pods
  (inner) are recreated to adopt it; the volume persists so no files are lost.
- **Dev server ports** (`publishPorts` + `portsPerProject`): docker `-p` specs
  publish a host range to the outer container at creation; each project pod is
  allocated the lowest-free **block** of that range (stamped on a pod label,
  freed with the pod) and publishes it on the outer interfaces, where docker's
  forwards arrive. The per-project block is exposed as `Sandbox.devPorts` and
  drives the dev-server prompt hint, so the agent is told exactly ITS ports.
  Range exhausted = clear error; widen the range or lower `portsPerProject`.
- **Persistence**: the volume is durable; `stop`/`rm` of the container loses
  nothing. `destroy(id)` removes the project's pod + directory; `reset()`
  removes the container + volume.
- **Lazy + single-flight** image builds and container start; project setup
  (dir + pod + port allocation) is serialized so concurrent new projects can't
  race a port block.
- **Reclamation**: `markIdle`/`stop`, `reapOrphans(knownIds)` (removes unknown
  pods and project dirs).

## Command-injection safety

A hard invariant, enforced at one chokepoint (`dockerCli.ts`):

- **We never run a shell on assembled input.** `runDocker` spawns with
  `shell: false`, so every `args` element is a literal argv token — a path, a
  project id or a `find` pattern placed there can't be re-parsed as shell syntax.
- The only shell used inside the container is a **fixed** `sh -c '<literal>'` for
  file ops, with the untrusted path passed as a separate argv read through a
  quoted positional (`"$0"`, plus `cat --`) — the shell does not re-evaluate it,
  so a filename like `$(rm -rf /)` or `x; rm -rf .` is stored/handled literally.
- `projectId` is reduced to one safe path component (`[A-Za-z0-9_.-]`, `.`/`..`
  rejected), so it can't traverse out of `/workspaces` or inject.
- The `bash` tool **does** run arbitrary shell — by design; the **container** is
  its isolation boundary, not string escaping.

---

## Cross-platform & deployment

We **only** ever shell out to the `docker` CLI, inheriting the full environment
(including `DOCKER_HOST`). The CLI transparently picks the transport (unix socket
on Linux/macOS, named pipe on Windows, or the `DOCKER_HOST` TCP endpoint when
set), so **our code references no socket and assumes no transport** — the Windows
unix-socket problem never arises.

| Deployment                 | Tenjo runs as | Sandbox connection                                                                                | DinD / privileged | Socket mount                       |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------- |
| **Host (default, today)**  | host process  | `DOCKER_HOST` unset → local transport                                                             | no                | none                               |
| **Containerized (future)** | a container   | `DOCKER_HOST=tcp://dockerproxy:2375` via a [socket-proxy] sidecar on the compose-internal network | no                | only inside the tiny proxy sidecar |

The containerized mode needs **no daemon reconfiguration, no TLS certs, no host
firewall changes**, and reuses this code unchanged (only an env var + a compose
file). Not built yet, but the design (named volume, all-ops-via-exec,
`DOCKER_HOST` inheritance) keeps the door open.

[socket-proxy]: https://github.com/Tecnativa/docker-socket-proxy

---

## Usage

### CLI (today)

Two entry points (shared loop in `coding-agent/agentCli.ts`):

```bash
# isolated per-project Docker sandbox — THE CLI (coding-agent/cli.ts):
node chat-engine/dist/coding-agent/cli.js --project my-project

# non-sandboxed, runs on the HOST filesystem — example (no isolation):
node chat-engine/dist/example/coding-agent-local/index.js
```

The sandboxed CLI works inside the shared container at `/workspaces/my-project`
(`--project` defaults to `default`). After each turn the CLI prints the files it
changed. Inspect the workspace with the agent's own tools or
`docker exec tenjo-sandbox ls /workspaces/my-project`. (Driving the agent needs
an LM Studio server at `http://localhost:1234`.)

### Programmatic

```ts
import * as fs from 'fs';
import {
  SandboxManager,
  createCodingTools,
  bundleTools,
  diffSnapshots,
} from 'tenjo-chat-engine';

const manager = new SandboxManager();
if (!(await manager.isDockerAvailable())) throw new Error('Docker required');
await manager.ensureImage();

const sandbox = await manager.getSandbox(projectId); // lazy container start
const { definitions, handlers } = bundleTools(createCodingTools(sandbox));
// → advertise `definitions` to the model; dispatch tool calls to `handlers`.

// file explorer:
const entries = await sandbox.listDir(''); // [{ name, type, size }, ...]
const text = (await sandbox.readFile('README.md')).content;
fs.writeFileSync('out.pdf', await sandbox.readBinary('out.pdf')); // export a binary

// live change feed (real time, any source):
const w = sandbox.watch?.((e) => console.log(e.kind, e.path));
// ... later: w?.stop();

// or point-in-time diff:
const before = await sandbox.snapshot();
const changed = diffSnapshots(before, await sandbox.snapshot());
```

`getSandbox(projectId)` reuses an existing project's dir/uid, so a separate
process (a Node REPL, the future server) can list/read the files a running CLI
created. If Docker is unavailable it throws `DockerUnavailableError` — surface it,
don't fall back to `LocalSandbox` (which has no isolation).

---

## Build

CommonJS, compiled with `tsc` as part of chat-engine. The base image build
context (`docker/`) ships with the package.

```bash
npm -w chat-engine run build
```

---

## Roadmap

Built after the CLI proof is accepted (kept out of scope on purpose):

1. **Server integration** — a `projects` table + `threads.project_id` (history
   stays in the existing `messages` tree, not duplicated); a thin
   `ProjectSandboxService` bridging DB state to `SandboxManager`; `/api/projects`
   routes; the coding tools wired into `MessageService`'s existing tool loop with
   the **mutating** tools (`bash`/`write_file`/`str_replace`) gated through the
   existing `ToolApprovalEmitter` and `read_file` auto-approved. A **file explorer
   API** (`listDir`/`readFile`/`readBinary`) and a **live file-change feed**
   (`watch`, streamed over the existing SSE) back the UI.
2. **Containerized Tenjo (optional)** — a docker-compose with a socket-proxy
   sidecar and `DOCKER_HOST=tcp://dockerproxy:2375`. No code change here.
3. **UI** — project create/list, project-scoped threads, file explorer + diff/PDF
   preview, approval UI.
4. ~~**Rootless Podman pods**~~ — **implemented** (this document describes it).
5. ~~**GUI preview sidecar**~~ — **implemented**. A per-project sidecar from
   `docker/agent-gui.Dockerfile` (headless sway + wayvnc + Xwayland + Chromium —
   all permissive licenses, no copyleft; KasmVNC and the linuxserver Firefox
   image were rejected for being GPL) joins the project's pod on demand
   (`startGui`/`stopGui`/`getGuiStatus`), so the netns guarantees it only sees
   that project's servers. The LAST port of the project's published block is
   reserved as its VNC port (`splitPortBlock` — the dev-server hint shrinks
   accordingly); the server exposes it through an authenticated WebSocket relay
   to noVNC in the browser.
