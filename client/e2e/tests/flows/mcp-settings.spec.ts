import { test, expect } from '@playwright/test';
import {
  ADMIN_USER_NAME,
  ADMIN_PASSWORD,
  NORMAL_USER_NAME,
  NORMAL_PASSWORD,
  SETUP_MCP_SERVER_NAME
} from '../setup/constants';
import { login } from '../../helpers/auth';

// Use a different name from the setup MCP server to test add/delete independently
const MCP_SERVER_NAME = 'mcp-test-server';
const MCP_COMMAND = 'npx';
const MCP_ARGS = ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/'];

async function logoutAndWait(page: import('@playwright/test').Page) {
  await page.getByTestId('sidebar-user-profile-button').click();
  await page.getByTestId('sidebar-user-signout-menu-item').click();
  await page.getByTestId('dialog-ok-button').click();
  await page.waitForURL(/\/login/);
}

test.describe
  .serial('MCP settings', () => {
    test('admin: add MCP server and verify tools appear', async ({ page }) => {
      test.setTimeout(120_000);
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/tools-mcp');

      // Click "Add server" button
      await page.getByTestId('settings-mcp-add-server-button').click();

      // Fill server name
      await page
        .getByTestId('settings-mcp-dialog-name-input')
        .fill(MCP_SERVER_NAME);

      // Transport defaults to stdio, fill command
      await page
        .getByTestId('settings-mcp-dialog-command-input')
        .fill(MCP_COMMAND);

      // Add args one by one
      for (const arg of MCP_ARGS) {
        await page
          .getByTestId('settings-mcp-dialog-string-list-add-button')
          .click();
        const inputs = page.getByTestId(
          'settings-mcp-dialog-string-list-input'
        );
        await inputs.last().fill(arg);
      }

      // Save the server
      await page.getByTestId('settings-mcp-dialog-save-button').click();

      // Verify server appears in the MCP server list
      await expect(
        page
          .getByTestId('settings-mcp-server-item')
          .filter({ hasText: MCP_SERVER_NAME })
      ).toBeVisible({ timeout: 10000 });

      // Wait for tools to load in the approval rules section
      const serverSection = page
        .getByTestId('settings-mcp-tool-approval-server')
        .filter({ hasText: MCP_SERVER_NAME });
      await expect(serverSection).toBeVisible({ timeout: 30000 });

      // Verify tools are listed under the server
      const toolItems = serverSection.getByTestId(
        'settings-mcp-tool-approval-item'
      );
      await expect(toolItems.first()).toBeVisible();
      const toolCount = await toolItems.count();
      expect(toolCount).toBeGreaterThan(0);

      // Verify all tools default to manual approval (manual button is disabled = active)
      for (let i = 0; i < toolCount; i++) {
        const manualButton = toolItems
          .nth(i)
          .getByTestId('settings-mcp-tool-approval-manual-button');
        await expect(manualButton).toBeDisabled();
      }

      await logoutAndWait(page);
    });

    test('normal user: add server button and delete buttons are not visible', async ({
      page
    }) => {
      await login(page, NORMAL_USER_NAME, NORMAL_PASSWORD);
      await page.goto('/settings/tools-mcp');

      // Verify "Add server" button is NOT visible
      await expect(
        page.getByTestId('settings-mcp-add-server-button')
      ).not.toBeVisible();

      // Verify the MCP server is visible but without delete button
      const serverItem = page
        .getByTestId('settings-mcp-server-item')
        .filter({ hasText: MCP_SERVER_NAME });
      await expect(serverItem).toBeVisible();
      await expect(
        serverItem.getByTestId('settings-mcp-server-delete-button')
      ).not.toBeVisible();

      await logoutAndWait(page);
    });

    test('admin: verify tools appear in chat input tool picker', async ({
      page
    }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);

      // Navigate to new chat
      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      // Open the tool picker
      await page.getByTestId('chat-input-mcp-tools-button').click();

      // Verify the MCP server name appears
      await expect(
        page
          .getByTestId('chat-input-mcp-tools-server')
          .filter({ hasText: MCP_SERVER_NAME })
      ).toBeVisible();

      // Verify tools are listed under the server
      const tools = page.getByTestId('chat-input-mcp-tools-tool');
      await expect(tools.first()).toBeVisible();
      expect(await tools.count()).toBeGreaterThan(0);

      await page.keyboard.press('Escape');
    });

    test('admin: set all tools to auto-approve and verify in chat', async ({
      page
    }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/tools-mcp');

      // Click "all auto-approve" for the server
      const serverSection = page
        .getByTestId('settings-mcp-tool-approval-server')
        .filter({ hasText: MCP_SERVER_NAME });
      await serverSection
        .getByTestId('settings-mcp-tool-approval-server-approve-button')
        .click();

      // Verify all tools switched to auto-approve (approve button is disabled = active)
      const toolItems = serverSection.getByTestId(
        'settings-mcp-tool-approval-item'
      );
      await expect(toolItems.first()).toBeVisible();
      const toolCount = await toolItems.count();
      for (let i = 0; i < toolCount; i++) {
        await expect(
          toolItems
            .nth(i)
            .getByTestId('settings-mcp-tool-approval-approve-button')
        ).toBeDisabled({ timeout: 5000 });
      }

      // Navigate to new chat and verify tools still appear in tool picker
      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      await page.getByTestId('chat-input-mcp-tools-button').click();
      await expect(
        page
          .getByTestId('chat-input-mcp-tools-server')
          .filter({ hasText: MCP_SERVER_NAME })
      ).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('admin: set all tools to banned and verify hidden in chat', async ({
      page
    }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/tools-mcp');

      // Click "all banned" for the server
      const serverSection = page
        .getByTestId('settings-mcp-tool-approval-server')
        .filter({ hasText: MCP_SERVER_NAME });
      await serverSection
        .getByTestId('settings-mcp-tool-approval-server-banned-button')
        .click();

      // Verify all tools switched to banned (banned button is disabled = active)
      const toolItems = serverSection.getByTestId(
        'settings-mcp-tool-approval-item'
      );
      await expect(toolItems.first()).toBeVisible();
      const toolCount = await toolItems.count();
      for (let i = 0; i < toolCount; i++) {
        await expect(
          toolItems
            .nth(i)
            .getByTestId('settings-mcp-tool-approval-banned-button')
        ).toBeDisabled({ timeout: 5000 });
      }

      // Navigate to new chat - banned server's tools should not appear in tool picker
      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      // The tool picker may still be visible (setup MCP server has tools),
      // but the banned server should not appear in the picker
      const toolPickerButton = page.getByTestId('chat-input-mcp-tools-button');
      if (await toolPickerButton.isVisible()) {
        await toolPickerButton.click();
        await expect(
          page
            .getByTestId('chat-input-mcp-tools-server')
            .filter({ hasText: MCP_SERVER_NAME })
        ).not.toBeVisible();
        // Setup server should still be visible
        await expect(
          page
            .getByTestId('chat-input-mcp-tools-server')
            .filter({ hasText: SETUP_MCP_SERVER_NAME })
        ).toBeVisible();
        await page.keyboard.press('Escape');
      }
    });

    test('admin: set all tools back to manual', async ({ page }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/tools-mcp');

      // Click "all manual" for the server
      const serverSection = page
        .getByTestId('settings-mcp-tool-approval-server')
        .filter({ hasText: MCP_SERVER_NAME });
      await serverSection
        .getByTestId('settings-mcp-tool-approval-server-manual-button')
        .click();

      // Verify all tools switched to manual
      const toolItems = serverSection.getByTestId(
        'settings-mcp-tool-approval-item'
      );
      await expect(toolItems.first()).toBeVisible();
      const toolCount = await toolItems.count();
      for (let i = 0; i < toolCount; i++) {
        await expect(
          toolItems
            .nth(i)
            .getByTestId('settings-mcp-tool-approval-manual-button')
        ).toBeDisabled({ timeout: 5000 });
      }
    });

    test('admin: delete MCP server and verify removal everywhere', async ({
      page
    }) => {
      await login(page, ADMIN_USER_NAME, ADMIN_PASSWORD);
      await page.goto('/settings/tools-mcp');

      // Click delete on the server
      const serverItem = page
        .getByTestId('settings-mcp-server-item')
        .filter({ hasText: MCP_SERVER_NAME });
      await expect(serverItem).toBeVisible();
      await serverItem.getByTestId('settings-mcp-server-delete-button').click();

      // Confirm deletion dialog
      await page.getByTestId('dialog-ok-button').click();

      // Verify server is removed from the list
      await expect(
        page
          .getByTestId('settings-mcp-server-item')
          .filter({ hasText: MCP_SERVER_NAME })
      ).not.toBeVisible();

      // Verify approval rules section no longer shows this server
      await expect(
        page
          .getByTestId('settings-mcp-tool-approval-server')
          .filter({ hasText: MCP_SERVER_NAME })
      ).not.toBeVisible();

      // Navigate to new chat - deleted server should not appear in tool picker
      await page.getByTestId('sidebar-new-chat-button').click();
      await expect(page).toHaveURL('/');

      // Tool picker may still be visible (setup MCP server exists),
      // but the deleted server should not appear
      const toolPickerButton = page.getByTestId('chat-input-mcp-tools-button');
      if (await toolPickerButton.isVisible()) {
        await toolPickerButton.click();
        await expect(
          page
            .getByTestId('chat-input-mcp-tools-server')
            .filter({ hasText: MCP_SERVER_NAME })
        ).not.toBeVisible();
        await page.keyboard.press('Escape');
      }
    });
  });
