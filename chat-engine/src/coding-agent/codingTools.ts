import type { Tool } from '../tools/types.js';
import type { Sandbox } from '../sandbox/Sandbox.js';
import type { AgentToolFailure, AgentToolSuccess } from './agentToolResult.js';

/** Default number of lines read_file returns when no limit is given. */
const READ_DEFAULT_LIMIT = 2000;

type ApplyStrReplaceResult =
  AgentToolSuccess<{ content: string }> | AgentToolFailure;

/** Tool names, exported so callers can gate approval per tool (for example on the server). */
export const CODING_TOOL_NAMES = {
  bash: 'bash',
  read_file: 'read_file',
  str_replace: 'str_replace',
  write_file: 'write_file',
} as const;

export const CODING_AGENT_SYSTEM_HINT = [
  'You can read, edit and create files and run shell commands to accomplish',
  'coding tasks, using four tools:',
  '- bash(command): run a shell command; returns stdout, stderr, exit_code.',
  '- read_file(path, offset?, limit?): read a file with line numbers.',
  '- str_replace(path, old, new): exact, unique string replacement in a file.',
  '- write_file(path, content): create or overwrite a file.',
  '',
  'All paths are relative to the working directory. Work in a loop: inspect',
  'relevant existing files first, make changes, then verify (build/lint/test via',
  'bash). For a brand-new scaffold, do not run `ls` only to prove the directory',
  'is empty; start creating the requested files unless the task depends on',
  'pre-existing content. Prefer str_replace for small edits and write_file for',
  'new files.',
  'When you identify a bug or needed change, APPLY it with str_replace or',
  'write_file in the same turn — never answer with only a description of a fix.',
].join('\n');

/**
 * Full coding-agent system prompt. The single source of truth shared by the CLI
 * ({@link runCodingAgentCli}) and any other consumer (for example the server) that wires
 * the four coding tools into a {@link ChatAgent}, so the agent behaves identically
 * everywhere. Covers the ReAct loop, the four tools, document/image generation
 * (incl. non-Latin font handling), and the "apply, don't just describe" rule.
 */
export const CODING_AGENT_SYSTEM_PROMPT = [
  'You are an agent operating in a terminal. You accomplish software tasks',
  'by calling tools rather than by asking the user to do things.',
  '',
  'You have four tools:',
  '- bash(command): run a shell command; returns stdout, stderr, exit_code.',
  '- read_file(path, offset?, limit?): read a file with line numbers.',
  '- str_replace(path, old, new): exact, unique string replacement in a file.',
  '- write_file(path, content): create or overwrite a file.',
  '',
  'All paths are relative to the current working directory. Work in a loop:',
  'inspect relevant existing files first, make changes, then verify them',
  '(build/lint/test via bash). For a brand-new scaffold, do not run `ls` only to',
  'prove the directory is empty; start creating the requested files unless the',
  'task depends on pre-existing content. Prefer str_replace for small edits and',
  'write_file for new files. When the task is complete, reply with a short',
  'summary of what you changed. Do not ask for confirmation — just act.',
  '',
  'Keep your context clean. To check a file exists use `ls`/`test -f`, never',
  '`cat`/read it just to confirm. Never `cat`/read a binary file (image, PDF,',
  'archive, font) into the context — reference it by its path instead. Only read',
  'a file when you genuinely need its contents, and read a window with read_file',
  'offset/limit rather than dumping a large file in full.',
  '',
  'When the user asks for a generated deliverable rather than source code, infer',
  "the intended artifact semantically from the user's wording in any language,",
  'not only from filename extensions. Produce the final file in the working',
  'directory, verify it exists (e.g. with `ls`), and link it in Markdown. For',
  'document/Office/image/video/audio outputs, keep intermediate scripts,',
  'sources, extracted frames, temporary transcodes, and assets in `.tmp`, and put',
  'only the final deliverable at the workspace root. No program will move it for',
  'you after the turn. If the',
  'intended artifact is a presentation deck, create a root `.pptx` by default,',
  'not browser HTML, unless the user explicitly asks for HTML/browser slides.',
  '',
  'If that document/image contains non-Latin text (Japanese, Arabic, Chinese,',
  'Korean, Thai, Hindi, ...), the default font usually lacks those glyphs and they',
  'render as boxes ("tofu") or the build fails. Do not assume a font: first find',
  'one that covers the actual script with `fc-list :lang=<code>` or `fc-match',
  ':lang=<code>` (<code> e.g. ja, ar, zh-cn, ko, th, hi). If none is installed,',
  'install it (e.g. Noto) or download the matching font into the working dir, then',
  'use that font in your tool (register the .ttf by path for reportlab/fpdf2/',
  'PDFKit, set the font path for matplotlib, or use the family name for HTML/CSS,',
  'LibreOffice and pandoc), and verify the output shows real glyphs, not boxes.',
  '',
  'When you scaffold a NEW project or app, create it directly in the current',
  'working directory (e.g. `npm create vite@latest .`), not inside a new named',
  'subdirectory.',
  '',
  'CRITICAL: when you identify a bug or a needed change, you must APPLY it by',
  'calling str_replace or write_file in the same turn. Never answer with only a',
  'description of the fix and stop — a described-but-unapplied change does not',
  'count as done. Edit the file, then summarize.',
].join('\n');

/** Short server/UI prompt for weaker local models. The CLI keeps the full one. */
export const CODING_AGENT_COMPACT_SYSTEM_PROMPT = [
  'You are an agent. Use bash/read_file/str_replace/write_file; never ask the',
  'user to run commands. Paths are workspace-relative.',
  'Loop: inspect, edit/create, verify with build/lint/test or smoke run, then',
  'summarize. New projects go in the current directory, not a wrapper folder.',
  'Infer output type from the request language. Runnable web/native GUI apps',
  'must open in GUI preview. CLI-only apps get a bash smoke test. Documents/files',
  'are linked in Markdown.',
  'Docs: PDF=HTML+Puppeteer, xlsx/docx=Node libs, pptx=python-pptx. Use `.tmp`',
  'for intermediates; final deliverables go in workspace root. Static docs',
  'default to root PDF; decks default to root PPTX unless HTML is explicit.',
  'Never only describe a needed fix; apply it with tools.',
].join('\n');

/**
 * Follow-up instruction appended when a turn ends having described a change
 * without editing any file — pushes the model to actually apply it. Wired into
 * {@link ChatAgent} via `nudgeOnTextOnlyTurn.instruction`. Kept lenient so a turn
 * that genuinely needed no edit can close cleanly.
 */
export const CODING_AGENT_ACT_NUDGE = [
  'You ended your turn without editing any file. If your previous message',
  'was for PLAN MODE and the plan has not been approved yet, do NOT edit;',
  'call present_plan now so the user gets the approval UI. Otherwise, if your',
  'previous message proposed or implied a code change, APPLY it now by calling',
  'str_replace or write_file (then verify with bash). If no file change is',
  'actually needed, reply with a single short line saying so.',
].join('\n');

/**
 * Apply an exact, unique string replacement to file content. Pure helper shared
 * by the str_replace tool: it enforces that `old` occurs exactly once so an edit
 * can never silently hit the wrong (or multiple) sites.
 */
function applyStrReplace(
  content: string,
  oldStr: string,
  newStr: string
): ApplyStrReplaceResult {
  const occurrences = content.split(oldStr).length - 1;
  if (occurrences === 0) {
    return { ok: false, error: '`old` string not found in file' };
  }
  if (occurrences > 1) {
    return {
      ok: false,
      error: `\`old\` string is not unique (found ${occurrences} times) — add more surrounding context`,
    };
  }
  return { ok: true, content: content.replace(oldStr, newStr) };
}

/**
 * Build the four coding tools (bash, read_file, str_replace, write_file) on top
 * of a {@link Sandbox}. The tool definitions are exactly what a model sees and
 * are unchanged across backends; only execution is delegated — so the same tools
 * run on the host (LocalSandbox) or inside an isolated container (DockerSandbox).
 *
 * Replaces the former createFileSystemTools(getCwd): instead of resolving paths
 * against a mutable cwd and honoring host-absolute paths, all file ops are
 * workspace-relative and jailed by the sandbox.
 */
export function createCodingTools(sandbox: Sandbox): Tool[] {
  const bashTool: Tool = {
    definition: {
      type: 'function',
      function: {
        name: CODING_TOOL_NAMES.bash,
        description:
          'Run a shell command from the agent working directory and return its stdout, stderr and exit_code. One tool for everything: ls/cat/grep/find/sed plus git, npm, python and test runners. Pipes and && work. Prefer the dedicated read_file/str_replace/write_file tools for editing files.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The shell command to execute.',
            },
          },
          required: ['command'],
        },
      },
    },
    handler: async (args, context): Promise<ExecResultPayload> => {
      const command = typeof args.command === 'string' ? args.command : '';
      if (!command) {
        return {
          stdout: '',
          stderr: 'Missing argument: command',
          exit_code: 1,
        };
      }
      // Forward the turn's abort signal so stopping the agent kills an
      // in-flight command (build, install, dev server) immediately.
      return sandbox.exec(command, { signal: context?.signal });
    },
  };

  const readFileTool: Tool = {
    definition: {
      type: 'function',
      function: {
        name: CODING_TOOL_NAMES.read_file,
        description:
          'Read a text file and return its contents with 1-based line numbers (like `cat -n`). Use offset/limit to read a window of a large file without flooding the context.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'File path, relative to the agent working directory or absolute.',
            },
            offset: {
              type: 'number',
              description: '1-based line number to start from. Default 1.',
            },
            limit: {
              type: 'number',
              description: `Maximum number of lines to return. Default ${READ_DEFAULT_LIMIT}.`,
            },
          },
          required: ['path'],
        },
      },
    },
    handler: async (args) => {
      const target = typeof args.path === 'string' ? args.path : '';
      if (!target) {
        return { error: 'Missing argument: path' };
      }
      const offset =
        typeof args.offset === 'number' && args.offset > 0
          ? Math.floor(args.offset)
          : 1;
      const limit =
        typeof args.limit === 'number' && args.limit > 0
          ? Math.floor(args.limit)
          : READ_DEFAULT_LIMIT;
      try {
        const { content, totalLines } = await sandbox.readFile(target);
        const lines = content.split('\n');
        const start = offset - 1;
        const slice = lines.slice(start, start + limit);
        const numbered = slice
          .map((line, index) => `${start + index + 1}\t${line}`)
          .join('\n');
        return {
          path: target,
          totalLines,
          shownLines: slice.length,
          content: numbered,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };

  const strReplaceTool: Tool = {
    definition: {
      type: 'function',
      function: {
        name: CODING_TOOL_NAMES.str_replace,
        description:
          'Replace an exact string in a file. `old` must appear exactly once — include enough surrounding context to make it unique, otherwise the edit is rejected.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'File path, relative to the agent working directory or absolute.',
            },
            old: {
              type: 'string',
              description: 'The exact text to replace (must be unique).',
            },
            new: {
              type: 'string',
              description: 'The replacement text.',
            },
          },
          required: ['path', 'old', 'new'],
        },
      },
    },
    handler: async (args) => {
      const target = typeof args.path === 'string' ? args.path : '';
      const oldStr = typeof args.old === 'string' ? args.old : null;
      const newStr = typeof args.new === 'string' ? args.new : null;
      if (!target || oldStr === null || newStr === null) {
        return { error: 'Missing argument: path, old and new are required' };
      }
      if (oldStr === newStr) {
        return { error: '`old` and `new` are identical' };
      }
      try {
        const { content } = await sandbox.readFile(target);
        const replaced = applyStrReplace(content, oldStr, newStr);
        if (!replaced.ok) {
          return { error: replaced.error };
        }
        await sandbox.writeFile(target, replaced.content);
        return { path: target, replaced: true };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };

  const writeFileTool: Tool = {
    definition: {
      type: 'function',
      function: {
        name: CODING_TOOL_NAMES.write_file,
        description:
          'Create a new file or overwrite an existing one with the given content. Parent directories are created automatically.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'File path, relative to the agent working directory or absolute.',
            },
            content: {
              type: 'string',
              description: 'The full file content to write.',
            },
          },
          required: ['path', 'content'],
        },
      },
    },
    handler: async (args) => {
      const target = typeof args.path === 'string' ? args.path : '';
      const content = typeof args.content === 'string' ? args.content : null;
      if (!target || content === null) {
        return { error: 'Missing argument: path and content are required' };
      }
      try {
        const { bytesWritten } = await sandbox.writeFile(target, content);
        return { path: target, bytesWritten };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };

  return [bashTool, readFileTool, strReplaceTool, writeFileTool];
}

/** bash returns the raw {@link ExecResult} shape (stdout/stderr/exit_code). */
interface ExecResultPayload {
  stdout: string;
  stderr: string;
  exit_code: number;
}
