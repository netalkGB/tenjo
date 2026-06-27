import type { Page } from '@playwright/test';

/** Helpers for controlling Monaco Editor content in E2E tests. */
interface MonacoEditorHandle {
  setValue: (value: string) => void;
  getValue: () => string;
}

interface MonacoWindow {
  monaco: {
    editor: {
      getEditors: () => MonacoEditorHandle[];
    };
  };
}

export async function setMonacoContent(page: Page, text: string) {
  await page.locator('.monaco-editor').waitFor({ state: 'visible' });
  await page.evaluate((value: string) => {
    const editor = (
      window as unknown as MonacoWindow
    ).monaco.editor.getEditors()[0];
    editor.setValue(value);
  }, text);
}

export async function getMonacoContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = (
      window as unknown as MonacoWindow
    ).monaco.editor.getEditors()[0];
    return editor.getValue();
  });
}
