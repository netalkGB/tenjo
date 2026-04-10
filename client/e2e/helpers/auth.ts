import { Page, expect } from '@playwright/test';

export async function login(
  page: Page,
  userName: string,
  password: string
): Promise<void> {
  // Catch navigation interruption caused by client-side redirect
  // (e.g., /login -> /login?redirect=...)
  await page.goto('/login').catch(() => {});
  await page.getByTestId('login-form-id-input').waitFor();
  await page.getByTestId('login-form-id-input').fill(userName);
  await page.getByTestId('login-form-password-input').fill(password);
  await page.getByTestId('login-form-submit-button').click();

  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('sidebar-user-profile-button')).toBeVisible();
}
