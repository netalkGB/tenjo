import { test, expect } from '@playwright/test';
import { ADMIN_USER_NAME, ADMIN_PASSWORD } from '../setup/constants';
import { login } from '../../helpers/auth';
import path from 'path';
import fs from 'fs';
import os from 'os';

/** Set the Monaco editor content via its API (reliable under load). */
async function setMonacoContent(
  page: import('@playwright/test').Page,
  text: string
) {
  await page.locator('.monaco-editor').waitFor({ state: 'visible' });
  await page.evaluate((value: string) => {
    const editor = (
      window as unknown as {
        monaco: {
          editor: { getEditors: () => { setValue: (v: string) => void }[] };
        };
      }
    ).monaco.editor.getEditors()[0];
    editor.setValue(value);
  }, text);
}

/** Read the Monaco editor content via its API. */
async function getMonacoContent(
  page: import('@playwright/test').Page
): Promise<string> {
  return page.evaluate(() => {
    const editor = (
      window as unknown as {
        monaco: { editor: { getEditors: () => { getValue: () => string }[] } };
      }
    ).monaco.editor.getEditors()[0];
    return editor.getValue();
  });
}

/** Helper: find a knowledge list item by name and return its id. */
async function getEntryIdByName(
  page: import('@playwright/test').Page,
  name: string
): Promise<string> {
  const item = page
    .locator('[data-testid^="knowledge-item-"]')
    .filter({ hasText: name })
    .first();
  const testId = await item.getAttribute('data-testid');
  return testId!.replace('knowledge-item-', '');
}

test.describe
  .serial('knowledge', () => {
    test('create test1, verify in list and chat picker', async ({ page }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      // Navigate to knowledge page
      await page.getByTestId('sidebar-knowledge-button').click();

      // Click New button
      await page.getByTestId('knowledge-new-button').click();

      // Enter name "test1" in the dialog
      await page.getByTestId('knowledge-name-dialog-input').fill('test1');
      await page.getByTestId('knowledge-name-dialog-ok-button').click();

      // Editor opens — type content "test1"
      await expect(
        page.getByTestId('knowledge-editor-save-button')
      ).toBeVisible();
      await setMonacoContent(page, 'test1');

      // Save and wait for list to appear
      await page.getByTestId('knowledge-editor-save-button').click();

      // Verify test1.txt appears in list
      await expect(page.getByText('test1.txt').first()).toBeVisible({
        timeout: 10000
      });

      // Navigate to new chat and verify knowledge picker shows test1
      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      await page.getByTestId('chat-input-knowledge-button').click();
      await expect(
        page
          .locator('[data-testid^="chat-input-knowledge-item-"]')
          .filter({ hasText: 'test1.txt' })
      ).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('create test2.txt, search, delete, edit, verify', async ({ page }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.getByTestId('sidebar-knowledge-button').click();

      // Create test2.txt
      await page.getByTestId('knowledge-new-button').click();
      await page.getByTestId('knowledge-name-dialog-input').fill('test2.txt');
      await page.getByTestId('knowledge-name-dialog-ok-button').click();

      await expect(
        page.getByTestId('knowledge-editor-save-button')
      ).toBeVisible();
      await setMonacoContent(page, 'test2');

      await page.getByTestId('knowledge-editor-save-button').click();

      // Verify test2.txt in list
      await expect(page.getByText('test2.txt').first()).toBeVisible({
        timeout: 10000
      });

      // Search for "test1" — only test1.txt should appear
      await page.getByTestId('knowledge-search-input').fill('test1');
      await expect(page.getByText('test1.txt').first()).toBeVisible({
        timeout: 10000
      });
      // test2.txt should NOT be visible
      await expect(
        page.locator('[data-testid^="knowledge-item-"]').filter({
          hasText: 'test2.txt'
        })
      ).not.toBeVisible();
      // Should be exactly 1 item
      const items = page.locator('[data-testid^="knowledge-item-"]');
      await expect(items).toHaveCount(1);

      // Clear search
      await page.getByTestId('knowledge-search-input').fill('');
      await expect(page.getByText('test2.txt').first()).toBeVisible({
        timeout: 10000
      });

      // Delete test2.txt
      const test2Id = await getEntryIdByName(page, 'test2.txt');
      await page.getByTestId(`knowledge-delete-button-${test2Id}`).click();
      await page.getByTestId('dialog-ok-button').click();

      // Verify test2.txt removed
      await expect(
        page.locator('[data-testid^="knowledge-item-"]').filter({
          hasText: 'test2.txt'
        })
      ).not.toBeVisible();

      // Navigate to new chat — only test1 in picker
      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      await page.getByTestId('chat-input-knowledge-button').click();
      await expect(
        page
          .locator('[data-testid^="chat-input-knowledge-item-"]')
          .filter({ hasText: 'test1.txt' })
      ).toBeVisible();
      // test2.txt should not be in picker
      await expect(
        page
          .locator('[data-testid^="chat-input-knowledge-item-"]')
          .filter({ hasText: 'test2.txt' })
      ).not.toBeVisible();
      await page.keyboard.press('Escape');

      // Go back to knowledge and re-create test2.txt for editing
      await page.getByTestId('sidebar-knowledge-button').click();
      await page.getByTestId('knowledge-new-button').click();
      await page.getByTestId('knowledge-name-dialog-input').fill('test2.txt');
      await page.getByTestId('knowledge-name-dialog-ok-button').click();
      await expect(
        page.getByTestId('knowledge-editor-save-button')
      ).toBeVisible();
      await setMonacoContent(page, 'test2');
      await page.getByTestId('knowledge-editor-save-button').click();
      await expect(page.getByText('test2.txt').first()).toBeVisible({
        timeout: 10000
      });

      // Edit test2.txt — change content to "test22"
      const editId = await getEntryIdByName(page, 'test2.txt');
      await page.getByTestId(`knowledge-edit-button-${editId}`).click();

      // Wait for editor to load with existing content
      await expect(
        page.getByTestId('knowledge-editor-save-button')
      ).toBeVisible();
      await expect(page.locator('.monaco-editor')).toBeVisible();

      // Replace content with "test22"
      await setMonacoContent(page, 'test22');

      // Save
      await page.getByTestId('knowledge-editor-save-button').click();

      // Verify back in list
      await expect(page.getByText('test2.txt').first()).toBeVisible({
        timeout: 10000
      });

      // Open test2.txt again to verify content is "test22"
      const verifyId = await getEntryIdByName(page, 'test2.txt');
      await page.getByTestId(`knowledge-edit-button-${verifyId}`).click();
      await expect(
        page.getByTestId('knowledge-editor-save-button')
      ).toBeVisible();
      await expect(page.locator('.monaco-editor')).toBeVisible();

      // Wait for content to load
      const content = await getMonacoContent(page);
      expect(content).toContain('test22');

      // Cancel to go back
      await page.getByTestId('knowledge-editor-cancel-button').click();
    });

    test('upload file, verify content, then delete', async ({ page }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.getByTestId('sidebar-knowledge-button').click();

      // Create a temporary file
      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, 'test3.txt');
      fs.writeFileSync(tmpFile, 'test3', 'utf-8');

      try {
        // Upload via file input
        const fileInput = page.getByTestId('knowledge-file-input');
        await fileInput.setInputFiles(tmpFile);

        // Confirm upload name dialog
        await expect(
          page.getByTestId('knowledge-upload-name-dialog-input')
        ).toBeVisible();
        // Name should default to "test3.txt"
        await expect(
          page.getByTestId('knowledge-upload-name-dialog-input')
        ).toHaveValue('test3.txt');

        await page
          .getByTestId('knowledge-upload-name-dialog-ok-button')
          .click();

        // Verify test3.txt in list
        await expect(page.getByText('test3.txt').first()).toBeVisible({
          timeout: 10000
        });

        // Open editor and verify content matches
        const entryId = await getEntryIdByName(page, 'test3.txt');
        await page.getByTestId(`knowledge-edit-button-${entryId}`).click();
        await expect(
          page.getByTestId('knowledge-editor-save-button')
        ).toBeVisible();
        await expect(page.locator('.monaco-editor')).toBeVisible();

        await page.waitForTimeout(1000);
        const content = await getMonacoContent(page);
        expect(content).toContain('test3');

        // Cancel editor
        await page.getByTestId('knowledge-editor-cancel-button').click();

        // Delete test3.txt
        const deleteId = await getEntryIdByName(page, 'test3.txt');
        await page.getByTestId(`knowledge-delete-button-${deleteId}`).click();
        await page.getByTestId('dialog-ok-button').click();

        // Verify removed
        await expect(
          page.locator('[data-testid^="knowledge-item-"]').filter({
            hasText: 'test3.txt'
          })
        ).not.toBeVisible();
      } finally {
        // Clean up temporary file
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    });

    test('cleanup: delete remaining test entries', async ({ page }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.getByTestId('sidebar-knowledge-button').click();

      // Delete test1.txt and test2.txt if present
      for (const name of ['test1.txt', 'test2.txt']) {
        const item = page
          .locator('[data-testid^="knowledge-item-"]')
          .filter({ hasText: name });
        if ((await item.count()) > 0) {
          const testId = await item.first().getAttribute('data-testid');
          const id = testId!.replace('knowledge-item-', '');
          await page.getByTestId(`knowledge-delete-button-${id}`).click();
          await page.getByTestId('dialog-ok-button').click();
          await expect(item).not.toBeVisible();
        }
      }
    });
  });
