import {
  parsePublishedHostRanges,
  type PortRange,
} from '../sandbox/portRanges.js';

export type HostPrivatePreviewHintKind = 'all' | 'web' | 'native';

const HOST_PRIVATE_COMMON_HINT = [
  'HOW THE USER RUNS THINGS — read first. The user has NO terminal and NO machine',
  'of their own here; they cannot run build or run commands. NEVER end by telling',
  'them to run something themselves (no "run `cmake`/`make`/`npm run`/`./app`", no',
  '"build it on any system with ... installed", no install-and-run steps). The ONLY',
  'way they can use a running app is the GUI preview. So YOU build and run it here',
  'in the sandbox, verify it actually works, make it openable in the GUI preview',
  '(see below), and close by telling them to open the preview — not by handing them',
  'commands to run. (Documenting build steps inside a README file is fine; just do',
  'not present them as how the USER runs the result.)',
  'For CLI/console programs with no web or native GUI surface, compile/build them',
  'here and run a representative smoke test with scripted stdin in bash. In that',
  'case no preview manifest is needed; report the command and observed output',
  'instead of telling the user to run it locally.',
  'Generated files/documents (PDF/Office/image/archive/etc.) also do NOT need a',
  'preview manifest. Verify the file and link it in Markdown instead.',
  'If a required runtime/compiler is missing, install it in the sandbox after',
  'plan approval, then build and run the program here. Do NOT treat a missing',
  'runtime as a reason to provide only source code or local setup instructions.',
].join('\n');

const HOST_PRIVATE_WEB_HINT = [
  '',
  'DEV SERVER — read carefully. There is NO host networking here: the user does',
  'NOT open your server from their own browser. They view it through the GUI',
  "preview, whose browser runs INSIDE this sandbox and shares the project's",
  'network, so it reaches your server on localhost on ANY port. So when you start',
  'a web/dev server:',
  '  - bind it to localhost (or 0.0.0.0) on any free port — there is no required',
  "    range. Use the project's normal port; only change it if it is already taken",
  '    (check with e.g. `ss -ltn`).',
  '  - start it in the BACKGROUND so it outlives your command, e.g.',
  '    `nohup <command> >server.log 2>&1 &` — a foreground server blocks your shell.',
  '  - then RECORD how to start it in `.tenjo/dev-servers.json` (create the dir if',
  '    needed): a JSON array of `{"port": <number>, "command": "<exact shell command>",',
  '    "cwd": "<directory to run it from, workspace-relative>", "path": "<optional URL',
  '    path to open>"}`. The preview button reads this file to (re)launch it later,',
  '    so keep it accurate. Pick the right command for the project: plain static HTML',
  '    that is the FINAL browser-viewed deliverable → `python3 -m http.server <port>`',
  '    with "cwd" at the folder holding the main HTML file; if the main file is NOT',
  '    named index.html, set "path" to that filename/path (e.g. "omikuji.html") so the',
  '    preview opens the file instead of the directory listing; a framework (Vite,',
  '    Next, Astro, SvelteKit, CRA, ...) → its dev',
  '    command on a port (run `npm install` first if node_modules is missing). Do NOT',
  '    serve un-built framework sources statically. Do NOT create this manifest for',
  '    HTML used only as an intermediate source for a generated PDF/document.',
  '    This file is INTERNAL plumbing: write it silently. Do NOT mention it, the',
  '    `.tenjo` dir, or "record the config" in your plan, steps or reply to the user.',
  'Once the server is up and recorded, call the `restart_preview` tool to open the',
  'preview for the user — and call it AGAIN after any rebuild that changes the served',
  'output, so they see the current build. Then tell the user they can open it in the',
  'GUI preview and include the address as a bare http://localhost:<the port you used>/',
  'or http://localhost:<port>/<path> when the main static HTML file is not index.html',
  '— the UI turns that into an "open preview" button. Do NOT call it a public / access',
  '/ 公開 URL or imply it is reachable outside the sandbox: it only works inside the',
  'preview.',
].join('\n');

const HOST_PRIVATE_NATIVE_GUI_HINT = [
  '',
  'NATIVE GUI APP (Gtk, Qt, SDL, Tk, GLFW, ...). The GUI preview is a real Wayland',
  'desktop (sway) with Xwayland, so a native windowed app you BUILD here can be shown',
  'on it too — there is no web server and no port. To make it openable, record it in',
  'the SAME `.tenjo/dev-servers.json` array as a GUI entry:',
  '  `{"kind": "gui", "command": "<exact command that opens the window>",',
  '    "cwd": "<directory to run it from, workspace-relative>"}`.',
  'The preview launches that command on the desktop (and relaunches it if it exited),',
  'so the command must be the foreground app itself (e.g. `./build/myapp`, `python3',
  'main.py`, `npm run start`), NOT a backgrounded one. The preview ALREADY provides',
  'the display WHEN `restart_preview` opens it. The current shell may show empty',
  '`DISPLAY`/`WAYLAND_DISPLAY` before that; do NOT treat that as a missing desktop.',
  'Do NOT put display environment variables (`DISPLAY=...`, `WAYLAND_DISPLAY=...`,',
  '`SWAYSOCK=...`) in the manifest command; the preview launcher injects the',
  'correct Wayland and Xwayland environment, including `DISPLAY=:0` for X11-only',
  'toolkits. Do NOT conclude that Xwayland cannot run an X11 toolkit merely from',
  'a missing shell DISPLAY or a failed hand-launched test; use `restart_preview`',
  'and inspect `/tmp/gui-app.log` only if the preview launch itself fails.',
  'Run the app DIRECTLY: do NOT wrap it in `xvfb-run`, `Xvfb`, or any virtual',
  'framebuffer — that renders the window to an invisible display, leaving the',
  'preview black. Xvfb is only for offscreen smoke tests, never for the command in',
  '`.tenjo/dev-servers.json`. Set "cwd" to the real directory the app runs from',
  '(the folder with the binary/entry file), never "." . Use a gui entry ONLY for a',
  'native windowed program; anything viewable in a browser stays a web entry',
  '(above).',
  'For visible desktop apps, install GUI-capable runtime packages when a runtime',
  'is missing; avoid headless-only packages for toolkits that need to create real',
  'windows. Read-only version/existence probes are fine during planning; prefer',
  '`command -v <tool>` or package metadata for existence checks, and use the',
  "tool's documented version command only when the version matters. Installs",
  'happen only after approval.',
  'OPENING / REFRESHING THE PREVIEW — you drive it, the user has no button for this.',
  'After you record the gui entry AND the app builds, call the `restart_preview` tool',
  'to bring the preview up. Call `restart_preview` AGAIN after EVERY rebuild or code',
  'change — the preview keeps showing the OLD running copy until you do, and the tool',
  'kills the running copy and launches your newest build. Do NOT skip it after a',
  '`make`/build, and never ask the user to restart the app themselves.',
  'When the app is ready, tell the user they can open it in the GUI preview. The',
  'manifest is INTERNAL plumbing: write it silently — do NOT mention it or the `.tenjo`',
  'dir (calling `restart_preview` is fine to do silently too).',
].join('\n');

export function buildHostPrivatePreviewHint(
  kind: HostPrivatePreviewHintKind = 'all'
): string {
  return [
    HOST_PRIVATE_COMMON_HINT,
    kind === 'all' || kind === 'web' ? HOST_PRIVATE_WEB_HINT : '',
    kind === 'all' || kind === 'native' ? HOST_PRIVATE_NATIVE_GUI_HINT : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

const HOST_PRIVATE_COMPACT_COMMON_HINT = [
  'RUNNING/PREVIEW: user has no terminal. You install/build/run. Runnable web or',
  'native GUI apps MUST open in GUI preview before final answer; do not only say',
  '"run npm/make/./app". CLI-only: bash smoke test. Generated files/docs: link',
  'the file, no preview manifest.',
].join('\n');

const HOST_PRIVATE_COMPACT_WEB_HINT = [
  'Web GUI: start dev/static server in background, record `.tenjo/dev-servers.json`',
  'as [{"port":N,"command":"cmd","cwd":"dir","path":"optional"}], then MUST call',
  'restart_preview. Set cwd to the app dir; path only for non-index static HTML.',
].join('\n');

const HOST_PRIVATE_COMPACT_NATIVE_HINT = [
  'Native GUI: record [{"kind":"gui","command":"./app","cwd":"dir"}]. Command is',
  'foreground app, not backgrounded. No DISPLAY/WAYLAND/SWAYSOCK/Xvfb/xvfb-run;',
  'preview injects display. After build/rebuild MUST call restart_preview. If it',
  'fails, inspect /tmp/gui-app.log, fix, rebuild, re-record, call again.',
].join('\n');

export function buildCompactHostPrivatePreviewHint(
  kind: HostPrivatePreviewHintKind = 'all'
): string {
  return [
    HOST_PRIVATE_COMPACT_COMMON_HINT,
    kind === 'all' || kind === 'web' ? HOST_PRIVATE_COMPACT_WEB_HINT : '',
    kind === 'all' || kind === 'native' ? HOST_PRIVATE_COMPACT_NATIVE_HINT : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const HOST_PRIVATE_HINT = buildHostPrivatePreviewHint('all');

export function buildDevServerHint(
  ports: readonly string[] | PortRange | undefined
): string {
  if (ports === undefined) {
    return HOST_PRIVATE_HINT;
  }
  const ranges: readonly PortRange[] = Array.isArray(ports)
    ? parsePublishedHostRanges(ports)
    : [ports as PortRange];
  if (ranges.length === 0) {
    return '';
  }
  const rangeText = ranges
    .map((range) =>
      range.start === range.end
        ? `${range.start}`
        : `${range.start}-${range.end}`
    )
    .join(', ');
  const firstPort = ranges[0].start;
  return [
    `DEV SERVER PORTS — read carefully. This sandbox exposes ONLY ports ${rangeText} to`,
    'the host. A web/dev server you start is reachable by the user ONLY if it (a) binds',
    `to 0.0.0.0 (never localhost / 127.0.0.1) AND (b) listens on a port in ${rangeText}.`,
    'A server on any other port — or bound to localhost — is completely invisible to the',
    'user, who will report "cannot connect". So when you start a dev/web server you MUST:',
    `  - use port ${firstPort} (or another port within ${rangeText}); OVERRIDE the project's`,
    `    default port if it differs — pass the port explicitly, e.g.`,
    `    \`npm run dev -- --host 0.0.0.0 --port ${firstPort}\`, \`vite --host 0.0.0.0 --port ${firstPort}\`,`,
    `    or \`python3 -m http.server --bind 0.0.0.0 ${firstPort}\`.`,
    `  - if that port is already taken (you are running several servers), pick the`,
    `    next FREE port within ${rangeText} — check first with e.g. \`ss -ltn\`.`,
    '  - start it in the BACKGROUND so it outlives your command, e.g.',
    `    \`nohup <command> >server.log 2>&1 &\` — a foreground server blocks your shell.`,
    '  - then RECORD how to start it in `.tenjo/dev-servers.json` (create the dir if',
    '    needed): a JSON array of `{"port": <number>, "command": "<exact shell command>",',
    '    "cwd": "<directory to run it from, workspace-relative>", "path": "<optional URL',
    '    path to open>"}`. The UI\'s preview button reads this file to restart your',
    '    server automatically later, so keep it accurate and update it whenever the',
    '    start command, port, or URL path changes.',
    '    This file is INTERNAL plumbing: just write it silently. Do NOT mention it, the',
    '    `.tenjo` dir, or "record the config" in your plan, your steps or your reply to',
    '    the user — they only care about the app, not this bookkeeping.',
    'PREVIEW MANIFEST — this is the ONLY thing the UI uses to launch a preview, and it',
    'cannot guess your project type, so YOU decide and record it. Whenever you build',
    'ANYTHING viewable in a browser, write its launch into `.tenjo/dev-servers.json`,',
    'even when no server is running yet — pick the right command for the project:',
    `  - plain static HTML/CSS/JS: \`python3 -m http.server --bind 0.0.0.0 ${firstPort}\``,
    `    with "cwd" set to the folder that holds the main HTML file; if the main file`,
    '    is not named index.html, also set "path" to that filename/path.',
    `  - a framework that needs a dev server (Vite, Next, Astro, SvelteKit, CRA, ...):`,
    `    its dev command bound to 0.0.0.0 on a port in ${rangeText}, e.g.`,
    `    \`npm run dev -- --host 0.0.0.0 --port ${firstPort}\` (run \`npm install\` first if`,
    `    node_modules is missing). Do NOT serve un-built framework sources with http.server.`,
    'When something is viewable, tell the user they can open it in the GUI preview and',
    'include the address as a bare http://localhost:<the port you used>/, appending',
    '/<path> when the main static HTML file is not index.html — the UI turns that into',
    'an "open preview" button. Do NOT call it a public / access / 公開 URL or imply it',
    'is reachable outside the sandbox: it only works inside the preview. Never start a',
    `server on, or report, a port outside ${rangeText}.`,
  ].join('\n');
}

export function buildCompactDevServerHint(
  ports: readonly string[] | PortRange | undefined
): string {
  if (ports === undefined) {
    return buildCompactHostPrivatePreviewHint('all');
  }
  const ranges: readonly PortRange[] = Array.isArray(ports)
    ? parsePublishedHostRanges(ports)
    : [ports as PortRange];
  if (ranges.length === 0) {
    return '';
  }
  const firstPort = ranges[0].start;
  return [
    `Web preview: bind dev/static servers to 0.0.0.0 on exposed port ${firstPort}`,
    'or another allocated free port. Start it in background, record',
    '`.tenjo/dev-servers.json` with port/command/cwd/path, then call restart_preview.',
  ].join('\n');
}
