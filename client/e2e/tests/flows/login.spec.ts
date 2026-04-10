import { test, expect } from '@playwright/test';
import {
  ADMIN_FULL_NAME,
  ADMIN_USER_NAME,
  ADMIN_EMAIL,
  ADMIN_PASSWORD
} from '../setup/constants';
import { login } from '../../helpers/auth';

test.describe
  .serial('login as admin', () => {
    test('login-as-admin', async ({ page }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
    });

    test('check login user name', async ({ page }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      await expect(page.getByTestId('sidebar-user-name')).toHaveText(
        ADMIN_USER_NAME
      );

      await page.goto('/settings/profile');
      await expect(
        page.getByTestId('settings-profile-full-name-input')
      ).toHaveValue(ADMIN_FULL_NAME);
      await expect(
        page.getByTestId('settings-profile-user-name-input')
      ).toHaveValue(ADMIN_USER_NAME);
      await expect(
        page.getByTestId('settings-profile-email-input')
      ).toHaveValue(ADMIN_EMAIL);
    });
  });
