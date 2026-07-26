import { describe, it, expect } from 'vitest';
import { parsePunchSlashCommand } from '../punchSlash';

describe('parsePunchSlashCommand', () => {
  const names = ['demo-skill', 'other', 'pdf'];

  it('parses a leading slash skill', () => {
    expect(parsePunchSlashCommand('/demo-skill do the thing', names)).toEqual({
      skillName: 'demo-skill'
    });
  });

  it('parses a slash skill mid-prompt (follow-up style)', () => {
    expect(
      parsePunchSlashCommand(
        'please refine using /demo-skill for the layout',
        names
      )
    ).toEqual({ skillName: 'demo-skill' });
  });

  it('parses a slash skill without space before non-latin text', () => {
    expect(
      parsePunchSlashCommand('/pdf please generate the document', names)
    ).toEqual({ skillName: 'pdf' });
  });

  it('returns null for unknown skill', () => {
    expect(parsePunchSlashCommand('/unknown do it', names)).toBeNull();
  });
});
