import { test, expect } from '@playwright/test';
import {
  ADMIN_USER_NAME,
  ADMIN_PASSWORD,
  NORMAL_USER_NAME,
  NORMAL_PASSWORD
} from '../setup/constants';
import { login } from '../../helpers/auth';

test.describe('cleanup settings', () => {
  test('admin user sees cleanup card on general settings page', async ({
    page
  }) => {
    await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
    await page.goto('/settings/general');

    // Cleanup card should be visible for admin
    await expect(page.getByTestId('settings-cleanup-card')).toBeVisible();
    await expect(page.getByTestId('settings-cleanup-total-size')).toBeVisible();
    await expect(page.getByTestId('settings-cleanup-button')).toBeVisible();
  });

  test('standard user does not see cleanup card', async ({ page }) => {
    await login(page, NORMAL_USER_NAME, NORMAL_PASSWORD);
    await page.goto('/settings/general');

    // Cleanup card should NOT be visible for standard user
    await expect(page.getByTestId('settings-cleanup-card')).not.toBeVisible();
  });
});
