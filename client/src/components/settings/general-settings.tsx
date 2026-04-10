import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { type LocaleMode, LOCALE_MODES } from '@/i18n/config';
import { type ThemeMode, THEME_MODES } from '@/lib/themeManager';
import { useSettings } from '@/contexts/settings-context';
import { useUser } from '@/contexts/user-context';
import { useDialog } from '@/hooks/useDialog';
import { getCleanupStatus, startCleanup } from '@/api/server/settings';
import { formatFileSize } from '@/lib/formatFileSize';

const languageI18nKeys: Record<
  LocaleMode,
  'settings_language_auto' | 'settings_language_en' | 'settings_language_ja'
> = {
  auto: 'settings_language_auto',
  en: 'settings_language_en',
  ja: 'settings_language_ja'
};

const themeI18nKeys: Record<
  ThemeMode,
  'settings_theme_auto' | 'settings_theme_light' | 'settings_theme_dark'
> = {
  auto: 'settings_theme_auto',
  light: 'settings_theme_light',
  dark: 'settings_theme_dark'
};

const POLL_INTERVAL_MS = 5_000;

export function GeneralSettings() {
  const { t } = useTranslation();
  const { localeMode, themeMode, updateLocaleMode, updateThemeMode } =
    useSettings();
  const { userRole } = useUser();
  const { openDialog } = useDialog();
  const isAdmin = userRole === 'admin';

  const [cleaning, setCleaning] = useState(false);
  const [totalSizeBytes, setTotalSizeBytes] = useState<number | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);

  const fetchStatus = async () => {
    try {
      const status = await getCleanupStatus();
      setCleaning(status.cleaning);
      setTotalSizeBytes(status.totalSizeBytes);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_cleanup_status'),
        type: 'ok'
      });
    } finally {
      setStatusLoaded(true);
    }
  };

  // Load initial status
  const statusInitialized = useRef(false);
  useEffect(() => {
    if (!isAdmin || statusInitialized.current) return;
    statusInitialized.current = true;
    fetchStatus();
  });

  // Poll while cleaning
  useEffect(() => {
    if (!cleaning) return;
    const timer = setInterval(async () => {
      try {
        const status = await getCleanupStatus();
        setCleaning(status.cleaning);
        setTotalSizeBytes(status.totalSizeBytes);
      } catch {
        // Ignore polling errors
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [cleaning]);

  const handleStartCleanup = async () => {
    try {
      await startCleanup();
      setCleaning(true);
    } catch {
      openDialog({
        title: t('error'),
        description: t('error_cleanup_start'),
        type: 'ok'
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings_general')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="language-select">{t('settings_language')}</Label>
            <Select
              value={localeMode}
              onValueChange={v => updateLocaleMode(v as LocaleMode)}
            >
              <SelectTrigger
                id="language-select"
                className="w-full"
                data-testid="settings-general-language-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALE_MODES.map(mode => (
                  <SelectItem
                    key={mode}
                    value={mode}
                    data-testid={`settings-general-language-option-${mode}`}
                  >
                    {t(languageI18nKeys[mode])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="theme-select">{t('settings_theme')}</Label>
            <Select
              value={themeMode}
              onValueChange={v => updateThemeMode(v as ThemeMode)}
            >
              <SelectTrigger
                id="theme-select"
                className="w-full"
                data-testid="settings-general-theme-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_MODES.map(mode => (
                  <SelectItem
                    key={mode}
                    value={mode}
                    data-testid={`settings-general-theme-option-${mode}`}
                  >
                    {t(themeI18nKeys[mode])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card data-testid="settings-cleanup-card">
          <CardHeader>
            <CardTitle>{t('settings_cleanup')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              {t('settings_cleanup_description')}
            </p>

            {totalSizeBytes !== null && (
              <p
                className="text-sm font-medium"
                data-testid="settings-cleanup-total-size"
              >
                {t('settings_cleanup_total_size', {
                  size: formatFileSize(totalSizeBytes)
                })}
              </p>
            )}

            {statusLoaded &&
              (cleaning ? (
                <div
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  data-testid="settings-cleanup-in-progress"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t('settings_cleanup_in_progress')}</span>
                </div>
              ) : (
                <Button
                  onClick={handleStartCleanup}
                  variant="outline"
                  data-testid="settings-cleanup-button"
                >
                  {t('settings_cleanup_button')}
                </Button>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
