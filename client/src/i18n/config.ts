import { i18n } from '@lingui/core';

import en from './locales/en.json';
import ja from './locales/ja.json';

i18n.load({ en, ja });

const SUPPORTED_LOCALES = ['en', 'ja'];
const STORAGE_KEY = 'i18nextLng';

function detectLocale(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LOCALES.includes(stored)) return stored;

  const browserLang = navigator.language.split('-')[0];
  if (SUPPORTED_LOCALES.includes(browserLang)) return browserLang;

  return 'en';
}

i18n.activate(detectLocale());

export { i18n };
