import { test, expect } from '@playwright/test';
import {
  ADMIN_USER_NAME,
  ADMIN_PASSWORD,
  SETUP_MODEL_NAME,
  SETUP_MODEL_BASE_URL
} from '../setup/constants';
import { login } from '../../helpers/auth';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const THINKING_MODEL_NAME = 'openai/gpt-oss-20b';

/** Select the model in chat input if not already selected. */
async function ensureModelSelected(
  page: import('@playwright/test').Page,
  modelName: string = SETUP_MODEL_NAME
) {
  const modelSelect = page.getByTestId('chat-input-model-select');
  await expect(modelSelect).toBeVisible({ timeout: 10000 });

  const selectText = await modelSelect.textContent();
  if (selectText && selectText.includes(modelName)) return;

  await modelSelect.click();
  const option = page.getByRole('option', {
    name: new RegExp(modelName.replace(/\//g, '\\/'))
  });
  if ((await option.count()) > 0) {
    await option.click();
  } else {
    await page.getByRole('option').first().click();
  }
}

/** Send a chat message and wait for the assistant response to complete. */
async function sendMessage(
  page: import('@playwright/test').Page,
  text: string,
  modelName?: string
) {
  await ensureModelSelected(page, modelName);
  const textarea = page.getByTestId('chat-input-textarea');
  await textarea.fill(text);
  await page.getByTestId('chat-input-send-button').click();

  await expect(page.getByTestId('user-message-content').last()).toBeVisible({
    timeout: 10000
  });

  await expect(page.getByTestId('chat-input-send-button')).toBeVisible({
    timeout: 120_000
  });

  // Verify the assistant returned a non-empty response
  const assistantMsg = page.getByTestId('assistant-message-content').last();
  await expect(assistantMsg).toBeVisible({ timeout: 10000 });
  await expect(assistantMsg).not.toBeEmpty();
}

/** Scroll to the very bottom of the Virtuoso list repeatedly to force lazy items into the DOM. */
async function scrollToBottom(page: import('@playwright/test').Page) {
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      const scroller =
        document.querySelector('[data-testid="virtuoso-scroller"]') ??
        document.querySelector('[data-virtuoso-scroller]');
      scroller?.scrollTo({ top: scroller.scrollHeight });
    });
    await page.waitForTimeout(100);
  }
}

/** Send a chat message and wait for tool call approval to appear. */
async function sendMessageAndWaitForToolApproval(
  page: import('@playwright/test').Page,
  text: string
) {
  await ensureModelSelected(page);
  const textarea = page.getByTestId('chat-input-textarea');
  await textarea.fill(text);
  await page.getByTestId('chat-input-send-button').click();

  await expect(
    page.getByTestId('tool-call-approve-button').first()
  ).toBeVisible({ timeout: 120_000 });
}

/** Get the thread ID from the current URL. */
function getThreadIdFromUrl(page: import('@playwright/test').Page): string {
  const url = new URL(page.url());
  const match = url.pathname.match(/\/chat\/(.+)/);
  return match?.[1] ?? '';
}

test.describe
  .serial('chat', () => {
    // --- Phase 1: first chat — streaming status, stop button ---

    test('first chat: processing and generating title status shown during streaming', async ({
      page
    }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      await ensureModelSelected(page);
      await page
        .getByTestId('chat-input-textarea')
        .fill('Hello, reply with "test-ok".');
      await page.getByTestId('chat-input-send-button').click();

      // During streaming: stop button (square) is shown, send button is hidden
      await expect(page.getByTestId('chat-input-stop-button')).toBeVisible({
        timeout: 10000
      });
      await expect(
        page.getByTestId('chat-input-send-button')
      ).not.toBeVisible();

      // Processing status should appear
      await expect(page.getByTestId('chat-status-processing')).toBeVisible({
        timeout: 10000
      });

      // Wait for generating title status (appears after first response chunk)
      await expect(page.getByTestId('chat-status-generatingTitle')).toBeVisible(
        { timeout: 60_000 }
      );

      // Stop button should still be visible during title generation
      await expect(page.getByTestId('chat-input-stop-button')).toBeVisible();

      // Wait for completion
      await expect(page.getByTestId('chat-input-send-button')).toBeVisible({
        timeout: 120_000
      });

      // Verify response and title was generated
      await expect(page).toHaveURL(/\/chat\/.+/);
      const threadId = getThreadIdFromUrl(page);
      const chatTitle = page.getByTestId('chat-title');
      await expect(chatTitle).toBeVisible();
      await expect(chatTitle).not.toBeEmpty();
      await expect(
        page.getByTestId('assistant-message-content').last()
      ).not.toBeEmpty();

      // Verify in sidebar
      await expect(
        page.getByTestId(`sidebar-history-item-${threadId}`)
      ).toBeVisible({ timeout: 15000 });
    });

    // --- Phase 2: second chat for navigation ---

    test('create second chat', async ({ page }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');
      await sendMessage(page, 'What is 1+1? Answer briefly.');
      await expect(page).toHaveURL(/\/chat\/.+/);
    });

    // --- Phase 3: edit, retry, branch navigation ---

    test('edit message creates new branch, branch navigation works', async ({
      page
    }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      // Open the first chat
      const historyItems = page.locator(
        '[data-testid^="sidebar-history-item-"]:not([data-testid*="menu"])'
      );
      await expect(historyItems.first()).toBeVisible({ timeout: 10000 });
      await historyItems.last().click();
      await expect(page).toHaveURL(/\/chat\/.+/);

      // Hover to show actions, click edit
      await page.getByTestId('user-message-content').first().hover();
      await page.getByTestId('user-message-edit-button').first().click();

      // Edit textarea appears
      const editTextarea = page.getByTestId('user-message-edit-textarea');
      await expect(editTextarea).toBeVisible();

      // Change text and save
      const editedText = 'Edited: say "edit-ok".';
      await editTextarea.fill(editedText);
      await page.getByTestId('user-message-edit-save-button').click();

      // Wait for new response
      await expect(page.getByTestId('chat-input-send-button')).toBeVisible({
        timeout: 120_000
      });
      await expect(
        page.getByTestId('assistant-message-content').last()
      ).not.toBeEmpty();

      // Verify user message content was replaced with the edited text
      await expect(
        page.getByTestId('user-message-content').first()
      ).toContainText(editedText);

      // Branch navigation should show 2/2
      await expect(
        page.getByTestId('user-message-branch-count').first()
      ).toHaveText('2/2');

      // Navigate to previous branch (1/2) — original message is shown
      await page.getByTestId('user-message-branch-prev-button').first().click();
      await expect(
        page.getByTestId('user-message-branch-count').first()
      ).toHaveText('1/2', { timeout: 5000 });
      // Original message should NOT contain the edited text
      await expect(
        page.getByTestId('user-message-content').first()
      ).not.toContainText(editedText);

      // Navigate back to branch 2/2 — edited message is shown
      await page.getByTestId('user-message-branch-next-button').first().click();
      await expect(
        page.getByTestId('user-message-branch-count').first()
      ).toHaveText('2/2', { timeout: 5000 });
      await expect(
        page.getByTestId('user-message-content').first()
      ).toContainText(editedText);
    });

    test('retry user message creates new branch', async ({ page }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      // Open the first chat (should be on branch 2/2 from previous test)
      const historyItems = page.locator(
        '[data-testid^="sidebar-history-item-"]:not([data-testid*="menu"])'
      );
      await expect(historyItems.first()).toBeVisible({ timeout: 10000 });
      await historyItems.last().click();
      await expect(page).toHaveURL(/\/chat\/.+/);

      // Hover to show actions, click retry
      await page.getByTestId('user-message-content').first().hover();
      await page.getByTestId('user-message-retry-button').first().click();

      // Wait for new response
      await expect(page.getByTestId('chat-input-send-button')).toBeVisible({
        timeout: 120_000
      });
      await expect(
        page.getByTestId('assistant-message-content').last()
      ).not.toBeEmpty();

      // Branch count should now be 3/3
      await expect(
        page.getByTestId('user-message-branch-count').first()
      ).toHaveText('3/3');
    });

    // --- Phase 4: sidebar navigation ---

    test('click sidebar history item navigates to chat with messages', async ({
      page
    }) => {
      test.setTimeout(60_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      const historyItems = page.locator(
        '[data-testid^="sidebar-history-item-"]:not([data-testid*="menu"])'
      );
      await expect(historyItems.first()).toBeVisible({ timeout: 10000 });
      expect(await historyItems.count()).toBeGreaterThanOrEqual(2);

      // Click the last (oldest) chat
      await historyItems.last().click();
      await expect(page).toHaveURL(/\/chat\/.+/);

      // Verify messages loaded
      await expect(page.getByTestId('chat-title')).toBeVisible();
      await expect(
        page.getByTestId('user-message-content').first()
      ).toBeVisible();
      await expect(
        page.getByTestId('assistant-message-content').first()
      ).not.toBeEmpty();
    });

    test('continue chat: send follow-up in currently open chat', async ({
      page
    }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      // Open the second chat (no branches)
      const historyItems = page.locator(
        '[data-testid^="sidebar-history-item-"]:not([data-testid*="menu"])'
      );
      await expect(historyItems.first()).toBeVisible({ timeout: 10000 });
      await historyItems.first().click();
      await expect(page).toHaveURL(/\/chat\/.+/);
      const chatUrl = page.url();

      const followUpText = 'e2e-continue: what was my previous message?';

      // Send a follow-up without leaving the page
      await sendMessage(page, followUpText);

      // URL should remain the same chat
      expect(page.url()).toBe(chatUrl);

      // Verify the sent text and response
      // Scroll to the bottom repeatedly so Virtuoso renders all items
      await scrollToBottom(page);
      const lastUserMsg = page.getByTestId('user-message-content').last();
      await lastUserMsg.scrollIntoViewIfNeeded();
      await expect(lastUserMsg).toContainText(followUpText);
      await expect(
        page.getByTestId('assistant-message-content').last()
      ).not.toBeEmpty();
    });

    test('reopen past chat and send follow-up message', async ({ page }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      // Open the second chat (no branches) and note its URL
      const historyItems = page.locator(
        '[data-testid^="sidebar-history-item-"]:not([data-testid*="menu"])'
      );
      await expect(historyItems.first()).toBeVisible({ timeout: 10000 });
      await historyItems.first().click();
      await expect(page).toHaveURL(/\/chat\/.+/);
      const chatUrl = page.url();

      // Navigate away to a new chat
      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      // Reopen the past chat via sidebar
      await expect(historyItems.first()).toBeVisible({ timeout: 10000 });
      await historyItems.first().click();
      await expect(page).toHaveURL(chatUrl);

      // Verify previous messages are loaded
      await expect(
        page.getByTestId('user-message-content').first()
      ).toBeVisible();

      const followUpText = 'e2e-reopen: what did we discuss?';

      // Send a follow-up in the reopened chat
      await sendMessage(page, followUpText);

      // URL should remain the same chat
      expect(page.url()).toBe(chatUrl);

      // Verify the sent text and response
      // Scroll to the bottom repeatedly so Virtuoso renders all items
      await scrollToBottom(page);
      const lastUserMsg = page.getByTestId('user-message-content').last();
      await lastUserMsg.scrollIntoViewIfNeeded();
      await expect(lastUserMsg).toContainText(followUpText);
      await expect(
        page.getByTestId('assistant-message-content').last()
      ).not.toBeEmpty();
    });

    test('reopen past chat after reload and send follow-up message', async ({
      page
    }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      // Open the second chat (no branches) and note its URL
      const historyItems = page.locator(
        '[data-testid^="sidebar-history-item-"]:not([data-testid*="menu"])'
      );
      await expect(historyItems.first()).toBeVisible({ timeout: 10000 });
      await historyItems.first().click();
      await expect(page).toHaveURL(/\/chat\/.+/);
      const chatUrl = page.url();

      // Navigate away by going to / directly
      await page.goto('/');
      await expect(page.getByTestId('sidebar-new-chat-button')).toBeVisible({
        timeout: 15000
      });

      // Reopen the past chat via sidebar
      const freshItems = page.locator(
        '[data-testid^="sidebar-history-item-"]:not([data-testid*="menu"])'
      );
      await expect(freshItems.first()).toBeVisible({ timeout: 10000 });
      await freshItems.first().click();
      await expect(page).toHaveURL(chatUrl);

      // Verify previous messages are loaded
      await expect(
        page.getByTestId('user-message-content').first()
      ).toBeVisible();

      const followUpText = 'e2e-after-reload: summarize this chat.';

      // Send a follow-up in the reopened chat
      await sendMessage(page, followUpText);

      // URL should remain the same chat
      expect(page.url()).toBe(chatUrl);

      // Verify the sent text and response
      // Scroll to the bottom repeatedly so Virtuoso renders all items
      await scrollToBottom(page);
      const lastUserMsg = page.getByTestId('user-message-content').last();
      await lastUserMsg.scrollIntoViewIfNeeded();
      await expect(lastUserMsg).toContainText(followUpText);
      await expect(
        page.getByTestId('assistant-message-content').last()
      ).not.toBeEmpty();
    });

    // --- Phase 5: rename (before search) ---

    test('rename chat via title menu', async ({ page }) => {
      test.setTimeout(60_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      const historyItem = page
        .locator(
          '[data-testid^="sidebar-history-item-"]:not([data-testid*="menu"])'
        )
        .first();
      await expect(historyItem).toBeVisible({ timeout: 10000 });
      await historyItem.click();
      await expect(page).toHaveURL(/\/chat\/.+/);

      await page.getByTestId('chat-title-menu-button').click();
      await page.getByTestId('chat-title-rename-menu-item').click();

      const renameInput = page.getByTestId('rename-dialog-input');
      await expect(renameInput).toBeVisible();
      await renameInput.fill('e2e-renamed-chat');
      await page.getByTestId('rename-dialog-save-button').click();

      await expect(page.getByTestId('chat-title')).toHaveText(
        'e2e-renamed-chat'
      );

      const threadId = getThreadIdFromUrl(page);
      await expect(
        page.getByTestId(`sidebar-history-item-${threadId}`)
      ).toContainText('e2e-renamed-chat');
    });

    // --- Phase 6: history dialog ---

    test('history dialog: search filters results', async ({ page }) => {
      test.setTimeout(60_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      await page.getByTestId('sidebar-history-button').click();
      await expect(page.getByRole('dialog')).toBeVisible();

      const items = page.locator('[data-testid^="history-dialog-item-"]');
      await expect(items.first()).toBeVisible({ timeout: 10000 });
      const totalCount = await items.count();
      expect(totalCount).toBeGreaterThanOrEqual(2);

      // Search for the renamed chat
      await page
        .getByTestId('history-dialog-search-input')
        .fill('e2e-renamed-chat');
      await expect(items).toHaveCount(1, { timeout: 5000 });
      await expect(
        items.first().locator('[data-testid="history-card-title"]')
      ).toHaveText('e2e-renamed-chat');

      // Clear search
      await page.getByTestId('history-dialog-search-input').fill('');
      await expect(items).toHaveCount(totalCount, { timeout: 5000 });

      await page.keyboard.press('Escape');
    });

    test('history dialog: click card navigates to chat', async ({ page }) => {
      test.setTimeout(60_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      const sidebarItems = page.locator(
        '[data-testid^="sidebar-history-item-"]:not([data-testid*="menu"])'
      );
      await expect(sidebarItems.first()).toBeVisible({ timeout: 10000 });
      await sidebarItems.first().click();
      await expect(page).toHaveURL(/\/chat\/.+/);
      const currentThreadId = getThreadIdFromUrl(page);

      await page.getByTestId('sidebar-history-button').click();
      await expect(page.getByRole('dialog')).toBeVisible();

      const items = page.locator('[data-testid^="history-dialog-item-"]');
      await expect(items.first()).toBeVisible({ timeout: 10000 });
      await items.last().click();

      await expect(page.getByRole('dialog')).not.toBeVisible();
      await expect(page).toHaveURL(/\/chat\/.+/);
      expect(getThreadIdFromUrl(page)).not.toBe(currentThreadId);

      await expect(page.getByTestId('chat-title')).toBeVisible();
      await expect(
        page.getByTestId('user-message-content').first()
      ).toBeVisible();
    });

    test('history dialog: pin and unpin', async ({ page }) => {
      test.setTimeout(60_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      await page.getByTestId('sidebar-history-button').click();
      await expect(page.getByRole('dialog')).toBeVisible();

      const items = page.locator('[data-testid^="history-dialog-item-"]');
      await expect(items.first()).toBeVisible({ timeout: 10000 });

      // Pin
      await items
        .first()
        .locator('[data-testid="history-card-pin-button"]')
        .click({ force: true });

      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible();

      // Verify pinned section
      await expect(
        page.getByTestId('sidebar-pinned-button').first()
      ).toBeVisible({ timeout: 10000 });
      const pinnedItems = page.locator(
        '[data-testid^="sidebar-pinned-item-"]:not([data-testid*="menu"])'
      );
      if (!(await pinnedItems.first().isVisible())) {
        await page
          .getByTestId('sidebar-pinned-collapse-button')
          .first()
          .click();
      }
      await expect(pinnedItems.first()).toBeVisible({ timeout: 10000 });

      // Unpin via dialog
      await page.getByTestId('sidebar-history-button').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      const dialogItems = page.locator('[data-testid^="history-dialog-item-"]');
      await expect(dialogItems.first()).toBeVisible({ timeout: 10000 });
      await dialogItems
        .first()
        .locator('[data-testid="history-card-pin-button"]')
        .click({ force: true });

      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible();

      await expect(
        page.getByTestId('sidebar-pinned-button').first()
      ).not.toBeVisible({ timeout: 10000 });
    });

    test('history dialog: rename from dialog', async ({ page }) => {
      test.setTimeout(60_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      await page.getByTestId('sidebar-history-button').click();
      await expect(page.getByRole('dialog')).toBeVisible();

      const items = page.locator('[data-testid^="history-dialog-item-"]');
      await expect(items.first()).toBeVisible({ timeout: 10000 });

      const originalTitle = await items
        .first()
        .locator('[data-testid="history-card-title"]')
        .textContent();

      await items
        .first()
        .locator('[data-testid="history-card-rename-button"]')
        .click({ force: true });

      const renameInput = page.getByTestId('rename-dialog-input');
      await expect(renameInput).toBeVisible();
      await renameInput.fill('dialog-renamed');
      await page.getByTestId('rename-dialog-save-button').click();

      await expect(
        items.first().locator('[data-testid="history-card-title"]')
      ).toHaveText('dialog-renamed', { timeout: 5000 });

      // Rename back
      await items
        .first()
        .locator('[data-testid="history-card-rename-button"]')
        .click({ force: true });
      await expect(renameInput).toBeVisible();
      await renameInput.fill(originalTitle!);
      await page.getByTestId('rename-dialog-save-button').click();

      await page.keyboard.press('Escape');
    });

    test('history dialog: delete from dialog', async ({ page }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      // Create temp chat to delete
      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');
      await sendMessage(page, 'Temporary chat to delete from dialog.');

      await page.getByTestId('sidebar-history-button').click();
      await expect(page.getByRole('dialog')).toBeVisible();

      const items = page.locator('[data-testid^="history-dialog-item-"]');
      await expect(items.first()).toBeVisible({ timeout: 10000 });
      const countBefore = await items.count();

      await items
        .first()
        .locator('[data-testid="history-card-delete-button"]')
        .click({ force: true });

      await page.getByTestId('dialog-ok-button').click();
      await expect(items).toHaveCount(countBefore - 1, { timeout: 10000 });

      await page.keyboard.press('Escape');
    });

    // --- Phase 7: pin via title menu ---

    test('pin chat via title menu, verify, then unpin', async ({ page }) => {
      test.setTimeout(60_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      const historyItem = page
        .locator(
          '[data-testid^="sidebar-history-item-"]:not([data-testid*="menu"])'
        )
        .filter({ hasText: 'e2e-renamed-chat' });
      await expect(historyItem).toBeVisible({ timeout: 10000 });
      await historyItem.click();
      await expect(page).toHaveURL(/\/chat\/.+/);
      const threadId = getThreadIdFromUrl(page);

      await page.getByTestId('chat-title-menu-button').click();
      await page.getByTestId('chat-title-pin-menu-item').click();
      await expect(
        page.getByTestId('chat-title-pin-menu-item')
      ).not.toBeVisible();

      await expect(
        page.getByTestId('sidebar-pinned-button').first()
      ).toBeVisible({ timeout: 10000 });
      const pinnedItem = page
        .getByTestId(`sidebar-pinned-item-${threadId}`)
        .first();
      if (!(await pinnedItem.isVisible())) {
        await page
          .getByTestId('sidebar-pinned-collapse-button')
          .first()
          .click();
      }
      await expect(pinnedItem).toBeVisible({ timeout: 10000 });

      await page.getByTestId('chat-title-menu-button').click();
      await expect(page.getByTestId('chat-title-pin-menu-item')).toBeVisible();
      await page.getByTestId('chat-title-pin-menu-item').click();
      await expect(
        page.getByTestId('chat-title-pin-menu-item')
      ).not.toBeVisible();

      await expect(pinnedItem).not.toBeVisible({ timeout: 10000 });
    });

    // --- Phase 8: image and MCP ---

    test('image upload: send image in chat', async ({ page }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      const imagePath = path.resolve(__dirname, 'files/image.png');
      await page.getByTestId('chat-input-file-input').setInputFiles(imagePath);

      await expect(page.locator('.group img[src^="blob:"]')).toBeVisible({
        timeout: 15000
      });
      await expect(page.getByTestId('chat-input-send-button')).toBeEnabled({
        timeout: 15000
      });

      await ensureModelSelected(page);
      await page
        .getByTestId('chat-input-textarea')
        .fill('What is in this image? Reply briefly.');
      await page.getByTestId('chat-input-send-button').click();

      await expect(page.getByTestId('user-message-content').last()).toBeVisible(
        { timeout: 10000 }
      );
      await expect(page.getByTestId('chat-input-send-button')).toBeVisible({
        timeout: 120_000
      });
      await expect(
        page.getByTestId('assistant-message-content').last()
      ).not.toBeEmpty();
    });

    test('MCP manual approval: tool call requires user approval', async ({
      page
    }) => {
      test.setTimeout(180_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      await sendMessageAndWaitForToolApproval(
        page,
        'Use the list_directory tool to list files in /tmp/. You MUST call the tool.'
      );

      const approveButton = page
        .getByTestId('tool-call-approve-button')
        .first();
      await expect(approveButton).toBeVisible();
      await expect(
        page.getByTestId('tool-call-reject-button').first()
      ).toBeVisible();

      await approveButton.click();

      const sendButton = page.getByTestId('chat-input-send-button');
      const nextApproveButton = page
        .getByTestId('tool-call-approve-button')
        .first();
      while (true) {
        const result = await Promise.race([
          sendButton
            .waitFor({ state: 'visible', timeout: 120_000 })
            .then(() => 'done' as const),
          nextApproveButton
            .waitFor({ state: 'visible', timeout: 120_000 })
            .then(() => 'approve' as const)
        ]);
        if (result === 'done') break;
        await nextApproveButton.click();
      }

      await expect(
        page.getByTestId('assistant-message-content').last()
      ).not.toBeEmpty();
    });

    // --- Phase 9: thinking model ---

    test('thinking model: add gpt-oss-20b, verify thinking block appears', async ({
      page
    }) => {
      test.setTimeout(180_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      // Add thinking model (skip if already exists)
      await page.goto('/settings/models');

      // Wait for model list to load
      await expect(
        page.locator('[data-testid^="settings-model-item-"]').first()
      ).toBeVisible({ timeout: 15000 });

      const existingModel = page
        .locator('[data-testid^="settings-model-item-"]')
        .filter({ hasText: THINKING_MODEL_NAME });
      if ((await existingModel.count()) === 0) {
        await page.getByTestId('settings-model-add-button').click();
        await page
          .getByTestId('settings-model-add-base-url-input')
          .fill(SETUP_MODEL_BASE_URL);
        const manualInput = page.getByTestId(
          'settings-model-add-model-name-input'
        );
        const enterManually = page.getByTestId(
          'settings-model-add-enter-manually-button'
        );
        await manualInput.waitFor({ state: 'hidden', timeout: 15000 });
        await expect(enterManually.or(manualInput)).toBeVisible({
          timeout: 15000
        });
        if (await enterManually.isVisible()) await enterManually.click();
        await manualInput.fill(THINKING_MODEL_NAME);
        await page.getByTestId('settings-model-add-submit-button').click();
      }
      await expect(page.getByText(THINKING_MODEL_NAME).first()).toBeVisible({
        timeout: 10000
      });

      // New chat with thinking model
      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      await ensureModelSelected(page, THINKING_MODEL_NAME);
      await page.getByTestId('chat-input-textarea').fill('Say hello briefly.');
      await page.getByTestId('chat-input-send-button').click();

      // Thinking block should appear during streaming
      await expect(page.getByTestId('thinking-block')).toBeVisible({
        timeout: 30000
      });

      // Wait for completion
      await expect(page.getByTestId('chat-input-send-button')).toBeVisible({
        timeout: 120_000
      });

      // Thinking block should still be visible after completion
      await expect(page.getByTestId('thinking-block')).toBeVisible();

      // Assistant response should not be empty
      await expect(
        page.getByTestId('assistant-message-content').last()
      ).not.toBeEmpty();
    });

    test('cleanup: delete thinking model and chat threads', async ({
      page
    }) => {
      test.setTimeout(60_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      // Delete thinking model
      await page.goto('/settings/models');

      // Wait for model list to load
      await expect(
        page.locator('[data-testid^="settings-model-item-"]').first()
      ).toBeVisible({ timeout: 15000 });

      const modelContainer = page
        .locator('[data-testid^="settings-model-item-"]')
        .filter({ hasText: THINKING_MODEL_NAME });
      if ((await modelContainer.count()) > 0) {
        const testId = await modelContainer.first().getAttribute('data-testid');
        const modelId = testId!.replace('settings-model-item-', '');
        await page
          .getByTestId(`settings-model-delete-button-${modelId}`)
          .click();
        await page.getByTestId('dialog-ok-button').click();
        await expect(modelContainer).not.toBeVisible({ timeout: 10000 });
      }

      // Navigate to home to access sidebar
      await page.getByTestId('sidebar-new-chat-button').click();

      // Delete all test chats
      const historyItems = page.locator(
        '[data-testid^="sidebar-history-item-"]:not([data-testid*="menu"])'
      );
      const count = await historyItems.count();
      for (let i = 0; i < count; i++) {
        const item = historyItems.first();
        if (!(await item.isVisible())) break;
        const testId = await item.getAttribute('data-testid');
        const id = testId!.replace('sidebar-history-item-', '');
        await page
          .getByTestId(`sidebar-history-item-menu-button-${id}`)
          .click({ force: true });
        await page
          .getByTestId(`sidebar-history-item-delete-menu-item-${id}`)
          .click();
        await page.getByTestId('dialog-ok-button').click();
        await expect(
          page.getByTestId(`sidebar-history-item-${id}`)
        ).not.toBeVisible({ timeout: 5000 });
      }
    });
  });
