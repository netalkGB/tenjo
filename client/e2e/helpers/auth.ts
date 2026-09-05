import { Locator, Page, expect } from '@playwright/test';

const LOGIN_FORM_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 5_000;
const FILL_TIMEOUT_MS = 5_000;

/**
 * Headed Chromium requests `/favicon.ico` (and similar) even when the page
 * already has an icon. This app's SPA catch-all serves index.html for those
 * URLs, which can keep `load` from firing and leave Playwright stuck on
 * `page.goto` with an empty login form.
 */
async function stubHangingBrowserRequests(page: Page): Promise<void> {
  await page.route(/\/favicon\.ico(\?|$)|apple-touch-icon/, route =>
    route.fulfill({ status: 204, body: '' })
  );
}

/**
 * Navigate to the login page and wait until the form is actually usable.
 *
 * Always await `page.goto` (with a short timeout). A fire-and-forget goto
 * that never reaches its lifecycle state keeps the test and context teardown
 * blocked, which is what headed runs showed as an empty login form.
 */
export async function openLoginPage(page: Page): Promise<void> {
  await stubHangingBrowserRequests(page);

  const idInput = page.getByTestId('login-form-id-input');

  await page
    .goto('/login', {
      waitUntil: 'commit',
      timeout: NAVIGATION_TIMEOUT_MS
    })
    .catch(() => {
      // Client-side redirect or a lifecycle event that never fires.
    });

  await expect(idInput).toBeVisible({ timeout: LOGIN_FORM_TIMEOUT_MS });
  // Abort leftover subresource loads so a stuck navigation waiter can settle.
  await page.evaluate(() => window.stop()).catch(() => undefined);
}

/**
 * Set an input value without locator.fill()'s navigation/actionability wait.
 * Login fields are uncontrolled; FormData reads `.value` on submit.
 */
async function fillLoginInput(locator: Locator, value: string): Promise<void> {
  await locator.evaluate((el, nextValue) => {
    if (!(el instanceof HTMLInputElement)) {
      throw new Error('expected an input element');
    }
    el.value = nextValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(locator).toHaveValue(value, { timeout: FILL_TIMEOUT_MS });
}

/**
 * Fill and submit the login form. Retries if a remount clears the fields
 * before submit (client-side redirect recreating the form).
 */
export async function submitLoginForm(
  page: Page,
  userName: string,
  password: string
): Promise<void> {
  const idInput = page.getByTestId('login-form-id-input');
  const passwordInput = page.getByTestId('login-form-password-input');
  const submitButton = page.getByTestId('login-form-submit-button');

  await expect(async () => {
    await fillLoginInput(idInput, userName);
    await fillLoginInput(passwordInput, password);
  }).toPass({ timeout: LOGIN_FORM_TIMEOUT_MS });

  await submitButton.click({
    timeout: LOGIN_FORM_TIMEOUT_MS,
    noWaitAfter: true
  });
}

export async function login(
  page: Page,
  userName: string,
  password: string
): Promise<void> {
  await openLoginPage(page);
  await submitLoginForm(page, userName, password);

  await expect(page).toHaveURL('/', { timeout: LOGIN_FORM_TIMEOUT_MS });
  await expect(page.getByTestId('sidebar-user-profile-button')).toBeVisible({
    timeout: LOGIN_FORM_TIMEOUT_MS
  });
}
