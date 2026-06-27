/**
 * Shared, pure intent classification for the document/scratch workspace.
 *
 * Used by BOTH the host example controller (example/coding-agent-local/
 * workspace.ts) and the sandboxed controller ({@link createSandboxDocumentWorkspace}
 * in sandboxWorkspace.ts), so the CLI and the GUI agent classify prompts with
 * the same language-neutral rules.
 */

import { DEFAULT_WORKSPACE_INTENT_LEXICON } from './workspaceIntentLexicon.js';

export interface DeliverableType {
  /** Lowercased tokens in the prompt that signal this deliverable was asked for. */
  keywords: string[];
  /** Extensions (lowercased, with leading dot) that are the FINAL artifact. */
  extensions: string[];
}

export interface WorkspaceIntentLexicon {
  /** Recognized document deliverables. See {@link matchesKeyword} for the rules. */
  deliverableTypes: DeliverableType[];
  /** Terms that mark the deliverable as code. */
  programIntentKeywords: string[];
  /** Extensions that are always final document artifacts. */
  finalDocumentExtensions: string[];
}

export type ClassifyIntentOptions = {
  lexicon?: WorkspaceIntentLexicon;
};

export const DELIVERABLE_TYPES =
  DEFAULT_WORKSPACE_INTENT_LEXICON.deliverableTypes;

/**
 * Tokens that mark the deliverable as CODE (the program itself is the goal). If
 * any appears, document mode is NOT entered — source files stay visible. Naming a
 * runtime names as the means are intentionally absent.
 */
export const PROGRAM_INTENT_KEYWORDS =
  DEFAULT_WORKSPACE_INTENT_LEXICON.programIntentKeywords;

/**
 * Final artifact extensions that are never source or reusable assets. Their
 * presence in an empty-at-start output dir is a language-neutral signal that the
 * turn produced a document deliverable. Image and data extensions are
 * deliberately excluded because they can also be project assets.
 */
export const FINAL_DOCUMENT_EXTENSIONS =
  DEFAULT_WORKSPACE_INTENT_LEXICON.finalDocumentExtensions;

/** True when every character of `s` is ASCII (char code <= 127). */
function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) {
      return false;
    }
  }
  return true;
}

/**
 * Whether `keyword` occurs in `textLower` (already lowercased). ASCII keywords
 * must sit on a non-alphanumeric boundary so a short token does not match inside
 * a longer token. Non-ASCII keywords use a plain substring test.
 */
export function matchesKeyword(textLower: string, keyword: string): boolean {
  if (!isAscii(keyword)) {
    return textLower.includes(keyword);
  }
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(textLower);
}

export type Intent =
  | { kind: 'program' }
  | { kind: 'document'; extensions: Set<string> }
  | { kind: 'none' };

/** Classify a single prompt's intent. Program intent takes precedence. */
export function classifyIntent(
  text: string,
  options: ClassifyIntentOptions = {}
): Intent {
  const lexicon = options.lexicon ?? DEFAULT_WORKSPACE_INTENT_LEXICON;
  const lower = text.toLowerCase();
  if (lexicon.programIntentKeywords.some((k) => matchesKeyword(lower, k))) {
    return { kind: 'program' };
  }
  const extensions = new Set<string>();
  for (const type of lexicon.deliverableTypes) {
    if (type.keywords.some((k) => matchesKeyword(lower, k))) {
      for (const ext of type.extensions) {
        extensions.add(ext);
      }
    }
  }
  return extensions.size > 0
    ? { kind: 'document', extensions }
    : { kind: 'none' };
}

/**
 * "Empty" = nothing but the scratch dir and dotfiles. Any other visible entry
 * means a real working dir / project, where the controller neither sandboxes into
 * the scratch dir nor flattens a scaffold.
 */
export function isEmptyVisibleDir(
  entries: readonly string[],
  scratchDir: string
): boolean {
  return entries.every((name) => name === scratchDir || name.startsWith('.'));
}
