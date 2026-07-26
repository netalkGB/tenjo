import type { ToolDefinitionRequest } from '../OpenAIChatApiClient.js';
import { SANDBOX_SKILLS_DIR } from '../sandbox/Sandbox.js';

export const PUNCH_TOOL_NAME = 'punch';

export const PUNCH_TOOL_DEFINITION: ToolDefinitionRequest = {
  type: 'function',
  function: {
    name: PUNCH_TOOL_NAME,
    description:
      'Load a Punch skill by name. Returns SKILL.md instructions and materializes ' +
      `the package under ${SANDBOX_SKILLS_DIR}/<name>/ on the sandbox (outside the ` +
      'workspace). Supporting files stay on disk at that path — read or run them ' +
      'with bash as needed; do not copy them into the workspace. Call when an ' +
      'available skill matches the task. Skills listed in the system prompt are ' +
      'the only ones you may load.',
    parameters: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: 'Name of an enabled Punch skill to load.',
        },
      },
      required: ['skill_name'],
    },
  },
};

/** System-prompt guidance for the punch tool (hosts append skill names after this). */
export const PUNCH_COMPACT_HINT =
  'You have Punch skills. When a listed skill matches the task, call ' +
  `punch(skill_name) to load SKILL.md instructions and materialize the package ` +
  `under ${SANDBOX_SKILLS_DIR}/<name>/ (sandbox filesystem, outside the workspace). ` +
  'Follow the instructions. Load supporting files from that path with bash only ' +
  'when needed (progressive disclosure). Do not copy skill files into the ' +
  'workspace. If the user used /skill-name, that skill is already loaded — do ' +
  'not re-call punch for it.';

export function truncateSkillDescription(
  description: string,
  maxLen = 160
): string {
  const trimmed = description.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

/** Punch skills section for the agent system prompt, or empty when none are enabled. */
export function buildPunchSkillsPromptSection(
  skills: ReadonlyArray<{ name: string; description: string }>
): string {
  if (skills.length === 0) return '';
  const lines = skills.map(
    (s) => `- ${s.name}: ${truncateSkillDescription(s.description)}`
  );
  return [
    PUNCH_COMPACT_HINT,
    'Available skills (slash: /name forces load):',
    ...lines,
  ].join('\n');
}
