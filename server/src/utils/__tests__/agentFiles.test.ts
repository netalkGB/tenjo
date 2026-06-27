import { describe, it, expect } from 'vitest';
import {
  buildFileTree,
  coalesceChanges,
  contentTypeForAgentFile,
  fileKind,
  formatSize,
  isHiddenAgentPath
} from '../agentFiles';
import type { FileSnapshot } from 'tenjo-chat-engine';

describe('agentFiles', () => {
  describe('fileKind', () => {
    it('maps extensions to UI kinds', () => {
      expect(fileKind('index.ts')).toBe('code');
      expect(fileKind('data.json')).toBe('json');
      expect(fileKind('README.md')).toBe('markdown');
      expect(fileKind('report.pdf')).toBe('pdf');
      expect(fileKind('logo.png')).toBe('image');
      expect(fileKind('clip.mp4')).toBe('video');
      expect(fileKind('voice.wav')).toBe('audio');
      expect(fileKind('export.zip')).toBe('archive');
      expect(fileKind('Makefile')).toBe('text');
    });
  });

  describe('contentTypeForAgentFile', () => {
    it('maps PDF and common deliverables to response MIME types', () => {
      expect(contentTypeForAgentFile('report.pdf')).toBe('application/pdf');
      expect(contentTypeForAgentFile('slides.pptx')).toBe(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      );
      expect(contentTypeForAgentFile('chart.png')).toBe('image/png');
      expect(contentTypeForAgentFile('clip.mp4')).toBe('video/mp4');
      expect(contentTypeForAgentFile('voice.wav')).toBe('audio/wav');
      expect(contentTypeForAgentFile('export.zip')).toBe('application/zip');
    });

    it('falls back to octet-stream when the extension is unknown', () => {
      expect(contentTypeForAgentFile('artifact')).toBe(
        'application/octet-stream'
      );
      expect(contentTypeForAgentFile('archive.unknown')).toBe(
        'application/octet-stream'
      );
    });
  });

  describe('isHiddenAgentPath', () => {
    it('hides HOME caches but shows real project dotfiles', () => {
      expect(isHiddenAgentPath('.npm/cache')).toBe(true);
      expect(isHiddenAgentPath('src/.cache/x')).toBe(true);
      expect(isHiddenAgentPath('.tmp/out.pdf')).toBe(true);
      // Real project files — including dotfiles — are shown.
      expect(isHiddenAgentPath('.gitignore')).toBe(false);
      expect(isHiddenAgentPath('.env')).toBe(false);
      expect(isHiddenAgentPath('.github/workflows/ci.yml')).toBe(false);
      expect(isHiddenAgentPath('src/index.ts')).toBe(false);
    });
  });

  describe('formatSize', () => {
    it('formats bytes, KB and MB', () => {
      expect(formatSize(512)).toBe('512 B');
      expect(formatSize(2048)).toBe('2.0 KB');
      expect(formatSize(1536)).toBe('1.5 KB');
      expect(formatSize(48 * 1024)).toBe('48 KB');
    });
  });

  describe('buildFileTree', () => {
    it('builds a sorted tree from a flat snapshot, pruning hidden paths', () => {
      const snapshot: FileSnapshot = new Map([
        ['src/index.ts', { size: 100, mtimeMs: 1 }],
        ['src/game.ts', { size: 200, mtimeMs: 1 }],
        ['README.md', { size: 50, mtimeMs: 1 }],
        ['.npm/cache', { size: 9, mtimeMs: 1 }]
      ]);
      const tree = buildFileTree(snapshot);
      // Folders sort before files; hidden .npm pruned.
      expect(tree.map((n) => n.name)).toEqual(['src', 'README.md']);
      const src = tree[0];
      expect(src.type).toBe('folder');
      expect(src.children?.map((c) => c.name)).toEqual(['game.ts', 'index.ts']);
      expect(src.children?.[0].sizeLabel).toBe('200 B');
    });
  });

  describe('coalesceChanges', () => {
    it('dedupes by path and normalizes directory slashes', () => {
      const result = coalesceChanges([
        { path: 'a.ts', kind: 'created' },
        { path: 'a.ts', kind: 'updated' },
        { path: 'dir/', kind: 'created' },
        { path: '.cache/x', kind: 'updated' }
      ]);
      // created then updated on the same path stays "created"; hidden dropped.
      expect(result).toContainEqual({ path: 'a.ts', kind: 'created' });
      // A bare directory create is dropped — the folder surfaces from the files
      // under it, so emitting it would add a stray file node named like the dir.
      expect(result.some((c) => c.path === 'dir')).toBe(false);
      expect(result.some((c) => c.path.startsWith('.cache'))).toBe(false);
    });
  });
});
