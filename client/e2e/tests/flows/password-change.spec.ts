import { test, expect } from '@playwright/test';
import { ADMIN_USER_NAME, ADMIN_PASSWORD } from '../setup/constants';
import { login } from '../../helpers/auth';
import { createUserViaInvitation } from '../../helpers/invitationCode';

const NEW_PASSWORD = 'N3wP@ssw0rd!';

const ADMIN2_FULL_NAME = 'pwChangeAdmin';
const ADMIN2_USER_NAME = 'pwChangeAdmin';
const ADMIN2_EMAIL = 'pw-change-admin@example.invalid';
const ADMIN2_PASSWORD = 'P@ssw0rd';

const NORMAL2_FULL_NAME = 'pwChangeNormal';
const NORMAL2_USER_NAME = 'pwChangeNormal';
const NORMAL2_EMAIL = 'pw-change-normal@example.invalid';
const NORMAL2_PASSWORD = 'P@ssw0rd';

async function changePassword(
  page: import('@playwright/test').Page,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await page.goto('/settings/profile');
  await page
    .getByTestId('settings-profile-current-password-input')
    .fill(currentPassword);
  await page
    .getByTestId('settings-profile-new-password-input')
    .fill(newPassword);
  await page
    .getByTestId('settings-profile-confirm-password-input')
    .fill(newPassword);

  await page.getByTestId('settings-profile-password-save-button').click();

  // Verify the success message is visible and styled green (not an error)
  const passwordMessage = page
    .getByTestId('settings-profile-message')
    .last()
    .locator('div');
  await expect(passwordMessage).toBeVisible();
  await expect(passwordMessage).toHaveClass(/text-green-600/);
}

async function attemptLoginWithOldPassword(
  page: import('@playwright/test').Page,
  userName: string,
  oldPassword: string
): Promise<void> {
  await page.goto('/login').catch(() => {});
  await page.getByTestId('login-form-id-input').waitFor();
  await page.getByTestId('login-form-id-input').fill(userName);
  await page.getByTestId('login-form-password-input').fill(oldPassword);
  await page.getByTestId('login-form-submit-button').click();

  // Stay on login page — old password must no longer work
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByTestId('sidebar-user-profile-button')
  ).not.toBeVisible();
}

test.describe
  .serial('password change — admin user', () => {
    test('create admin user via invitation code', async ({ page }) => {
      await createUserViaInvitation(
        page,
        { userName: ADMIN_USER_NAME, password: ADMIN_PASSWORD },
        {
          fullName: ADMIN2_FULL_NAME,
          userName: ADMIN2_USER_NAME,
          email: ADMIN2_EMAIL,
          password: ADMIN2_PASSWORD,
          role: 'admin'
        }
      );
    });

    test('login as new admin and change password', async ({ page }) => {
      await login(page, ADMIN2_USER_NAME, ADMIN2_PASSWORD);
      await changePassword(page, ADMIN2_PASSWORD, NEW_PASSWORD);
    });

    test('old password no longer works', async ({ page }) => {
      await attemptLoginWithOldPassword(
        page,
        ADMIN2_USER_NAME,
        ADMIN2_PASSWORD
      );
    });

    test('new password login shows sidebar', async ({ page }) => {
      await login(page, ADMIN2_USER_NAME, NEW_PASSWORD);
      await expect(
        page.getByTestId('sidebar-user-profile-button')
      ).toBeVisible();
    });
  });

test.describe
  .serial('password change — standard user', () => {
    test('create standard user via invitation code', async ({ page }) => {
      await createUserViaInvitation(
        page,
        { userName: ADMIN_USER_NAME, password: ADMIN_PASSWORD },
        {
          fullName: NORMAL2_FULL_NAME,
          userName: NORMAL2_USER_NAME,
          email: NORMAL2_EMAIL,
          password: NORMAL2_PASSWORD
        }
      );
    });

    test('login as standard user and change password', async ({ page }) => {
      await login(page, NORMAL2_USER_NAME, NORMAL2_PASSWORD);
      await changePassword(page, NORMAL2_PASSWORD, NEW_PASSWORD);
    });

    test('old password no longer works', async ({ page }) => {
      await attemptLoginWithOldPassword(
        page,
        NORMAL2_USER_NAME,
        NORMAL2_PASSWORD
      );
    });

    test('new password login shows sidebar', async ({ page }) => {
      await login(page, NORMAL2_USER_NAME, NEW_PASSWORD);
      await expect(
        page.getByTestId('sidebar-user-profile-button')
      ).toBeVisible();
    });
  });
