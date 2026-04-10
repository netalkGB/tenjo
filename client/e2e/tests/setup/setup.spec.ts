import { test, expect } from '@playwright/test';
import {
  ADMIN_FULL_NAME,
  ADMIN_USER_NAME,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  NORMAL_FULL_NAME,
  NORMAL_USER_NAME,
  NORMAL_EMAIL,
  NORMAL_PASSWORD,
  SETUP_MODEL_NAME,
  SETUP_MODEL_BASE_URL,
  SETUP_MCP_SERVER_NAME,
  SETUP_MCP_COMMAND,
  SETUP_MCP_ARGS
} from './constants';
import { createUserViaInvitation } from '../../helpers/invitationCode';
import { login } from '../../helpers/auth';

test.describe
  .serial('setup', () => {
    test('create admin user', async ({ page }) => {
      await page.goto('/login?redirect=%2F');
      await page.getByTestId('login-form-register-link').click();

      // First user registration should not require invitation code
      await expect(
        page.getByTestId('register-invitation-code-input')
      ).not.toBeVisible();

      await page.getByTestId('register-full-name-input').click();
      await page.getByTestId('register-full-name-input').fill(ADMIN_FULL_NAME);
      await page.getByTestId('register-full-name-input').press('Tab');
      await page.getByTestId('register-user-name-input').fill(ADMIN_USER_NAME);
      await page.getByTestId('register-user-name-input').press('Tab');
      await page.getByTestId('register-email-input').fill(ADMIN_EMAIL);
      await page.getByTestId('register-email-input').press('Tab');
      await page.getByTestId('register-password-input').fill(ADMIN_PASSWORD);
      await page.getByTestId('register-password-input').press('Tab');
      await page
        .getByTestId('register-password-confirm-input')
        .fill(ADMIN_PASSWORD);
      await page.getByTestId('register-password-confirm-input').press('Tab');
      await page.getByTestId('register-submit-button').click();
    });

    test('create normal user', async ({ page }) => {
      await createUserViaInvitation(
        page,
        { userName: ADMIN_USER_NAME, password: ADMIN_PASSWORD },
        {
          fullName: NORMAL_FULL_NAME,
          userName: NORMAL_USER_NAME,
          email: NORMAL_EMAIL,
          password: NORMAL_PASSWORD
        }
      );
    });

    test('add LM Studio model', async ({ page }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/models');

      await page.getByTestId('settings-model-add-button').click();

      // Provider defaults to LM Studio
      await page
        .getByTestId('settings-model-add-base-url-input')
        .fill(SETUP_MODEL_BASE_URL);

      // Wait for the fetch to start (manual input goes hidden during loading),
      // then wait for fetch to complete (combobox or manual input reappears)
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

      if (await enterManually.isVisible()) {
        await enterManually.click();
      }

      // Enter model name manually
      await manualInput.fill(SETUP_MODEL_NAME);

      // Submit
      await page.getByTestId('settings-model-add-submit-button').click();

      // Verify model appears in the list
      await expect(page.getByText(SETUP_MODEL_NAME).first()).toBeVisible();
    });

    test('add MCP server', async ({ page }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/tools-mcp');

      await page.getByTestId('settings-mcp-add-server-button').click();
      await page
        .getByTestId('settings-mcp-dialog-name-input')
        .fill(SETUP_MCP_SERVER_NAME);
      await page
        .getByTestId('settings-mcp-dialog-command-input')
        .fill(SETUP_MCP_COMMAND);
      for (const arg of SETUP_MCP_ARGS) {
        await page
          .getByTestId('settings-mcp-dialog-string-list-add-button')
          .click();
        await page
          .getByTestId('settings-mcp-dialog-string-list-input')
          .last()
          .fill(arg);
      }
      await page.getByTestId('settings-mcp-dialog-save-button').click();

      // Verify server and tools appear
      await expect(
        page
          .getByTestId('settings-mcp-server-item')
          .filter({ hasText: SETUP_MCP_SERVER_NAME })
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page
          .getByTestId('settings-mcp-tool-approval-server')
          .filter({ hasText: SETUP_MCP_SERVER_NAME })
      ).toBeVisible({ timeout: 30000 });
    });
  });
