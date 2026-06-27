import { describe, expect, it } from 'vitest';
import { urlPath, urlPathWithQuery } from '../urlPath';

describe('urlPath', () => {
  it('builds an absolute path from encoded path segments', () => {
    expect(urlPath('api', 'agent', 'projects', 'project/id')).toBe(
      '/api/agent/projects/project%2Fid'
    );
  });
});

describe('urlPathWithQuery', () => {
  it('appends URLSearchParams encoded query values', () => {
    expect(
      urlPathWithQuery('/api/agent/projects/project-1/files', {
        path: 'src/chart one.png'
      })
    ).toBe('/api/agent/projects/project-1/files?path=src%2Fchart+one.png');
  });
});
