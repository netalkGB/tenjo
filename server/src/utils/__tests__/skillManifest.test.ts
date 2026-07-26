import { describe, it, expect } from 'vitest';
import {
  parseSkillManifest,
  findSkillPackageRoot,
  SkillManifestError
} from '../skillManifest';

describe('parseSkillManifest', () => {
  it('parses valid frontmatter and body', () => {
    const result = parseSkillManifest(`---
name: my-skill
description: Use when doing X
---

# Hello
Do the thing.
`);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('Use when doing X');
    expect(result.body).toContain('# Hello');
  });

  it('rejects missing frontmatter', () => {
    expect(() => parseSkillManifest('# no frontmatter')).toThrow(
      SkillManifestError
    );
  });

  it('rejects invalid name', () => {
    expect(() =>
      parseSkillManifest(`---
name: Bad_Name
description: x
---
body
`)
    ).toThrow(SkillManifestError);
  });

  it('rejects empty body', () => {
    expect(() =>
      parseSkillManifest(`---
name: ok-skill
description: x
---
`)
    ).toThrow(SkillManifestError);
  });
});

describe('findSkillPackageRoot', () => {
  it('returns empty root when SKILL.md is at top level', () => {
    expect(findSkillPackageRoot(['SKILL.md', 'scripts/a.sh'])).toBe('');
  });

  it('returns folder prefix for nested package', () => {
    expect(
      findSkillPackageRoot(['my-skill/SKILL.md', 'my-skill/scripts/a.sh'])
    ).toBe('my-skill/');
  });

  it('throws when SKILL.md is missing', () => {
    expect(() => findSkillPackageRoot(['readme.md'])).toThrow(
      SkillManifestError
    );
  });
});
