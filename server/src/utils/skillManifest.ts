/** Claude-compatible SKILL.md packages (YAML frontmatter + Markdown body). */

export const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface SkillManifest {
  name: string;
  description: string;
  /** Instructions body after the frontmatter. */
  body: string;
}

export class SkillManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillManifestError';
  }
}

/** Parse simple `key: value` YAML frontmatter and the Markdown body. */
export function parseSkillManifest(content: string): SkillManifest {
  const normalized = content.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new SkillManifestError(
      'SKILL.md must start with YAML frontmatter delimited by ---'
    );
  }

  const frontmatter = match[1];
  const body = match[2].trim();
  const fields = parseSimpleYaml(frontmatter);

  const name = fields.name?.trim();
  const description = fields.description?.trim();

  if (!name) {
    throw new SkillManifestError('SKILL.md frontmatter requires "name"');
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new SkillManifestError(
      'Skill name must be 1–64 chars: lowercase letters, digits, hyphens (no leading/trailing hyphen)'
    );
  }
  if (!description) {
    throw new SkillManifestError('SKILL.md frontmatter requires "description"');
  }
  if (description.length > 2000) {
    throw new SkillManifestError(
      'Skill description must be at most 2000 characters'
    );
  }
  if (!body) {
    throw new SkillManifestError(
      'SKILL.md body (instructions) must not be empty'
    );
  }

  return { name, description, body };
}

function parseSimpleYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Locate SKILL.md in extracted zip paths (root or one nested folder).
 * Returns the package root prefix (`''` or `'folder/'`).
 */
export function findSkillPackageRoot(paths: string[]): string {
  const skillMdPaths = paths.filter(
    (p) => p === 'SKILL.md' || p.endsWith('/SKILL.md')
  );
  if (skillMdPaths.length === 0) {
    throw new SkillManifestError('ZIP must contain a SKILL.md file');
  }
  if (skillMdPaths.includes('SKILL.md')) {
    return '';
  }
  // Prefer the shallowest SKILL.md.
  skillMdPaths.sort((a, b) => a.split('/').length - b.split('/').length);
  const chosen = skillMdPaths[0];
  const slash = chosen.lastIndexOf('/');
  return slash >= 0 ? chosen.slice(0, slash + 1) : '';
}
