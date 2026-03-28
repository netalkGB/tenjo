import { useLingui } from '@lingui/react';

export function useTranslation() {
  const lingui = useLingui();

  const t = (key: string, values?: Record<string, unknown>): string => {
    const msg = lingui.i18n.messages[key];
    if (msg === '') return '';
    // Use lingui._ to ensure reactivity on locale change
    return lingui._(key, values);
  };

  return { t, i18n: lingui.i18n };
}
