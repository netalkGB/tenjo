import { i18n } from '@lingui/core';
import { compileMessage } from '@lingui/message-utils/compileMessage';

import en from './locales/en.json';
import ja from './locales/ja.json';

// Lingui only auto-registers the message compiler in development builds, so
// production loses `{placeholder}` interpolation for raw JSON catalogs. Register
// it explicitly so interpolation works in every build mode.
i18n.setMessagesCompiler(compileMessage);
i18n.load({ en, ja });

export const SUPPORTED_LOCALES = ['en', 'ja'] as const;
export type LocaleMode = 'auto' | (typeof SUPPORTED_LOCALES)[number];
export const LOCALE_MODES: readonly LocaleMode[] = [
  'auto',
  ...SUPPORTED_LOCALES
] as const;

/**
 * Detects the best locale from the browser language settings.
 */
function detectBrowserLocale(): (typeof SUPPORTED_LOCALES)[number] {
  const browserLang = navigator.language.split('-')[0];
  if (
    SUPPORTED_LOCALES.includes(
      browserLang as (typeof SUPPORTED_LOCALES)[number]
    )
  ) {
    return browserLang as (typeof SUPPORTED_LOCALES)[number];
  }
  return 'en';
}

/**
 * Resolves a locale mode to an actual locale for i18n activation.
 */
function resolveLocale(mode: LocaleMode): (typeof SUPPORTED_LOCALES)[number] {
  return mode === 'auto' ? detectBrowserLocale() : mode;
}

/**
 * Activates the given locale mode.
 */
export function changeLocale(mode: LocaleMode): void {
  i18n.activate(resolveLocale(mode));
}

// Initialize with browser detection (auto) on startup
i18n.activate(detectBrowserLocale());

export { i18n };
