import { test, expect, type Page } from '@playwright/test';
import {
  AGENT_ADMIN_USER_NAME,
  AGENT_ADMIN_PASSWORD,
  SETUP_MODEL_NAME
} from '../setup/constants';
import { login } from '../../helpers/auth';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILL_NAME = 'e2e-punch';
const SKILL_ZIP = path.resolve(__dirname, 'files/e2e-punch-skill.zip');

// Slash force-load runs immediately; model-chosen punch waits on a real LLM turn.
const SLASH_PUNCH_TIMEOUT = 120_000;
const MODEL_PUNCH_TIMEOUT = 240_000;

/** Ensure the agent prompt input has the setup model selected. */
async function ensureAgentModelSelected(page: Page) {
  const select = page.getByTestId('agent-prompt-model-select');
  await expect(select).toBeVisible({ timeout: 15000 });
  const text = await select.textContent();
  if (text && text.includes(SETUP_MODEL_NAME)) return;

  await select.click();
  const option = page.getByRole('option', {
    name: new RegExp(SETUP_MODEL_NAME.replace(/\//g, '\\/'))
  });
  if ((await option.count()) > 0) {
    await option.first().click();
  } else {
    await page.getByRole('option').first().click();
  }
}

/** Delete the skill if a previous retry left it behind. */
async function ensureSkillAbsent(page: Page) {
  await page.goto('/punch');
  await expect(page.getByTestId('punch-import-button')).toBeVisible({
    timeout: 15000
  });
  const skill = page.getByTestId(`punch-skill-${SKILL_NAME}`);
  if (await skill.isVisible().catch(() => false)) {
    await page.getByTestId(`punch-skill-delete-${SKILL_NAME}`).click();
    await page.getByTestId('dialog-ok-button').click();
    await expect(skill).toHaveCount(0, { timeout: 15000 });
  }
}

/** Import the fixture skill ZIP and wait until it appears in the list. */
async function importSkill(page: Page) {
  await page.goto('/punch');
  await expect(page.getByTestId('punch-import-button')).toBeVisible({
    timeout: 15000
  });
  await page.getByTestId('punch-file-input').setInputFiles(SKILL_ZIP);
  await expect(page.getByTestId(`punch-skill-${SKILL_NAME}`)).toBeVisible({
    timeout: 15000
  });
  // Imported skills are enabled by default.
  await expect(
    page.getByTestId(`punch-skill-toggle-${SKILL_NAME}`)
  ).toBeChecked();
}

/** Ensure the fixture skill is imported and enabled (idempotent). */
async function ensureSkillPresent(page: Page) {
  await page.goto('/punch');
  await expect(page.getByTestId('punch-import-button')).toBeVisible({
    timeout: 15000
  });
  const skill = page.getByTestId(`punch-skill-${SKILL_NAME}`);
  if (await skill.isVisible().catch(() => false)) {
    const toggle = page.getByTestId(`punch-skill-toggle-${SKILL_NAME}`);
    if (!(await toggle.isChecked())) {
      await toggle.check();
      await expect(toggle).toBeChecked();
    }
    return;
  }
  await importSkill(page);
}

/** Start a brand-new agent task from the home screen. */
async function startAgentTask(page: Page, prompt: string) {
  await page.goto('/agent');
  await expect(page.getByTestId('agent-prompt-input')).toBeVisible({
    timeout: 15000
  });
  await ensureAgentModelSelected(page);
  await page.getByTestId('agent-prompt-textarea').fill(prompt);
  await page.getByTestId('agent-prompt-submit').click();
  await expect(page).toHaveURL(/\/agent\/task\/.+/, { timeout: 30000 });
}

/** Send a follow-up prompt in the currently-open task. */
async function followUp(page: Page, prompt: string) {
  await page.getByTestId('agent-prompt-textarea').fill(prompt);
  await page.getByTestId('agent-prompt-submit').click();
}

/**
 * Wait for the punch tool card. If the model finishes a turn without calling
 * punch, nudge once — local models sometimes answer in prose first.
 */
async function waitForPunchMark(page: Page, timeoutMs: number) {
  const punchMark = page.getByTestId('agent-tool-call-punch');
  const deadline = Date.now() + timeoutMs;
  let nudged = false;

  while (Date.now() < deadline) {
    if (await punchMark.isVisible().catch(() => false)) {
      return punchMark;
    }

    const busy =
      (await page
        .getByTestId('agent-stop')
        .isVisible()
        .catch(() => false)) ||
      (await page
        .getByTestId('agent-processing-wait')
        .isVisible()
        .catch(() => false));

    if (!busy && !nudged) {
      nudged = true;
      await followUp(
        page,
        // No leading slash — must be a real model-initiated punch tool call.
        `You have not called the punch tool yet. Call the punch tool with ` +
          `skill_name "${SKILL_NAME}" as your next action. Do nothing else first.`
      );
    }

    await page.waitForTimeout(3000);
  }

  await expect(punchMark).toBeVisible({ timeout: 1000 });
  return punchMark;
}

test.describe
  .serial('punch', () => {
    test('import skill, slash-force punch shows activation mark', async ({
      page
    }) => {
      test.setTimeout(180_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);

      await ensureSkillAbsent(page);
      await importSkill(page);

      // Slash autocomplete lists the enabled skill.
      await page.goto('/agent');
      await expect(page.getByTestId('agent-prompt-input')).toBeVisible({
        timeout: 15000
      });
      await ensureAgentModelSelected(page);

      const textarea = page.getByTestId('agent-prompt-textarea');
      await textarea.click();
      await textarea.fill('/');
      await expect(page.getByTestId('agent-punch-slash-menu')).toBeVisible({
        timeout: 10000
      });
      await expect(
        page.getByTestId(`agent-punch-slash-item-${SKILL_NAME}`)
      ).toBeVisible();

      // Slash-prefixed prompt — server force-loads punch (no model decision).
      await textarea.fill(
        `/${SKILL_NAME} Reply with a short greeting and stop.`
      );
      await page.getByTestId('agent-prompt-submit').click();
      await expect(page).toHaveURL(/\/agent\/task\/.+/, { timeout: 30000 });

      const punchMark = page.getByTestId('agent-tool-call-punch');
      await expect(punchMark).toBeVisible({ timeout: SLASH_PUNCH_TIMEOUT });
      await expect(punchMark).toContainText(SKILL_NAME);
    });

    test('model-initiated punch (no slash) shows activation mark', async ({
      page
    }) => {
      // Depends on the local model choosing the punch tool; allow a full turn
      // budget plus one nudge, with project-level retries for flaky models.
      test.setTimeout(300_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);

      await ensureSkillPresent(page);

      // Strong instruction, but never use "/e2e-punch" so slash force-load
      // cannot short-circuit the model path.
      await startAgentTask(
        page,
        `Use the Punch skills available to you. Your first action MUST be ` +
          `calling the punch tool with skill_name "${SKILL_NAME}" to load that ` +
          `skill. Do not answer in prose before calling punch. After the tool ` +
          `returns, reply briefly and stop.`
      );

      const punchMark = await waitForPunchMark(page, MODEL_PUNCH_TIMEOUT);
      await expect(punchMark).toContainText(SKILL_NAME);
    });
  });
