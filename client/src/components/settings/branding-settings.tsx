import { useState, useRef } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDialog } from '@/hooks/useDialog';
import { useBranding } from '@/contexts/branding-context';
import {
  updateBranding,
  uploadBrandingLogo,
  resetBrandingLogo,
  uploadBrandingFavicon,
  resetBrandingFavicon
} from '@/api/server/settings';
import ServiceLogo from '@/assets/service-logo.svg?react';

const APP_TITLE_MAX_LENGTH = 60;

type BrandingTarget = 'logo' | 'favicon';

export function BrandingSettings() {
  const { t } = useTranslation();
  const { openDialog } = useDialog();
  const { appTitle, logoUrl, faviconUrl, reloadBranding } = useBranding();

  const [titleInput, setTitleInput] = useState(appTitle ?? '');
  const titleSyncedFor = useRef<string | null>(null);
  const remoteTitle = appTitle ?? '';
  if (titleSyncedFor.current !== remoteTitle) {
    titleSyncedFor.current = remoteTitle;
    if (titleInput !== remoteTitle) {
      setTitleInput(remoteTitle);
    }
  }

  const [titleSaving, setTitleSaving] = useState(false);
  const [uploading, setUploading] = useState<BrandingTarget | null>(null);
  const [resetting, setResetting] = useState<BrandingTarget | 'title' | null>(
    null
  );

  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const showError = (key: 'error_branding_save' | 'error_branding_upload') => {
    openDialog({
      title: t('error'),
      description: t(key),
      type: 'ok'
    });
  };

  const handleSaveTitle = async () => {
    setTitleSaving(true);
    try {
      const trimmed = titleInput.trim();
      await updateBranding({ appTitle: trimmed === '' ? null : trimmed });
      await reloadBranding();
    } catch {
      showError('error_branding_save');
    } finally {
      setTitleSaving(false);
    }
  };

  const handleResetTitle = async () => {
    setResetting('title');
    try {
      await updateBranding({ appTitle: null });
      setTitleInput('');
      await reloadBranding();
    } catch {
      showError('error_branding_save');
    } finally {
      setResetting(null);
    }
  };

  const handleFileSelected = async (
    target: BrandingTarget,
    fileList: FileList | null
  ) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    setUploading(target);
    try {
      if (target === 'logo') {
        await uploadBrandingLogo(file);
      } else {
        await uploadBrandingFavicon(file);
      }
      await reloadBranding();
    } catch {
      showError('error_branding_upload');
    } finally {
      setUploading(null);
      if (target === 'logo' && logoInputRef.current) {
        logoInputRef.current.value = '';
      }
      if (target === 'favicon' && faviconInputRef.current) {
        faviconInputRef.current.value = '';
      }
    }
  };

  const handleResetImage = async (target: BrandingTarget) => {
    setResetting(target);
    try {
      if (target === 'logo') {
        await resetBrandingLogo();
      } else {
        await resetBrandingFavicon();
      }
      await reloadBranding();
    } catch {
      showError('error_branding_save');
    } finally {
      setResetting(null);
    }
  };

  const titleChanged = titleInput.trim() !== (appTitle ?? '');
  const titleTooLong = titleInput.trim().length > APP_TITLE_MAX_LENGTH;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings_branding')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground text-sm">
            {t('settings_branding_description')}
          </p>

          <div className="space-y-2">
            <Label htmlFor="branding-title-input">
              {t('settings_branding_app_title')}
            </Label>
            <Input
              id="branding-title-input"
              value={titleInput}
              maxLength={APP_TITLE_MAX_LENGTH + 10}
              placeholder={t('settings_branding_app_title_placeholder')}
              onChange={e => setTitleInput(e.target.value)}
              data-testid="branding-title-input"
            />
            <p className="text-muted-foreground text-xs">
              {t('settings_branding_app_title_hint')}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                onClick={handleSaveTitle}
                disabled={titleSaving || !titleChanged || titleTooLong}
                data-testid="branding-title-save"
              >
                {titleSaving && (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                )}
                {t('settings_branding_save')}
              </Button>
              <Button
                variant="outline"
                onClick={handleResetTitle}
                disabled={resetting === 'title' || appTitle === null}
                data-testid="branding-title-reset"
              >
                {t('settings_branding_reset')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('settings_branding_logo')}</Label>
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-md border bg-background p-2">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt=""
                    className="max-h-full max-w-full object-contain select-none [-webkit-user-drag:none]"
                  />
                ) : (
                  <ServiceLogo className="h-12 w-auto" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploading === 'logo'}
                  data-testid="branding-logo-upload"
                >
                  {uploading === 'logo' ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-1 h-4 w-4" />
                  )}
                  {t('settings_branding_upload')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleResetImage('logo')}
                  disabled={resetting === 'logo' || logoUrl === null}
                  data-testid="branding-logo-reset"
                >
                  {t('settings_branding_reset')}
                </Button>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  className="hidden"
                  onChange={e =>
                    handleFileSelected('logo', e.currentTarget.files)
                  }
                  data-testid="branding-logo-file-input"
                />
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              {t('settings_branding_logo_hint')}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t('settings_branding_favicon')}</Label>
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-md border bg-background p-2">
                <img
                  src={faviconUrl ?? '/logo.svg'}
                  alt=""
                  className="max-h-full max-w-full object-contain select-none [-webkit-user-drag:none]"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => faviconInputRef.current?.click()}
                  disabled={uploading === 'favicon'}
                  data-testid="branding-favicon-upload"
                >
                  {uploading === 'favicon' ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-1 h-4 w-4" />
                  )}
                  {t('settings_branding_upload')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleResetImage('favicon')}
                  disabled={resetting === 'favicon' || faviconUrl === null}
                  data-testid="branding-favicon-reset"
                >
                  {t('settings_branding_reset')}
                </Button>
                <input
                  ref={faviconInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  className="hidden"
                  onChange={e =>
                    handleFileSelected('favicon', e.currentTarget.files)
                  }
                  data-testid="branding-favicon-file-input"
                />
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              {t('settings_branding_favicon_hint')}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
