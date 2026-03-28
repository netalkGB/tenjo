import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { type LocaleMode, LOCALE_MODES } from '@/i18n/config';
import { type ThemeMode, THEME_MODES } from '@/lib/themeManager';
import { useSettings } from '@/contexts/settings-context';

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

export function GeneralSettings() {
  const { t } = useTranslation();
  const { localeMode, themeMode, updateLocaleMode, updateThemeMode } =
    useSettings();

  return (
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
            <SelectTrigger id="language-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALE_MODES.map(mode => (
                <SelectItem key={mode} value={mode}>
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
            <SelectTrigger id="theme-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_MODES.map(mode => (
                <SelectItem key={mode} value={mode}>
                  {t(themeI18nKeys[mode])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
