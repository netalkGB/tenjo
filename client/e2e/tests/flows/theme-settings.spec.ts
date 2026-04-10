import { test, expect } from '@playwright/test';
import { ADMIN_USER_NAME, ADMIN_PASSWORD } from '../setup/constants';
import { login } from '../../helpers/auth';

async function changeTheme(
  page: import('@playwright/test').Page,
  mode: 'auto' | 'light' | 'dark'
) {
  await page.getByTestId('settings-general-theme-select').click();
  await page.getByTestId(`settings-general-theme-option-${mode}`).click();
}

async function logoutAndWait(page: import('@playwright/test').Page) {
  await page.getByTestId('sidebar-user-profile-button').click();
  await page.getByTestId('sidebar-user-signout-menu-item').click();
  await page.getByTestId('dialog-ok-button').click();
  await page.waitForURL(/\/login/);
}

test.describe.serial('theme settings', () => {
  test('change theme to dark, verify dark class is applied', async ({
    page
  }) => {
    await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
    await page.goto('/settings/general');

    // Change theme to dark
    await changeTheme(page, 'dark');

    // Verify <html> has "dark" class
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('change theme to light, verify persistence after re-login', async ({
    page
  }) => {
    await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
    await page.goto('/settings/general');

    // Change theme to light
    await changeTheme(page, 'light');

    // Verify <html> does NOT have "dark" class
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    // Re-login and verify light theme persists
    await logoutAndWait(page);
    await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('change theme back to auto', async ({ page }) => {
    await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
    await page.goto('/settings/general');

    // Change theme to auto
    await changeTheme(page, 'auto');

    // Verify the select shows auto value
    await expect(
      page.getByTestId('settings-general-theme-select')
    ).not.toHaveText(/dark|light/i);
  });
});
