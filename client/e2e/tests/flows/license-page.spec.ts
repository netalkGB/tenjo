import { test, expect } from '@playwright/test';
import { ADMIN_USER_NAME, ADMIN_PASSWORD } from '../setup/constants';
import { login } from '../../helpers/auth';

test.describe('license page', () => {
  test('admin: open source licenses page loads with content', async ({
    page
  }) => {
    await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

    // Navigate to licenses page
    await page.goto('/settings/licenses');

    // Verify the license content area is visible and has text
    const content = page.getByTestId('settings-licenses-content');
    await expect(content).toBeVisible({ timeout: 10000 });
    await expect(content).not.toBeEmpty();
  });
});
