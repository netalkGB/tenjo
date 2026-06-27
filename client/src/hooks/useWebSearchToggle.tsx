import { useRef, type MouseEvent } from 'react';
import { WebSearchExtendedTimeoutOption } from '@/components/chat/web-search-extended-timeout-option';
import { useDialog } from '@/hooks/useDialog';
import { useSettings } from '@/contexts/settings-context';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Web-search on/off toggle behavior shared by the chat input toggle button
 * and the agent options menu. The state lives in the settings context
 * (persisted per user); turning it ON asks for confirmation first.
 */
export function useWebSearchToggle() {
  const { t } = useTranslation();
  const { openDialog } = useDialog();
  const { webSearchEnabled, setWebSearchEnabledOptions } = useSettings();
  const extendedTimeoutRef = useRef(false);

  const toggleWebSearch = (event?: MouseEvent<HTMLElement>) => {
    if (webSearchEnabled) {
      setWebSearchEnabledOptions({ enabled: false });
      return;
    }
    const showExtendedTimeoutOption = event?.shiftKey === true;
    extendedTimeoutRef.current = false;
    openDialog({
      title: t('web_search_enable_title'),
      description: t('web_search_warning'),
      content: showExtendedTimeoutOption ? (
        <WebSearchExtendedTimeoutOption
          onChange={checked => {
            extendedTimeoutRef.current = checked;
          }}
        />
      ) : undefined,
      type: 'cancel/ok',
      okText: t('web_search_enable_confirm'),
      cancelText: t('web_search_enable_cancel'),
      showCloseButton: false,
      onOk: () => {
        setWebSearchEnabledOptions({
          enabled: true,
          extendedTimeoutEnabled:
            showExtendedTimeoutOption && extendedTimeoutRef.current
        });
      }
    });
  };

  return { webSearchEnabled, toggleWebSearch };
}
