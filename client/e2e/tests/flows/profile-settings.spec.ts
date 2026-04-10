import { test, expect } from '@playwright/test';
import { ADMIN_USER_NAME, ADMIN_PASSWORD } from '../setup/constants';
import { login } from '../../helpers/auth';
import { createUserViaInvitation } from '../../helpers/invitationCode';

const NEW_ADMIN_FULL_NAME = 'admin2';
const NEW_ADMIN_USER_NAME = 'admin2';
const NEW_ADMIN_EMAIL = 'admin2@example.invalid';

const UPDATED_FULL_NAME = 'admin3';
const UPDATED_USER_NAME = 'admin33';
const UPDATED_EMAIL = 'admin33@example.invalid';

test.describe
  .serial('profile settings', () => {
    test('create admin user via invitation code', async ({ page }) => {
      await createUserViaInvitation(
        page,
        { userName: ADMIN_USER_NAME, password: ADMIN_PASSWORD },
        {
          fullName: NEW_ADMIN_FULL_NAME,
          userName: NEW_ADMIN_USER_NAME,
          email: NEW_ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          role: 'admin'
        }
      );
    });

    test('verify new admin profile and update it', async ({ page }) => {
      await login(page, NEW_ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/profile');

      // Verify initial profile values
      await expect(
        page.getByTestId('settings-profile-full-name-input')
      ).toHaveValue(NEW_ADMIN_FULL_NAME);
      await expect(
        page.getByTestId('settings-profile-user-name-input')
      ).toHaveValue(NEW_ADMIN_USER_NAME);
      await expect(
        page.getByTestId('settings-profile-email-input')
      ).toHaveValue(NEW_ADMIN_EMAIL);

      // Update profile
      await page
        .getByTestId('settings-profile-full-name-input')
        .fill(UPDATED_FULL_NAME);
      await page
        .getByTestId('settings-profile-user-name-input')
        .fill(UPDATED_USER_NAME);
      await page
        .getByTestId('settings-profile-email-input')
        .fill(UPDATED_EMAIL);
      await page.getByTestId('settings-profile-save-button').click();

      // Verify success message appears
      await expect(
        page.getByTestId('settings-profile-message').first()
      ).not.toBeEmpty();
    });

    test('verify updated profile persists after re-login', async ({ page }) => {
      await login(page, UPDATED_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/profile');

      await expect(
        page.getByTestId('settings-profile-full-name-input')
      ).toHaveValue(UPDATED_FULL_NAME);
      await expect(
        page.getByTestId('settings-profile-user-name-input')
      ).toHaveValue(UPDATED_USER_NAME);
      await expect(
        page.getByTestId('settings-profile-email-input')
      ).toHaveValue(UPDATED_EMAIL);
    });
  });
