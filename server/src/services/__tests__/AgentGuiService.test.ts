import { describe, it, expect, vi } from 'vitest';
import type { Sandbox } from 'tenjo-chat-engine';
import {
  agentGuiService,
  buildWebPreviewUrl,
  parseLocalUrl,
  resolvePreviewCwd
} from '../AgentGuiService';

// Mock logger
vi.mock('../../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

const createSandboxWithManifest = (content: string): Sandbox =>
  ({
    readFile: vi.fn().mockResolvedValue({ content })
  }) as unknown as Sandbox;

const createSandboxWithoutManifest = (): Sandbox =>
  ({
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT'))
  }) as unknown as Sandbox;

const createStaticHtmlSandbox = (listing: string): Sandbox => {
  const exec = vi
    .fn()
    .mockResolvedValueOnce({ exit_code: 0, stdout: listing, stderr: '' })
    .mockResolvedValueOnce({ exit_code: 0, stdout: '8000\n', stderr: '' });
  return {
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    exec,
    writeFile: vi.fn().mockResolvedValue(undefined),
    getWorkspaceDir: () => '/workspace'
  } as unknown as Sandbox;
};

describe('AgentGuiService', () => {
  describe('resolvePreviewCwd', () => {
    it('should keep workspace-absolute cwd values inside the workspace', () => {
      expect(resolvePreviewCwd('/workspace', '/workspace/calculator')).toBe(
        '/workspace/calculator'
      );
      expect(resolvePreviewCwd('/workspaces/p1', '/workspace/calculator')).toBe(
        '/workspaces/p1/calculator'
      );
      expect(resolvePreviewCwd('/workspace', 'workspace/calculator')).toBe(
        '/workspace/calculator'
      );
    });

    it('should resolve relative and generic absolute cwd values under the workspace', () => {
      expect(resolvePreviewCwd('/workspace', 'build')).toBe('/workspace/build');
      expect(resolvePreviewCwd('/workspace', './build')).toBe(
        '/workspace/build'
      );
      expect(resolvePreviewCwd('/workspace', '/tmp/app')).toBe(
        '/workspace/tmp/app'
      );
      expect(resolvePreviewCwd('/workspace')).toBe('/workspace');
    });
  });

  describe('parseLocalUrl', () => {
    it('should parse localhost URLs and rebuild a safe target URL', () => {
      const result = parseLocalUrl(
        'http://localhost:5173/app/page?tab=preview#ignored'
      );

      expect(result).toEqual({
        port: 5173,
        url: 'http://localhost:5173/app/page?tab=preview'
      });
    });

    it('should parse 127.0.0.1 URLs and normalize host to localhost', () => {
      const result = parseLocalUrl('https://127.0.0.1/settings');

      expect(result).toEqual({
        port: 443,
        url: 'https://localhost:443/settings'
      });
    });

    it('should reject non-local and non-http URLs', () => {
      expect(parseLocalUrl('https://example.com:5173')).toBeNull();
      expect(parseLocalUrl('file:///tmp/app.html')).toBeNull();
      expect(parseLocalUrl('not a url')).toBeNull();
    });
  });

  describe('buildWebPreviewUrl', () => {
    it('should open the server root when no path is recorded', () => {
      expect(buildWebPreviewUrl(8080)).toBe('http://localhost:8080/');
      expect(buildWebPreviewUrl(8080, '')).toBe('http://localhost:8080/');
    });

    it('should append and encode recorded static HTML paths', () => {
      expect(buildWebPreviewUrl(8080, 'omikuji.html')).toBe(
        'http://localhost:8080/omikuji.html'
      );
      expect(
        buildWebPreviewUrl(8080, '/nested/demo page.html?mode=1#top')
      ).toBe('http://localhost:8080/nested/demo%20page.html?mode=1');
    });

    it('should keep recorded paths on localhost even when they look absolute', () => {
      expect(buildWebPreviewUrl(8080, 'https://example.com/app.html')).toBe(
        'http://localhost:8080/https://example.com/app.html'
      );
      expect(buildWebPreviewUrl(8080, '//example.com/app.html')).toBe(
        'http://localhost:8080//example.com/app.html'
      );
    });
  });

  describe('previewInfo', () => {
    it('should return unavailable when manifest is missing', async () => {
      const result = await agentGuiService.previewInfo(
        createSandboxWithoutManifest()
      );

      expect(result).toEqual({
        available: false,
        kind: null
      });
    });

    it('should return latest valid web preview entry', async () => {
      const sandbox = createSandboxWithManifest(
        JSON.stringify([
          { port: 3000 },
          { kind: 'unknown', port: 4000, command: 'npm run dev' },
          { port: 5173, command: 'npm run dev' }
        ])
      );

      const result = await agentGuiService.previewInfo(sandbox);

      expect(result).toEqual({
        available: true,
        kind: 'web'
      });
    });

    it('should return latest valid gui preview entry', async () => {
      const sandbox = createSandboxWithManifest(
        JSON.stringify([
          { port: 5173, command: 'npm run dev' },
          { kind: 'gui', command: 'python3 app.py', cwd: 'src' }
        ])
      );

      const result = await agentGuiService.previewInfo(sandbox);

      expect(result).toEqual({
        available: true,
        kind: 'gui'
      });
    });

    it('should ignore invalid manifest content', async () => {
      const result = await agentGuiService.previewInfo(
        createSandboxWithManifest('{ invalid json')
      );

      expect(result).toEqual({
        available: false,
        kind: null
      });
    });
  });

  describe('previewSignature', () => {
    it('should return raw manifest content', async () => {
      const content = JSON.stringify([{ port: 5173, command: 'npm run dev' }]);
      const result = await agentGuiService.previewSignature(
        createSandboxWithManifest(content)
      );

      expect(result).toBe(content);
    });

    it('should return empty string when manifest cannot be read', async () => {
      const result = await agentGuiService.previewSignature(
        createSandboxWithoutManifest()
      );

      expect(result).toBe('');
    });
  });

  describe('ensureStaticHtmlPreview', () => {
    it('should create a static preview manifest for index.html', async () => {
      const sandbox = createStaticHtmlSandbox('index.html\n');

      await expect(
        agentGuiService.ensureStaticHtmlPreview(sandbox)
      ).resolves.toBe(true);

      expect(sandbox.writeFile).toHaveBeenCalledWith(
        '.tenjo/dev-servers.json',
        `${JSON.stringify(
          [
            {
              port: 8000,
              command: 'python3 -m http.server 8000',
              cwd: ''
            }
          ],
          null,
          2
        )}\n`
      );
    });

    it('should record the path when the only static HTML file is not index.html', async () => {
      const sandbox = createStaticHtmlSandbox('omikuji.html\n');

      await expect(
        agentGuiService.ensureStaticHtmlPreview(sandbox)
      ).resolves.toBe(true);

      expect(sandbox.writeFile).toHaveBeenCalledWith(
        '.tenjo/dev-servers.json',
        `${JSON.stringify(
          [
            {
              port: 8000,
              command: 'python3 -m http.server 8000',
              cwd: '',
              path: 'omikuji.html'
            }
          ],
          null,
          2
        )}\n`
      );
    });

    it('should not guess when multiple non-index HTML files exist', async () => {
      const sandbox = createStaticHtmlSandbox('a.html\nb.html\n');

      await expect(
        agentGuiService.ensureStaticHtmlPreview(sandbox)
      ).resolves.toBe(false);

      expect(sandbox.writeFile).not.toHaveBeenCalled();
    });
  });
});
