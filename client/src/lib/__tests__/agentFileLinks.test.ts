import { describe, it, expect } from 'vitest';
import { createAgentFileLinkResolver } from '../agentFileLinks';
import type { AgentFileNode } from '@/components/agent/types';

const TREE: AgentFileNode[] = [
  {
    id: 'report.pdf',
    name: 'report.pdf',
    type: 'file',
    kind: 'pdf',
    updatedAtLabel: ''
  },
  {
    id: '請求書 2026.pdf',
    name: '請求書 2026.pdf',
    type: 'file',
    kind: 'pdf',
    updatedAtLabel: ''
  },
  {
    id: 'speedup_5s.mp4',
    name: 'speedup_5s.mp4',
    type: 'file',
    kind: 'video',
    updatedAtLabel: ''
  },
  {
    id: 'output.custom-video',
    name: 'output.custom-video',
    type: 'file',
    kind: 'text',
    updatedAtLabel: ''
  },
  {
    id: 'src',
    name: 'src',
    type: 'folder',
    updatedAtLabel: '',
    children: [
      {
        id: 'src/index.ts',
        name: 'index.ts',
        type: 'file',
        kind: 'code',
        updatedAtLabel: ''
      },
      {
        id: 'src/chart.png',
        name: 'chart.png',
        type: 'file',
        kind: 'image',
        updatedAtLabel: ''
      },
      {
        id: 'src/nested.pdf',
        name: 'nested.pdf',
        type: 'file',
        kind: 'pdf',
        updatedAtLabel: ''
      },
      {
        id: 'src/dup.pdf',
        name: 'dup.pdf',
        type: 'file',
        kind: 'pdf',
        updatedAtLabel: ''
      }
    ]
  },
  {
    id: 'out',
    name: 'out',
    type: 'folder',
    updatedAtLabel: '',
    children: [
      {
        id: 'out/dup.pdf',
        name: 'dup.pdf',
        type: 'file',
        kind: 'pdf',
        updatedAtLabel: ''
      }
    ]
  }
];

describe('createAgentFileLinkResolver', () => {
  const resolve = createAgentFileLinkResolver('proj-1', TREE);

  it('resolves a root-level deliverable to its download URL', () => {
    expect(resolve('report.pdf')).toEqual({
      url: '/api/agent/projects/proj-1/files?path=report.pdf',
      name: 'report.pdf'
    });
  });

  it('normalizes ./ and leading-/ prefixes', () => {
    expect(resolve('./report.pdf')?.name).toBe('report.pdf');
    expect(resolve('/report.pdf')?.name).toBe('report.pdf');
  });

  it('resolves nested deliverables', () => {
    expect(resolve('src/chart.png')?.url).toBe(
      '/api/agent/projects/proj-1/files?path=src%2Fchart.png'
    );
  });

  it('resolves absolute sandbox paths for existing media files', () => {
    expect(resolve('/workspace/speedup_5s.mp4')).toEqual({
      url: '/api/agent/projects/proj-1/files?path=speedup_5s.mp4',
      name: 'speedup_5s.mp4'
    });
    expect(resolve('/workspace/output.custom-video')).toEqual({
      url: '/api/agent/projects/proj-1/files?path=output.custom-video',
      name: 'output.custom-video'
    });
  });

  it('resolves a unique basename when the answer omits the folder', () => {
    expect(resolve('nested.pdf')).toEqual({
      url: '/api/agent/projects/proj-1/files?path=src%2Fnested.pdf',
      name: 'nested.pdf'
    });
  });

  it('does not guess a basename when multiple files share that name', () => {
    expect(resolve('dup.pdf')).toBeNull();
    expect(resolve('src/dup.pdf')?.url).toBe(
      '/api/agent/projects/proj-1/files?path=src%2Fdup.pdf'
    );
  });

  it('decodes percent-encoded hrefs (non-ASCII filenames)', () => {
    expect(resolve(encodeURI('請求書 2026.pdf'))?.name).toBe('請求書 2026.pdf');
  });

  it('links any file that exists in the file tree', () => {
    expect(resolve('src/index.ts')).toEqual({
      url: '/api/agent/projects/proj-1/files?path=src%2Findex.ts',
      name: 'index.ts'
    });
  });

  it('returns null for paths missing from the tree', () => {
    expect(resolve('missing.pdf')).toBeNull();
  });

  it('returns null for malformed percent-encoding', () => {
    expect(resolve('%E0%A4%A')).toBeNull();
  });

  describe('with an onPreview callback', () => {
    it('exposes onOpen for previewable kinds (PDF)', () => {
      const opened: Array<[string, string, string]> = [];
      const resolveWithPreview = createAgentFileLinkResolver(
        'proj-1',
        TREE,
        (path, name, kind) => opened.push([path, name, kind])
      );
      const link = resolveWithPreview('report.pdf');
      expect(link?.onOpen).toBeDefined();
      link?.onOpen?.();
      expect(opened).toEqual([['report.pdf', 'report.pdf', 'pdf']]);
    });

    it('omits onOpen for non-previewable kinds (image) so they download', () => {
      const resolveWithPreview = createAgentFileLinkResolver(
        'proj-1',
        TREE,
        () => {}
      );
      const link = resolveWithPreview('src/chart.png');
      expect(link).not.toBeNull();
      expect(link?.onOpen).toBeUndefined();
    });
  });
});
