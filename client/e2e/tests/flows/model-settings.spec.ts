import { test, expect } from '@playwright/test';
import {
  ADMIN_USER_NAME,
  ADMIN_PASSWORD,
  NORMAL_USER_NAME,
  NORMAL_PASSWORD
} from '../setup/constants';
import { login } from '../../helpers/auth';

const MODEL_NAME = 'openai/gpt-oss-20b';
const BASE_URL = 'http://localhost:1234/';

async function logoutAndWait(page: import('@playwright/test').Page) {
  await page.getByTestId('sidebar-user-profile-button').click();
  await page.getByTestId('sidebar-user-signout-menu-item').click();
  await page.getByTestId('dialog-ok-button').click();
  await page.waitForURL(/\/login/);
}

test.describe
  .serial('model settings', () => {
    test('admin: add model via LM Studio, verify in list and chat dropdown, then delete', async ({
      page
    }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      // Navigate to model settings
      await page.goto('/settings/models');

      // Wait for model list to load (at least the setup model should be visible)
      await expect(
        page.locator('[data-testid^="settings-model-item-"]').first()
      ).toBeVisible({ timeout: 15000 });

      // Delete the model if it already exists (e.g. left over from another test)
      const existingModelItem = page
        .locator('[data-testid^="settings-model-item-"]')
        .filter({ hasText: MODEL_NAME });
      if ((await existingModelItem.count()) > 0) {
        const tid = await existingModelItem.first().getAttribute('data-testid');
        const mid = tid!.replace('settings-model-item-', '');
        await page.getByTestId(`settings-model-delete-button-${mid}`).click();
        await page.getByTestId('dialog-ok-button').click();
        await expect(existingModelItem).not.toBeVisible({ timeout: 10000 });
      }

      // Click "Add model" button
      await page.getByTestId('settings-model-add-button').click();

      // Provider defaults to LM Studio, verify it
      await expect(
        page.getByTestId('settings-model-add-provider-select')
      ).toHaveText(/LM Studio/);

      // Enter base URL - triggers model list fetch with 1s debounce
      await page
        .getByTestId('settings-model-add-base-url-input')
        .fill(BASE_URL);

      const combobox = page.getByTestId(
        'settings-model-add-model-name-combobox'
      );
      const enterManually = page.getByTestId(
        'settings-model-add-enter-manually-button'
      );
      const manualInput = page.getByTestId(
        'settings-model-add-model-name-input'
      );

      // Wait for the fetch to start (manual input goes hidden during loading),
      // then wait for fetch to complete (combobox or manual input reappears)
      await manualInput.waitFor({ state: 'hidden', timeout: 15000 });
      await expect(enterManually.or(manualInput)).toBeVisible({
        timeout: 15000
      });

      if (await combobox.isVisible()) {
        await enterManually.click();
      }

      // Enter model name manually
      await manualInput.fill(MODEL_NAME);

      // Submit
      await page.getByTestId('settings-model-add-submit-button').click();

      // Wait for dialog to close and model to appear in the settings list
      await expect(page.getByText(MODEL_NAME).first()).toBeVisible({
        timeout: 10000
      });

      // Navigate to new chat and verify model is in the dropdown
      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      // Open the model select dropdown
      await page.getByTestId('chat-input-model-select').click();

      // Verify our model appears in the dropdown options
      await expect(
        page.getByRole('option', {
          name: new RegExp(MODEL_NAME.replace(/\//g, '\\/'))
        })
      ).toBeVisible();

      // Close dropdown by pressing Escape
      await page.keyboard.press('Escape');

      // Navigate back to model settings and delete the model
      await page.goto('/settings/models');

      // Find the model item and click its delete button
      const modelItem = page.getByText(MODEL_NAME).first();
      await expect(modelItem).toBeVisible();

      // Get the model's delete button from its container
      const modelContainer = modelItem.locator(
        'xpath=ancestor::div[@data-testid]'
      );
      const testId = await modelContainer.getAttribute('data-testid');
      const modelId = testId?.replace('settings-model-item-', '');

      await page.getByTestId(`settings-model-delete-button-${modelId}`).click();

      // Confirm deletion dialog
      await page.getByTestId('dialog-ok-button').click();

      // Verify model is removed from the list
      await expect(page.getByText(MODEL_NAME)).not.toBeVisible();

      // Navigate to new chat and verify model is removed from the dropdown
      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      // The model select should be disabled when no models exist,
      // or the deleted model should not appear in options
      const modelSelect = page.getByTestId('chat-input-model-select');
      await expect(modelSelect).toBeVisible();

      const isDisabled =
        (await modelSelect.getAttribute('disabled')) !== null ||
        (await modelSelect.getAttribute('data-disabled')) !== null;
      if (!isDisabled) {
        // Other models exist - verify ours is not in the list
        await modelSelect.click();
        await expect(
          page.getByRole('option', {
            name: new RegExp(MODEL_NAME.replace(/\//g, '\\/'))
          })
        ).not.toBeVisible();
        await page.keyboard.press('Escape');
      }

      await logoutAndWait(page);
    });

    test('normal user: add model button is not visible', async ({ page }) => {
      await login(page, NORMAL_USER_NAME, NORMAL_PASSWORD);

      // Navigate to model settings
      await page.goto('/settings/models');

      // Verify "Add model" button is NOT visible
      await expect(
        page.getByTestId('settings-model-add-button')
      ).not.toBeVisible();
    });
  });
