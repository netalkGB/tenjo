/**
 * System-prompt note about the tools the SANDBOX IMAGE pre-installs
 * (see chat-engine/docker/agent-sandbox.Dockerfile). It is appended to the
 * coding-agent system prompt ONLY by the Docker-sandbox entry points (the
 * sandboxed CLI and the server) — never by the host example, which runs on the
 * user's real machine and has no such guarantee, so telling it these exist would
 * be a lie.
 *
 * KEEP IN SYNC with the Dockerfile: if the fonts or libraries installed there
 * change, update this text so the agent is told the truth.
 */
/**
 * System-prompt note anchoring the agent to its sandbox workspace root. Appended
 * (like {@link SANDBOX_TOOLCHAIN_HINT}) ONLY by the Docker-sandbox entry points,
 * because the `/workspace` root and the "absolute paths are rooted at the
 * workspace" jail behavior are sandbox-specific. Without it weaker models invent
 * a generic home path (for example `/home/user/foo.py`); the path jail then roots that
 * absolute path AT the workspace, creating a stray `home/user/…` mirror folder
 * instead of writing where intended. Telling the model the truth about how its
 * paths resolve keeps files at the real root.
 */
export const SANDBOX_WORKSPACE_HINT = [
  'WORKSPACE: your working directory is `/workspace` — the ONLY place your files',
  'are saved and shown to the user. Keep EVERYTHING under it. Refer to files by a',
  'path relative to `/workspace` (e.g. `memopad.py`, `src/app.py`). An absolute',
  'path is interpreted RELATIVE TO `/workspace`, so `/home/user/memopad.py` or',
  '`/root/notes.txt` does NOT reach a real home directory — it silently creates a',
  'stray `home/user/...` or `root/...` folder inside the project. Never put project',
  'files under `/home`, `/root`, `/tmp` or other system paths: use a relative',
  'path, or `/workspace/...` if you must be absolute.',
  '',
  'KEEP OUTPUTS ORGANIZED YOURSELF. There is no automatic cleanup or publishing',
  'after you finish. Put temporary scripts, downloaded assets, extracted frames,',
  'and other intermediates under `.tmp/` when you create them. Put every final',
  'deliverable the user should download or inspect directly in `/workspace` (the',
  'workspace root), never only in `.tmp/`. Do not delete your build scripts or',
  'sources after finishing; they are needed for follow-up edits. Once the final',
  'deliverable is built in the root and verified, write your summary and stop.',
].join('\n');

export const SANDBOX_COMPACT_WORKSPACE_HINT = [
  'WORKSPACE: use `/workspace` only; refer to relative paths. Never put project',
  'files under /home, /root, or /tmp. No automatic cleanup: put intermediates in',
  '`.tmp`, final deliverables in root, and leave sources/scripts for follow-ups.',
].join('\n');

export const SANDBOX_COMMON_TOOLCHAIN_HINT = [
  'COMMON TOOLCHAIN — already installed: Node/npm, Python 3, git, and Chromium.',
  'Other runtimes/toolchains are not guaranteed. Read-only existence, version,',
  'and package-metadata probes are allowed while planning. Prefer `command -v',
  '<tool>` or package metadata for existence checks; use a documented version',
  'command only when the version matters. Install missing dependencies only after',
  'approval.',
  'A missing runtime/compiler is NOT a blocker or a reason to hand work back to',
  'the user. If the task needs Java, Rust, Go, C/C++, Ruby, PHP, etc. and the',
  'toolchain is missing, include an install step in the plan; after approval,',
  'install it inside the sandbox (use `apt-get` directly when appropriate), then',
  'compile/build/run a real smoke test. Do NOT finish with unverified source code',
  'or tell the user to install the runtime locally.',
].join('\n');

export const SANDBOX_COMPACT_COMMON_TOOLCHAIN_HINT = [
  'Installed: Node/npm, Python3, git, Chromium, common fonts. Other runtimes may',
  'be missing; plan/install them after approval, then build and smoke test.',
].join('\n');

export const SANDBOX_DOCUMENT_TOOLCHAIN_HINT = [
  '',
  'DOCUMENT GENERATION (PDF / Excel / Word / PowerPoint) — IMPORTANT RULES:',
  'Do NOT run `pip install`, `npm install`, or download anything for document',
  'generation — everything below is ALREADY installed. Use the correct stack:',
  '  PDF (.pdf)     ->  HTML/CSS rendered by Puppeteer/Chromium',
  '  Excel (.xlsx)  ->  Node.js require("exceljs")',
  '  Word (.docx)   ->  Node.js require("docx")',
  '  PowerPoint     ->  Python python-pptx (`from pptx import Presentation`)',
  '  Merge/edit an EXISTING PDF  ->  Node.js require("pdf-lib")',
  'If the user asks for a static/printable document and gives no format, make a',
  'PDF by default.',
  '',
  'PDF — render HTML with headless Chromium via Puppeteer (best CSS/layout and',
  'font fidelity). Write editable HTML/CSS sources under `.tmp`, then a',
  '`.tmp/make.cjs` that prints the final PDF into the workspace root. Japanese/',
  'Chinese/Korean text renders correctly with NO font setup (the Noto CJK fonts',
  'are installed and Chromium uses them) — just write normal HTML/CSS.',
  'Chromium runs as root inside the container, so you MUST pass `--no-sandbox`',
  '(and `--disable-dev-shm-usage`). Chromium is found automatically; do not set',
  'executablePath. Copy this shape:',
  '  const puppeteer = require("puppeteer");',
  '  const fs = require("fs");',
  '  (async () => {',
  '    const html = fs.readFileSync(".tmp/doc.html", "utf8");',
  '    const browser = await puppeteer.launch({',
  '      args: ["--no-sandbox", "--disable-dev-shm-usage"],',
  '    });',
  '    const page = await browser.newPage();',
  '    await page.setContent(html, { waitUntil: "networkidle0" });',
  '    await page.pdf({',
  '      path: "output.pdf",',
  '      format: "A4",',
  '      printBackground: true,',
  '      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },',
  '    });',
  '    await browser.close();',
  '  })();',
  '',
  'Excel/Word — write `.tmp/make.cjs` and run it with `node .tmp/make.cjs`;',
  'the final `.xlsx`/`.docx` file must be written into the workspace root.',
  '',
  'Presentation-deck deliverables in any language: unless the user explicitly',
  'asks for browser/HTML slides, create a `.pptx`, not HTML. Put Python/assets',
  'in `.tmp` and write the final `.pptx` to the workspace root.',
  'SLIDES / PRESENTATIONS (python-pptx) — content MUST FIT INSIDE THE SLIDE.',
  'Anything placed past the bottom edge is simply invisible when presenting',
  'fullscreen, so overflow is a real bug, not a cosmetic one. Rules:',
  '- Use 16:9: `prs.slide_width = Inches(13.333)` and',
  '  `prs.slide_height = Inches(7.5)`. EVERY shape must stay within those bounds.',
  '- Give every textbox/shape an explicit box (x, y, w, h) inside a safe margin, and',
  '  keep y + h <= 7.0 (never exceed the 7.5in height). E.g. title at y:0.4 h:1.0,',
  '  one content box at y:1.6 h:5.2, w:12.1, x:0.6.',
  '- Use word wrap and autofit (`MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE`) where text may',
  '  vary; still split content rather than relying on tiny text.',
  '- Budget the content: aim for <= ~6 bullet lines per slide. If there is more,',
  '  SPLIT it across extra slides (repeat the title, adding "(cont.)" or a number',
  '  in the deck language) — do NOT cram one slide.',
  '- Conservative sizes: title ~28-32pt, body ~16-20pt.',
  'Whatever tool you use, the same rule holds: keep every element within the',
  'slide rectangle and prefer more slides over an overcrowded one.',
].join('\n');

export const SANDBOX_COMPACT_DOCUMENT_TOOLCHAIN_HINT = [
  'Documents: use installed libs, no pip/npm install. Sources/assets stay in',
  '`.tmp`; final file in root. Static/printable default is PDF.',
  'PDF: HTML/CSS + `.tmp/make.cjs` + Puppeteer/Chromium with --no-sandbox and',
  '--disable-dev-shm-usage; output root `name.pdf`; CJK fonts work.',
  'xlsx/docx: Node exceljs/docx. pptx: python-pptx. Decks default to root PPTX,',
  'not HTML; use 16:9 bounded boxes, wrap/autofit, add slides over overflow.',
].join('\n');

export const SANDBOX_TOOLCHAIN_HINT = [
  SANDBOX_COMMON_TOOLCHAIN_HINT,
  SANDBOX_DOCUMENT_TOOLCHAIN_HINT,
].join('\n\n');
