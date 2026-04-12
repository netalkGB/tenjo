import { test, expect } from '@playwright/test';
import { ADMIN_USER_NAME, ADMIN_PASSWORD } from '../setup/constants';
import { login } from '../../helpers/auth';

async function changeLanguage(
  page: import('@playwright/test').Page,
  mode: 'auto' | 'en' | 'ja'
) {
  const trigger = page.getByTestId('settings-general-language-select');
  await trigger.click();
  const option = page.getByTestId(`settings-general-language-option-${mode}`);
  // Wait for the preferences PATCH to complete so the change is persisted
  const preferencesResponse = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/settings/preferences') &&
      resp.request().method() === 'PATCH'
  );
  await option.click({ timeout: 5000 });
  await preferencesResponse;
  // Wait for the dropdown to close (select trigger becomes idle again)
  await expect(trigger).toHaveAttribute('data-state', 'closed');
}

async function logoutAndWait(page: import('@playwright/test').Page) {
  await page.getByTestId('sidebar-user-profile-button').click();
  await page.getByTestId('sidebar-user-signout-menu-item').click();
  await page.getByTestId('dialog-ok-button').click();
  await page.waitForURL(/\/login/);
}

test.describe
  .serial('language settings', () => {
    test('change language to Japanese, verify persistence across reload and re-login', async ({
      page
    }) => {
      // Login as admin and navigate to general settings
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/general');

      // Change language to Japanese
      await changeLanguage(page, 'ja');

      // Verify settings title is in Japanese
      await expect(page.getByTestId('settings-title')).toHaveText('設定');

      // Reload and verify persistence
      await page.reload();
      await expect(page.getByTestId('settings-title')).toHaveText('設定');

      // Re-login and verify language persists
      await logoutAndWait(page);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/general');
      await expect(page.getByTestId('settings-title')).toHaveText('設定');
    });

    test('change language to English, verify persistence across reload and re-login', async ({
      page
    }) => {
      // Login and navigate to settings (still in Japanese from previous test)
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/general');

      // Change language to English
      await changeLanguage(page, 'en');

      // Verify settings title is in English
      await expect(page.getByTestId('settings-title')).toHaveText('Settings');

      // Reload and verify persistence
      await page.reload();
      await expect(page.getByTestId('settings-title')).toHaveText('Settings');

      // Re-login and verify language persists
      await logoutAndWait(page);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/general');
      await expect(page.getByTestId('settings-title')).toHaveText('Settings');
    });

    test('change language back to auto', async ({ page }) => {
      // Login and navigate to settings (in English from previous test)
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/general');

      // Change language to Auto
      await changeLanguage(page, 'auto');

      // Verify the select shows auto label (browser locale determines the language)
      await expect(
        page.getByTestId('settings-general-language-select')
      ).toHaveText(/Auto|自動/);
    });
  });
