import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ADMIN_USER_NAME,
  ADMIN_PASSWORD,
  NORMAL_USER_NAME,
  NORMAL_PASSWORD
} from '../setup/constants';
import { login } from '../../helpers/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_PATH = path.resolve(__dirname, 'files/image.png');

const DEFAULT_APP_TITLE = 'Tenjo';
const CUSTOM_APP_TITLE = 'Custom Tenjo Title';

async function waitForBrandingResponse(
  page: Page,
  method: 'PUT' | 'DELETE',
  pathSuffix: string,
  action: () => Promise<unknown>
) {
  const responsePromise = page.waitForResponse(
    resp =>
      resp.url().includes(`/api/settings/branding${pathSuffix}`) &&
      resp.request().method() === method
  );
  await action();
  await responsePromise;
}

test.describe('branding settings (non-admin access)', () => {
  test('normal user does not see the branding nav entry and cannot view the branding form', async ({
    page
  }) => {
    await login(page, NORMAL_USER_NAME, NORMAL_PASSWORD);

    // Settings nav should not include the branding entry for non-admins
    await page.goto('/settings');
    await expect(page.getByTestId('settings-nav-branding')).toHaveCount(0);

    // Navigating directly to /settings/branding falls back to the first allowed
    // category — branding form controls must remain absent
    await page.goto('/settings/branding');
    await expect(page.getByTestId('branding-title-input')).toHaveCount(0);
    await expect(page.getByTestId('branding-logo-upload')).toHaveCount(0);
    await expect(page.getByTestId('branding-favicon-upload')).toHaveCount(0);
  });
});

test.describe
  .serial('branding settings (admin)', () => {
    test('admin can change the app title', async ({ page }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/branding');

      const titleInput = page.getByTestId('branding-title-input');
      await expect(titleInput).toBeVisible();

      await titleInput.fill(CUSTOM_APP_TITLE);
      await waitForBrandingResponse(page, 'PUT', '', () =>
        page.getByTestId('branding-title-save').click()
      );

      // Document title should reflect the saved value
      await expect(page).toHaveTitle(CUSTOM_APP_TITLE);

      // Reset button should now be enabled because a custom title is set
      await expect(page.getByTestId('branding-title-reset')).toBeEnabled();
    });

    test('admin can upload a custom logo', async ({ page }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/branding');

      await waitForBrandingResponse(page, 'PUT', '/logo', () =>
        page
          .getByTestId('branding-logo-file-input')
          .setInputFiles(IMAGE_PATH)
      );

      // Reset becomes enabled once a custom logo is set
      await expect(page.getByTestId('branding-logo-reset')).toBeEnabled();

      // Sidebar logo should now render an <img> pointing to the uploaded asset
      await expect(
        page.locator('[data-testid="sidebar-logo-link"] img')
      ).toHaveAttribute('src', /\/api\/upload\/artifacts\//);
    });

    test('admin can upload a custom favicon', async ({ page }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/branding');

      await waitForBrandingResponse(page, 'PUT', '/favicon', () =>
        page
          .getByTestId('branding-favicon-file-input')
          .setInputFiles(IMAGE_PATH)
      );

      // Reset becomes enabled once a custom favicon is set
      await expect(page.getByTestId('branding-favicon-reset')).toBeEnabled();

      // The <link rel="icon"> href should point at the uploaded artifact
      await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
        'href',
        /\/api\/upload\/artifacts\//
      );
    });

    test('admin can reset title, logo, and favicon back to defaults', async ({
      page
    }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/branding');

      // Sanity check: previous tests left customized values
      await expect(page).toHaveTitle(CUSTOM_APP_TITLE);
      await expect(page.getByTestId('branding-title-reset')).toBeEnabled();
      await expect(page.getByTestId('branding-logo-reset')).toBeEnabled();
      await expect(page.getByTestId('branding-favicon-reset')).toBeEnabled();

      // Reset the title
      await waitForBrandingResponse(page, 'PUT', '', () =>
        page.getByTestId('branding-title-reset').click()
      );
      await expect(page).toHaveTitle(DEFAULT_APP_TITLE);
      await expect(page.getByTestId('branding-title-reset')).toBeDisabled();
      await expect(page.getByTestId('branding-title-input')).toHaveValue('');

      // Reset the logo
      await waitForBrandingResponse(page, 'DELETE', '/logo', () =>
        page.getByTestId('branding-logo-reset').click()
      );
      await expect(page.getByTestId('branding-logo-reset')).toBeDisabled();
      await expect(
        page.locator('[data-testid="sidebar-logo-link"] img')
      ).toHaveCount(0);

      // Reset the favicon
      await waitForBrandingResponse(page, 'DELETE', '/favicon', () =>
        page.getByTestId('branding-favicon-reset').click()
      );
      await expect(page.getByTestId('branding-favicon-reset')).toBeDisabled();
      await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
        'href',
        '/logo.svg'
      );
    });
  });
