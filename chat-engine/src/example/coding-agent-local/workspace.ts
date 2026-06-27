import * as fs from 'fs';
import * as path from 'path';
import {
  classifyIntent,
  isEmptyVisibleDir,
} from '../../coding-agent/workspaceIntent.js';
import defaultLogger from '../../logger.js';

type WorkspaceMode = 'undecided' | 'code' | 'document';

export interface Workspace {
  getCwd(): string;
  onTurnStart(promptTexts: readonly string[]): void;
  onTurnComplete(): void;
}

export function createWorkspace(options: {
  root: string;
  scratchDir: string;
}): Workspace {
  const { root, scratchDir } = options;
  const scratchPath = path.join(root, scratchDir);
  let mode: WorkspaceMode = 'undecided';
  const deliverableExtensions = new Set<string>();
  let preTurnEntries = new Set<string>();
  let emptyAtTurnStart = false;

  const safeReaddir = (dir: string): string[] => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  };
  const isDirectory = (p: string): boolean => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  const publishDeliverables = (): void => {
    const published: string[] = [];
    for (const name of safeReaddir(scratchPath)) {
      if (!deliverableExtensions.has(path.extname(name).toLowerCase())) {
        continue;
      }
      const src = path.join(scratchPath, name);
      try {
        if (!fs.statSync(src).isFile()) {
          continue;
        }
        fs.copyFileSync(src, path.join(root, name));
        published.push(name);
      } catch {
        // best-effort: skip a file we cannot copy rather than failing the turn
      }
    }
    if (published.length > 0) {
      defaultLogger.info(
        `[published] ${published.length} file(s) to ${root}: ${published.join(', ')}`
      );
    }
  };

  const flattenSingleSubdir = (): void => {
    if (!emptyAtTurnStart) {
      return;
    }
    const created = safeReaddir(root).filter(
      (name) =>
        !preTurnEntries.has(name) &&
        name !== scratchDir &&
        !name.startsWith('.')
    );
    if (created.length !== 1) {
      return;
    }
    const sub = created[0];
    const subPath = path.join(root, sub);
    if (!isDirectory(subPath)) {
      return;
    }
    const contents = safeReaddir(subPath);
    if (contents.length === 0) {
      return;
    }
    if (contents.some((name) => fs.existsSync(path.join(root, name)))) {
      return;
    }
    const moved: string[] = [];
    for (const name of contents) {
      try {
        fs.renameSync(path.join(subPath, name), path.join(root, name));
        moved.push(name);
      } catch {
        // best-effort
      }
    }
    if (moved.length === contents.length) {
      try {
        fs.rmdirSync(subPath);
      } catch {
        // Leave the empty directory if it cannot be removed.
      }
    }
    if (moved.length > 0) {
      defaultLogger.info(
        `[workspace] placed the result directly in ${root} (moved it out of ${sub}/)`
      );
    }
  };

  return {
    getCwd(): string {
      return mode === 'document' ? scratchPath : root;
    },

    onTurnStart(promptTexts): void {
      const entries = safeReaddir(root);
      preTurnEntries = new Set(entries);
      emptyAtTurnStart = isEmptyVisibleDir(entries, scratchDir);
      if (mode === 'code') {
        return;
      }
      const intent = classifyIntent(promptTexts.join('\n'));
      if (intent.kind === 'document') {
        if (mode === 'document' || emptyAtTurnStart) {
          const first = mode !== 'document';
          mode = 'document';
          for (const ext of intent.extensions) {
            deliverableExtensions.add(ext);
          }
          try {
            fs.mkdirSync(scratchPath, { recursive: true });
          } catch {
            // best-effort; the dir is also pre-created at startup
          }
          if (first) {
            defaultLogger.info(
              `[workspace] document mode: building in ${scratchDir}/ (hidden); only the finished file is published to ${root}`
            );
          }
        } else {
          mode = 'code';
        }
        return;
      }
      if (intent.kind === 'program' && mode === 'undecided') {
        mode = 'code';
      }
    },

    onTurnComplete(): void {
      if (mode === 'document') {
        publishDeliverables();
      } else {
        flattenSingleSubdir();
      }
    },
  };
}
