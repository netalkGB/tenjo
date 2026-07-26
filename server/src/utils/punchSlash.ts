// Non-word boundary before `/` so URLs and relative paths are not treated as skills.
const SLASH_SKILL_TOKEN =
  /(?:^|[^\w-])\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)(?=[^\w-]|$)/gi;

/** Find the first enabled Punch slash skill name anywhere in the prompt. */
export function parsePunchSlashCommand(
  prompt: string,
  enabledSkillNames: ReadonlySet<string> | ReadonlyArray<string>
): { skillName: string } | null {
  const names =
    enabledSkillNames instanceof Set
      ? enabledSkillNames
      : new Set(enabledSkillNames);
  if (names.size === 0) return null;

  SLASH_SKILL_TOKEN.lastIndex = 0;
  for (;;) {
    const match = SLASH_SKILL_TOKEN.exec(prompt);
    if (match === null) break;
    const skillName = match[1].toLowerCase();
    if (names.has(skillName)) {
      return { skillName };
    }
  }
  return null;
}
