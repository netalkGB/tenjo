import { useLingui } from '@lingui/react';

export function useTranslation() {
  const { i18n } = useLingui();
  const t = (key: string, values?: Record<string, unknown>): string => {
    const msg = i18n.messages[key];
    if (msg === '') return '';
    return i18n._(key, values);
  };
  return { t, i18n };
}
