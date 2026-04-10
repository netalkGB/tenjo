import { test, expect } from '@playwright/test';
import {
  ADMIN_USER_NAME,
  ADMIN_PASSWORD,
  ADMIN_FULL_NAME,
  ADMIN_EMAIL,
  NORMAL_USER_NAME,
  NORMAL_FULL_NAME,
  NORMAL_EMAIL
} from '../setup/constants';
import { login } from '../../helpers/auth';
import { createUserViaInvitation } from '../../helpers/invitationCode';

const TEST_USER_FULL_NAME = 'inviteTest';
const TEST_USER_NAME = 'inviteTestUser';
const TEST_USER_EMAIL = 'invite-test@example.invalid';
const TEST_USER_PASSWORD = 'P@ssw0rd';

const ADMIN_INVITE_USER_FULL_NAME = 'adminInviteTest';
const ADMIN_INVITE_USER_NAME = 'adminInviteTestUser';
const ADMIN_INVITE_USER_EMAIL = 'admin-invite-test@example.invalid';
const ADMIN_INVITE_USER_PASSWORD = 'P@ssw0rd';

test.describe
  .serial('invitation code', () => {
    test('used invitation code shows used badge', async ({ page }) => {
      const { codeId } = await createUserViaInvitation(
        page,
        { userName: ADMIN_USER_NAME, password: ADMIN_PASSWORD },
        {
          fullName: TEST_USER_FULL_NAME,
          userName: TEST_USER_NAME,
          email: TEST_USER_EMAIL,
          password: TEST_USER_PASSWORD
        }
      );

      // Login as admin and verify used badge
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/users');

      await expect(
        page.getByTestId(`settings-invitation-used-badge-${codeId}`)
      ).toBeVisible();

      // Verify user list shows all expected users
      const tableBody = page.locator('table tbody');
      await expect(tableBody).toContainText(ADMIN_FULL_NAME);
      await expect(tableBody).toContainText(ADMIN_USER_NAME);
      await expect(tableBody).toContainText(ADMIN_EMAIL);
      await expect(tableBody).toContainText(NORMAL_FULL_NAME);
      await expect(tableBody).toContainText(NORMAL_USER_NAME);
      await expect(tableBody).toContainText(NORMAL_EMAIL);
      await expect(tableBody).toContainText(TEST_USER_FULL_NAME);
      await expect(tableBody).toContainText(TEST_USER_NAME);
      await expect(tableBody).toContainText(TEST_USER_EMAIL);
    });

    test('admin invitation code creates admin user and shows used badge', async ({
      page
    }) => {
      const { codeId } = await createUserViaInvitation(
        page,
        { userName: ADMIN_USER_NAME, password: ADMIN_PASSWORD },
        {
          fullName: ADMIN_INVITE_USER_FULL_NAME,
          userName: ADMIN_INVITE_USER_NAME,
          email: ADMIN_INVITE_USER_EMAIL,
          password: ADMIN_INVITE_USER_PASSWORD,
          role: 'admin'
        }
      );

      // Login as admin and verify used badge
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/users');

      await expect(
        page.getByTestId(`settings-invitation-used-badge-${codeId}`)
      ).toBeVisible();

      // Verify the new admin user appears in the user list
      const tableBody = page.locator('table tbody');
      await expect(tableBody).toContainText(ADMIN_INVITE_USER_FULL_NAME);
      await expect(tableBody).toContainText(ADMIN_INVITE_USER_NAME);
      await expect(tableBody).toContainText(ADMIN_INVITE_USER_EMAIL);
    });
  });
