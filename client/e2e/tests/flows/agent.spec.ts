import { test, expect, type Page } from '@playwright/test';
import {
  AGENT_ADMIN_USER_NAME,
  AGENT_ADMIN_PASSWORD,
  NORMAL_USER_NAME,
  NORMAL_PASSWORD,
  SETUP_MODEL_NAME
} from '../setup/constants';
import { login } from '../../helpers/auth';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type AgentMode = 'plan' | 'steer';

// Agent turns drive a real local model inside the Docker sandbox, so they are
// far slower than chat turns — give every test a wide budget.
const TURN_TIMEOUT = 240_000;

/** Extract the agent task (project) id from the current /agent/task/:id URL. */
function taskIdFromUrl(page: Page): string {
  const match = new URL(page.url()).pathname.match(/\/agent\/task\/(.+)/);
  return match?.[1] ?? '';
}

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

/** Pick plan / steer in the prompt's mode selector. */
async function setAgentMode(page: Page, mode: AgentMode) {
  await page.getByTestId('agent-prompt-mode-select').click();
  await page.getByTestId(`agent-prompt-mode-${mode}`).click();
}

/**
 * The sandbox MCP server (file-system) runs with manual approval. The coding
 * agent normally uses its own bash/file tools, but if it ever reaches for an MCP
 * tool we approve it so the turn isn't stuck — mirrors chat's approval loop.
 */
async function autoApprovePending(page: Page) {
  const buttons = page.getByTestId('tool-call-approve-button');
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => {});
    }
  }
}

/**
 * Turn OFF every MCP tool in the prompt's tool picker. MCP (for example the file-system
 * server) conflicts with the agent's own sandbox tools, so agent runs should not
 * advertise it. The picker writes the current user's `disabledMcpTools`
 * preference that the agent backend re-reads each turn, so the chat/settings
 * admin keeps MCP tools enabled while the agent test users run with them off.
 */
async function disableAllMcpTools(page: Page) {
  await page.goto('/agent');
  await expect(page.getByTestId('agent-prompt-options-button')).toBeVisible({
    timeout: 15000
  });
  await page.getByTestId('agent-prompt-options-button').click();
  await page.getByTestId('agent-prompt-tools-button').click();

  const toggleAll = page.getByTestId('chat-input-mcp-tools-toggle-all-button');
  // No MCP tools configured at all → nothing to disable.
  if (!(await toggleAll.isVisible({ timeout: 10000 }).catch(() => false))) {
    await page.keyboard.press('Escape').catch(() => {});
    return;
  }
  // "toggle all" flips between select-all (when not all enabled) and
  // deselect-all (when all enabled), so up to two clicks guarantee all-off.
  const checked = page.locator(
    '[data-testid="chat-input-mcp-tools-tool"] [data-state="checked"]'
  );
  for (let i = 0; i < 3; i++) {
    if ((await checked.count()) === 0) break;
    await toggleAll.click();
    await page.waitForTimeout(400);
  }
  await expect(checked).toHaveCount(0, { timeout: 5000 });
  await page.keyboard.press('Escape').catch(() => {});
}

/** Start a brand-new agent task from the home screen; returns its task id. */
async function startAgentTask(
  page: Page,
  prompt: string,
  mode: AgentMode = 'steer'
): Promise<string> {
  await page.goto('/agent');
  await expect(page.getByTestId('agent-prompt-input')).toBeVisible({
    timeout: 15000
  });
  await ensureAgentModelSelected(page);
  await setAgentMode(page, mode);
  await page.getByTestId('agent-prompt-textarea').fill(prompt);
  await page.getByTestId('agent-prompt-submit').click();
  await expect(page).toHaveURL(/\/agent\/task\/.+/, { timeout: 30000 });
  return taskIdFromUrl(page);
}

/** Send a follow-up prompt in the currently-open task. */
async function followUp(page: Page, prompt: string, mode: AgentMode = 'steer') {
  await setAgentMode(page, mode);
  await page.getByTestId('agent-prompt-textarea').fill(prompt);
  await page.getByTestId('agent-prompt-submit').click();
}

/** Wait until no turn is in flight (no stop button, no "processing" line). */
async function waitForSettled(page: Page, timeout = TURN_TIMEOUT) {
  await expect(async () => {
    await autoApprovePending(page);
    expect(
      await page
        .getByTestId('agent-stop')
        .isVisible()
        .catch(() => false)
    ).toBe(false);
    expect(
      await page
        .getByTestId('agent-processing-wait')
        .isVisible()
        .catch(() => false)
    ).toBe(false);
  }).toPass({ timeout, intervals: [2000, 3000, 5000] });
}

/**
 * Wait for a freshly-created task's first turn to fully complete, INCLUDING the
 * asynchronous auto-title generation. Aborting the turn isn't enough — title
 * generation still runs and would clobber a later rename / re-render the title
 * menu mid-interaction, so we let the short turn finish and let the title land.
 */
async function waitForTaskSettled(page: Page) {
  // Make sure the turn actually started (don't return during the pre-turn gap).
  await page
    .getByTestId('assistant-message-content')
    .first()
    .waitFor({ state: 'visible', timeout: TURN_TIMEOUT })
    .catch(() => {});
  await waitForSettled(page);
  // The auto-title is generated asynchronously and replaces the '-' placeholder.
  // Wait until it has landed AND stopped changing, otherwise a late title update
  // would clobber a subsequent rename or re-render the menu mid-interaction.
  const title = page.getByTestId('agent-task-title');
  await expect(async () => {
    const first = (await title.textContent())?.trim() ?? '';
    await page.waitForTimeout(1500);
    const second = (await title.textContent())?.trim() ?? '';
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first).not.toBe('-');
  }).toPass({ timeout: TURN_TIMEOUT });
}

/**
 * Open a dropdown menu and click one of its items, re-opening if a background
 * re-render (for example a late title update) closed it before the click landed.
 */
async function openMenuAndClickItem(
  menu: ReturnType<Page['getByTestId']>,
  item: ReturnType<Page['getByTestId']>
) {
  await expect(async () => {
    if (!(await item.isVisible().catch(() => false))) {
      await menu.click({ force: true }).catch(() => {});
    }
    expect(await item.isVisible().catch(() => false)).toBe(true);
  }).toPass({ timeout: 30_000, intervals: [500, 1000] });
  // force: the sidebar list re-renders after a turn completes, so the menu item
  // can briefly detach; force-clicking avoids waiting forever for "stability".
  await item.click({ force: true });
}

/**
 * Wait for the GUI preview tab to appear (the agent recorded a runnable dev
 * server). Fails fast rather than burning the whole timeout: if the agent goes
 * idle WITHOUT producing a preview, nudge it once to start/open the preview.
 * Returns true once the tab is visible.
 */
async function waitForGuiTab(page: Page, timeoutMs: number): Promise<boolean> {
  const guiTab = page.getByTestId('agent-panel-tab-gui');
  const deadline = Date.now() + timeoutMs;
  let nudged = false;
  while (Date.now() < deadline) {
    await autoApprovePending(page);
    if (await guiTab.isVisible().catch(() => false)) return true;
    const busy =
      (await page
        .getByTestId('agent-stop')
        .isVisible()
        .catch(() => false)) ||
      (await page
        .getByTestId('agent-processing-wait')
        .isVisible()
        .catch(() => false));
    // Idle and still no preview: the (weak) model likely stopped early — nudge
    // it once to actually start the server and open the preview.
    if (!busy && !nudged) {
      nudged = true;
      await followUp(
        page,
        'Start a local web server for the page and open the GUI preview by ' +
          'calling your preview tool.',
        'steer'
      );
    }
    await page.waitForTimeout(4000);
  }
  return false;
}

/** Make sure the right panel is showing the file tree. */
async function openFilesTab(page: Page) {
  const tab = page.getByTestId('agent-panel-tab-files');
  if (await tab.isVisible().catch(() => false)) {
    await tab.click().catch(() => {});
  }
}

/** A locator matching any file-tree node (row, folder or action) by name. */
function fileNodes(page: Page, name: string) {
  return page.locator('[data-testid^="agent-file-"]').filter({ hasText: name });
}

/** Resolve the workspace-relative id of a previewable file by its name. */
async function previewableFileId(page: Page, name: string): Promise<string> {
  const button = page
    .locator('[data-testid^="agent-file-preview-"]')
    .filter({ hasText: name })
    .first();
  const testId = await button.getAttribute('data-testid');
  return (testId ?? '').replace('agent-file-preview-', '');
}

/** Poll (auto-approving) until a file/folder with the given name is shown. */
async function expectFilePresent(
  page: Page,
  name: string,
  timeout = TURN_TIMEOUT
) {
  await openFilesTab(page);
  await expect(async () => {
    await autoApprovePending(page);
    expect(await fileNodes(page, name).count()).toBeGreaterThan(0);
  }).toPass({ timeout, intervals: [3000, 4000, 5000] });
}

/** Poll (auto-approving) until no file/folder with the given name remains. */
async function expectFileAbsent(
  page: Page,
  name: string,
  timeout = TURN_TIMEOUT
) {
  await openFilesTab(page);
  await expect(async () => {
    await autoApprovePending(page);
    expect(await fileNodes(page, name).count()).toBe(0);
  }).toPass({ timeout, intervals: [3000, 4000, 5000] });
}

// Project ids shared across the serial tests so file-manager download/preview
// tests can reuse the workspace built by the CRUD test.
let crudProjectId = '';

test.describe
  .serial('agent', () => {
    // --- Disable MCP for the agent (must run first) ---
    // MCP (for example the file-system server) conflicts with the agent's own sandbox
    // tools, so every agent-admin run below executes with all MCP tools turned
    // off without mutating the chat/settings admin user's tool selection.

    test('disable all MCP tools before the admin agent runs', async ({
      page
    }) => {
      test.setTimeout(60_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);
      await disableAllMcpTools(page);
    });

    // --- File manager: file & folder CRUD reflected in the tree ---

    test('file manager: create, rename, delete files and folders', async ({
      page
    }) => {
      test.setTimeout(900_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);

      crudProjectId = await startAgentTask(
        page,
        'Using bash in the current workspace directory, create two files. ' +
          'File 1 named "hello.html" with the exact content: <h1>Hello E2E</h1>. ' +
          'File 2 named "notes.txt" with the exact content: e2e-notes. ' +
          'Do not create any other files. Then stop.',
        'steer'
      );

      // Create reflected in the tree.
      await expectFilePresent(page, 'hello.html');
      await expectFilePresent(page, 'notes.txt');
      await waitForSettled(page);

      // Rename hello.html -> index.html.
      await followUp(
        page,
        'Using bash, rename the file "hello.html" to "index.html". Do nothing else.'
      );
      await expectFilePresent(page, 'index.html');
      await expectFileAbsent(page, 'hello.html');
      await waitForSettled(page);

      // Delete notes.txt.
      await followUp(
        page,
        'Using bash, delete the file "notes.txt". Do nothing else.'
      );
      await expectFileAbsent(page, 'notes.txt');
      await waitForSettled(page);

      // Create a folder with a file inside it.
      await followUp(
        page,
        'Using bash, create a directory named "docs" and inside it a file ' +
          '"readme.md" containing: e2e-readme. Do nothing else.'
      );
      const docsFolder = page
        .locator('[data-testid^="agent-file-folder-"]')
        .filter({ hasText: 'docs' });
      await expect(docsFolder.first()).toBeVisible({ timeout: TURN_TIMEOUT });
      await expectFilePresent(page, 'readme.md');
      await waitForSettled(page);

      // Delete the folder.
      await followUp(
        page,
        'Using bash, delete the directory "docs" and everything in it. Do nothing else.'
      );
      await expectFileAbsent(page, 'readme.md');
      await expect(
        page
          .locator('[data-testid^="agent-file-folder-"]')
          .filter({ hasText: 'docs' })
      ).toHaveCount(0, { timeout: TURN_TIMEOUT });
    });

    test('queued follow-up stays queued while a tool is running', async ({
      page
    }) => {
      test.setTimeout(420_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);

      await startAgentTask(
        page,
        'Using bash, run this exact command: sleep 20; echo first > first-queued.txt. ' +
          'Do nothing else.',
        'steer'
      );

      await expect(page.getByTestId('agent-stop')).toBeVisible({
        timeout: TURN_TIMEOUT
      });

      const queuedPrompt =
        'Using bash, create a file named second-queued.txt containing second. Do nothing else.';
      await followUp(page, queuedPrompt);

      const queue = page.getByTestId('agent-message-queue');
      await expect(queue).toBeVisible({ timeout: 30_000 });
      await expect(queue).toContainText('second-queued.txt');

      await expectFilePresent(page, 'second-queued.txt', TURN_TIMEOUT);
      await waitForSettled(page);
      await expect(queue).toHaveCount(0);
    });

    // --- File manager: downloads (single file + zip of everything) ---

    test('file manager: download a single file and a zip of all files', async ({
      page
    }) => {
      test.setTimeout(120_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);
      expect(crudProjectId).not.toBe('');

      await page.goto(`/agent/task/${crudProjectId}`);
      await expectFilePresent(page, 'index.html', 60_000);

      // Single-file download via the per-row download button.
      const id = await previewableFileId(page, 'index.html');
      const row = page.getByTestId(`agent-file-${id}`);
      await row.hover();
      const [fileDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId(`agent-file-download-${id}`).click()
      ]);
      expect(fileDownload.suggestedFilename()).toBe('index.html');

      // Zip-of-everything download.
      const [zipDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('agent-download-zip').click()
      ]);
      expect(zipDownload.suggestedFilename()).toMatch(/\.zip$/);
    });

    // --- File manager: text/source preview + download from the preview ---

    test('file manager: preview a text/HTML file and download from preview', async ({
      page
    }) => {
      test.setTimeout(120_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);
      expect(crudProjectId).not.toBe('');

      await page.goto(`/agent/task/${crudProjectId}`);
      await expectFilePresent(page, 'index.html', 60_000);

      const id = await previewableFileId(page, 'index.html');
      await page.getByTestId(`agent-file-preview-${id}`).click();

      // Source/text renders in the syntax-highlighted preview pane.
      await expect(page.getByTestId('agent-file-preview-text')).toBeVisible({
        timeout: 30_000
      });
      await expect(page.getByTestId('agent-file-preview-text')).toContainText(
        'Hello E2E'
      );

      // Download straight from the preview dialog.
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('agent-file-preview-download').click()
      ]);
      expect(download.suggestedFilename()).toBe('index.html');

      await page.keyboard.press('Escape');
    });

    // --- File attachment upload shows in the workspace ---

    test('file manager: attached file is uploaded and shown as a context file', async ({
      page
    }) => {
      test.setTimeout(120_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);

      await page.goto('/agent');
      await expect(page.getByTestId('agent-prompt-input')).toBeVisible({
        timeout: 15000
      });
      await ensureAgentModelSelected(page);

      const imagePath = path.resolve(__dirname, 'files/image.png');
      await page
        .getByTestId('agent-prompt-file-input')
        .setInputFiles(imagePath);

      // The attachment chip appears before sending.
      await expect(
        page.locator('[data-testid^="agent-prompt-file-chip-"]')
      ).toBeVisible({ timeout: 15000 });

      await page
        .getByTestId('agent-prompt-textarea')
        .fill('Describe the attached image briefly.');
      await page.getByTestId('agent-prompt-submit').click();
      await expect(page).toHaveURL(/\/agent\/task\/.+/, { timeout: 30000 });

      // The uploaded file is materialised into the workspace and shown.
      await expectFilePresent(page, 'image.png', 120_000);
    });

    // --- PDF generation: steer (intervention) mode ---

    test('agent makes a PDF in steer mode, it previews and downloads from preview', async ({
      page
    }) => {
      test.setTimeout(600_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);

      await startAgentTask(
        page,
        'Create a one-page PDF file named "report.pdf" in the current workspace ' +
          'directory containing the text "Hello E2E PDF". Generate it however is ' +
          'easiest with the tools available in the sandbox. Do nothing else.',
        'steer'
      );

      await expectFilePresent(page, 'report.pdf', 480_000);
      await waitForSettled(page);

      // PDF opens in the in-browser viewer (iframe).
      const id = await previewableFileId(page, 'report.pdf');
      await page.getByTestId(`agent-file-preview-${id}`).click();
      await expect(page.getByTestId('agent-file-preview-frame')).toBeVisible({
        timeout: 30_000
      });

      // ...and can be downloaded straight from the PDF preview dialog.
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('agent-file-preview-download').click()
      ]);
      expect(download.suggestedFilename()).toBe('report.pdf');

      await page.keyboard.press('Escape');
    });

    // --- PDF generation: plan mode (plan must be approved first) ---

    test('agent makes a PDF in plan mode after approving the plan', async ({
      page
    }) => {
      test.setTimeout(600_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);

      await startAgentTask(
        page,
        'Create a one-page PDF file named "plan-report.pdf" in the current ' +
          'workspace directory containing the text "Plan Mode PDF". Do nothing else.',
        'plan'
      );

      // Plan mode proposes a plan that must be approved before any work runs.
      await expect(page.getByTestId('agent-plan-card')).toBeVisible({
        timeout: TURN_TIMEOUT
      });
      await expect(page.getByTestId('agent-plan-approve')).toBeVisible({
        timeout: TURN_TIMEOUT
      });
      await page.getByTestId('agent-plan-approve').click();

      await expectFilePresent(page, 'plan-report.pdf', 480_000);
    });

    // --- Agent builds something with React (files land in the workspace) ---

    test('agent scaffolds a React app and the source files appear', async ({
      page
    }) => {
      test.setTimeout(600_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);

      await startAgentTask(
        page,
        'Create a minimal React app in the current workspace directory: an ' +
          '"App.jsx" component that renders the text "E2E React", a "main.jsx" ' +
          'entry that mounts it, and an "index.html". Do NOT run npm install or ' +
          'start a dev server — just create the files.',
        'steer'
      );

      // The React source files show up in the file tree.
      await expectFilePresent(page, 'App.jsx', 480_000);
      await expectFilePresent(page, 'index.html');
    });

    // --- Sidebar history: navigate, rename, pin, delete ---

    test('sidebar agent history: navigate, rename, pin and delete', async ({
      page
    }) => {
      test.setTimeout(300_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);

      // A lightweight task is enough; let its short turn finish so the auto-title
      // is stable before we rename.
      const id = await startAgentTask(page, 'Say hi.', 'steer');
      await waitForTaskSettled(page);

      // Back on the agent home the sidebar lists the task.
      await page.goto('/agent');
      const item = page.getByTestId(`sidebar-agent-history-item-${id}`);
      await expect(item).toBeVisible({ timeout: 15000 });

      // Navigate via the sidebar.
      await item.locator('a').first().click();
      await expect(page).toHaveURL(new RegExp(`/agent/task/${id}$`));

      // Rename from the sidebar item menu.
      await page.goto('/agent');
      await openMenuAndClickItem(
        page
          .getByTestId(`sidebar-agent-history-item-menu-button-${id}`)
          .first(),
        page
          .getByTestId(`sidebar-agent-history-item-rename-menu-item-${id}`)
          .first()
      );
      const renameInput = page.getByTestId('rename-dialog-input');
      await expect(renameInput).toBeVisible();
      await renameInput.fill('e2e-agent-renamed');
      await page.getByTestId('rename-dialog-save-button').click();
      await expect(item.first()).toContainText('e2e-agent-renamed', {
        timeout: 10000
      });

      // Pin from the sidebar item menu -> appears in the pinned section.
      await openMenuAndClickItem(
        page
          .getByTestId(`sidebar-agent-history-item-menu-button-${id}`)
          .first(),
        page
          .getByTestId(`sidebar-agent-history-item-pin-menu-item-${id}`)
          .first()
      );
      await expect(page.getByTestId('sidebar-agent-pinned-button')).toBeVisible(
        {
          timeout: 10000
        }
      );

      // Delete from the sidebar item menu.
      await openMenuAndClickItem(
        page
          .getByTestId(`sidebar-agent-history-item-menu-button-${id}`)
          .first(),
        page
          .getByTestId(`sidebar-agent-history-item-delete-menu-item-${id}`)
          .first()
      );
      await page.getByTestId('dialog-ok-button').click();
      await expect(
        page.getByTestId(`sidebar-agent-history-item-${id}`)
      ).toHaveCount(0, { timeout: 10000 });
    });

    // --- Task header menu: rename, pin, delete (delete -> back to /agent) ---

    test('task header: rename, pin and delete returns to agent home', async ({
      page
    }) => {
      test.setTimeout(300_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);

      await startAgentTask(page, 'Say hi.', 'steer');
      await waitForTaskSettled(page);

      const titleMenu = page.getByTestId('agent-task-title-menu-button');

      // Rename from the task title menu.
      await openMenuAndClickItem(
        titleMenu,
        page.getByTestId('agent-task-title-rename-menu-item')
      );
      const renameInput = page.getByTestId('rename-dialog-input');
      await expect(renameInput).toBeVisible();
      await renameInput.fill('e2e-task-renamed');
      await page.getByTestId('rename-dialog-save-button').click();
      await expect(page.getByTestId('agent-task-title')).toContainText(
        'e2e-task-renamed',
        { timeout: 10000 }
      );

      // Pin from the task title menu.
      await openMenuAndClickItem(
        titleMenu,
        page.getByTestId('agent-task-title-pin-menu-item')
      );
      await expect(page.getByTestId('sidebar-agent-pinned-button')).toBeVisible(
        {
          timeout: 10000
        }
      );

      // Delete from the task title menu -> navigates back to /agent.
      await openMenuAndClickItem(
        titleMenu,
        page.getByTestId('agent-task-title-delete-menu-item')
      );
      await page.getByTestId('dialog-ok-button').click();
      await expect(page).toHaveURL(/\/agent$/, { timeout: 15000 });
    });

    // --- Agent history dialog: search, navigate, rename, pin, delete ---

    test('agent history dialog: search, navigate, rename, pin and delete', async ({
      page
    }) => {
      test.setTimeout(300_000);
      await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);

      const id = await startAgentTask(
        page,
        'Say hello for the agent history dialog test.',
        'steer'
      );
      await waitForTaskSettled(page);

      await page.goto('/agent');
      await page.getByTestId('sidebar-agent-history-button').click();
      const item = page.getByTestId(`agent-history-dialog-item-${id}`);
      await expect(item).toBeVisible({ timeout: 15_000 });

      await page
        .getByTestId('agent-history-dialog-search-input')
        .fill('no-match-agent-history-e2e');
      await expect(item).not.toBeVisible({ timeout: 10_000 });

      await page.getByTestId('agent-history-dialog-search-input').fill('');
      await expect(item).toBeVisible({ timeout: 15_000 });

      await item.hover();
      await item.getByTestId('history-card-rename-button').click();
      const renameInput = page.getByTestId('rename-dialog-input');
      await expect(renameInput).toBeVisible();
      await renameInput.fill('e2e-agent-history-dialog');
      await page.getByTestId('rename-dialog-save-button').click();
      await expect(item.getByTestId('history-card-title')).toContainText(
        'e2e-agent-history-dialog',
        { timeout: 10_000 }
      );

      await item.hover();
      await item.getByTestId('history-card-pin-button').click();
      await expect(page.getByTestId('sidebar-agent-pinned-button')).toBeVisible(
        {
          timeout: 10_000
        }
      );

      await item.click();
      await expect(page).toHaveURL(new RegExp(`/agent/task/${id}$`), {
        timeout: 15_000
      });

      await page.getByTestId('sidebar-agent-history-button').click();
      await expect(item).toBeVisible({ timeout: 15_000 });
      await item.hover();
      await item.getByTestId('history-card-delete-button').click();
      await page.getByTestId('dialog-ok-button').click();
      await expect(item).not.toBeVisible({ timeout: 15_000 });
    });

    // --- Standard user: canonical route ---

    test('normal user can create and complete an agent task', async ({
      page
    }) => {
      test.setTimeout(300_000);
      await login(page, NORMAL_USER_NAME, NORMAL_PASSWORD);
      await disableAllMcpTools(page);

      const id = await startAgentTask(page, 'Say hi briefly.', 'steer');
      await waitForTaskSettled(page);

      await page.goto('/agent');
      await expect(
        page.getByTestId(`sidebar-agent-history-item-${id}`)
      ).toBeVisible({ timeout: 15000 });
    });

    // --- GUI preview: stop, restart, expand (steer + plan) ---
    // These are the heaviest, most model-dependent cases (they need the agent to
    // run a dev server AND the sandbox desktop/VNC to boot), so they run LAST:
    // in a serial block a failure here won't skip the reliable tests above.

    for (const mode of ['steer', 'plan'] as const) {
      test(`GUI preview can stop, restart and expand (${mode})`, async ({
        page
      }) => {
        test.setTimeout(900_000);
        await login(page, AGENT_ADMIN_USER_NAME, AGENT_ADMIN_PASSWORD);

        await startAgentTask(
          page,
          'Create a single static web page (index.html showing the text ' +
            '"E2E Web") and start a local web server so it can be previewed in ' +
            'the browser. No build step, no npm — keep it as simple as possible, ' +
            'then open the GUI preview.',
          mode
        );

        if (mode === 'plan') {
          // Plan mode proposes a plan that must be approved before any work runs.
          await expect(page.getByTestId('agent-plan-card')).toBeVisible({
            timeout: TURN_TIMEOUT
          });
          await page.getByTestId('agent-plan-approve').click();
        }

        // The GUI tab appears once a runnable preview is recorded (fail-fast).
        const appeared = await waitForGuiTab(page, 480_000);
        expect(appeared, 'GUI preview tab should appear').toBe(true);
        await page.getByTestId('agent-panel-tab-gui').click();

        // Wait until the preview is running (auto-launch or manual start button).
        const running = page.getByTestId('agent-gui-running');
        const startButton = page.getByTestId('agent-gui-start');
        await expect(async () => {
          await autoApprovePending(page);
          if (await startButton.isVisible().catch(() => false)) {
            await startButton.click().catch(() => {});
          }
          expect(await running.isVisible().catch(() => false)).toBe(true);
        }).toPass({ timeout: 300_000, intervals: [4000, 6000] });

        // Expand (拡大表示) opens the near-fullscreen dialog, then close it.
        await page.getByTestId('agent-gui-expand').click();
        await expect(page.getByTestId('agent-gui-expanded-dialog')).toBeVisible(
          {
            timeout: 15000
          }
        );
        await page.keyboard.press('Escape').catch(() => {});
        await page
          .getByTestId('agent-gui-expanded-dialog')
          .getByRole('button')
          .first()
          .click()
          .catch(() => {});
        await expect(
          page.getByTestId('agent-gui-expanded-dialog')
        ).not.toBeVisible({ timeout: 15000 });

        // Stop the preview, then start it again from the stopped state.
        await page.getByTestId('agent-gui-stop').click();
        await expect(page.getByTestId('agent-gui-start')).toBeVisible({
          timeout: 60_000
        });
        await page.getByTestId('agent-gui-start').click();
        await expect(page.getByTestId('agent-gui-running')).toBeVisible({
          timeout: 300_000
        });
        await page.getByTestId('agent-gui-stop').click();
        await expect(page.getByTestId('agent-gui-start')).toBeVisible({
          timeout: 60_000
        });
      });
    }
  });
