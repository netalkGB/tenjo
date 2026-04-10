import { Page, expect } from '@playwright/test';
import { login } from './auth';

export async function generateAndGetCode(page: Page): Promise<{
  codeId: string;
  invitationCode: string;
}> {
  // Intercept the API response to reliably get the generated code
  const [response] = await Promise.all([
    page.waitForResponse(
      resp =>
        resp.url().includes('/api/settings/invitation-codes') &&
        resp.request().method() === 'POST' &&
        resp.ok()
    ),
    page.getByTestId('settings-invitation-generate-button').click()
  ]);

  const body = (await response.json()) as {
    code: { id: string; code: string };
  };

  return { codeId: body.code.id, invitationCode: body.code.code };
}

/**
 * Full flow: login as admin → generate invitation code → logout → register new user.
 * Returns the codeId and invitationCode for further assertions (e.g. used badge).
 */
export async function createUserViaInvitation(
  page: Page,
  admin: { userName: string; password: string },
  newUser: {
    fullName: string;
    userName: string;
    email: string;
    password: string;
    role?: 'admin' | 'standard';
  }
): Promise<{ codeId: string; invitationCode: string }> {
  // Login as admin and navigate to user settings
  await login(page, admin.userName, admin.password);
  await page.goto('/settings/users');

  // Select role if specified as admin
  if (newUser.role === 'admin') {
    await page.getByTestId('settings-invitation-role-select').click();
    await page.getByTestId('settings-invitation-role-option-admin').click();
  }

  // Generate invitation code
  const { codeId, invitationCode } = await generateAndGetCode(page);

  // Logout
  await page.getByTestId('sidebar-user-profile-button').click();
  await page.getByTestId('sidebar-user-signout-menu-item').click();
  await page.getByTestId('dialog-ok-button').click();
  await page.waitForURL(/\/login/);

  // Register new user
  await page.getByTestId('login-form-register-link').click();
  await page.getByTestId('register-invitation-code-input').fill(invitationCode);
  await page.getByTestId('register-full-name-input').fill(newUser.fullName);
  await page.getByTestId('register-user-name-input').fill(newUser.userName);
  await page.getByTestId('register-email-input').fill(newUser.email);
  await page.getByTestId('register-password-input').fill(newUser.password);
  await page
    .getByTestId('register-password-confirm-input')
    .fill(newUser.password);
  await page.getByTestId('register-submit-button').click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 });

  return { codeId, invitationCode };
}
