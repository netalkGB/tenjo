import { describe, it, expect } from 'vitest';
import { getSlashQueryAtCursor } from '../punchSlash';

describe('getSlashQueryAtCursor', () => {
  it('detects query after slash at start', () => {
    expect(getSlashQueryAtCursor('/dem', 4)).toEqual({
      start: 0,
      query: 'dem'
    });
  });

  it('detects query after slash mid-prompt', () => {
    expect(getSlashQueryAtCursor('use /dem', 8)).toEqual({
      start: 4,
      query: 'dem'
    });
  });

  it('returns null after space-completed token', () => {
    expect(getSlashQueryAtCursor('/demo-skill more', 16)).toBeNull();
  });
});
