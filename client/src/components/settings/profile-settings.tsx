import { useTranslation } from '@/hooks/useTranslation';
import { useState, useEffect, useRef } from 'react';
import {
  getProfile,
  updateProfile,
  updatePassword
} from '@/api/server/settings';
import { ApiError } from '@/api/errors/ApiError';
import {
  validatePassword,
  validateUserName,
  FULL_NAME_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH
} from '@/lib/validation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDialog } from '@/hooks/useDialog';

type FormMessage = {
  type: 'success' | 'error';
  text: string;
  errors?: string[];
};

function ProfileSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}

function FormMessageDisplay({ message }: { message: FormMessage | null }) {
  if (!message) return null;
  return (
    <div
      className={`text-sm ${
        message.type === 'success' ? 'text-green-600' : 'text-destructive'
      }`}
    >
      {message.text && <p>{message.text}</p>}
      {message.errors && message.errors.length > 0 && (
        <ul className="ml-4 list-disc space-y-1">
          {message.errors.map(err => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProfileSettings() {
  const { t } = useTranslation();
  const { openDialog } = useDialog();

  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileFullName, setProfileFullName] = useState('');
  const [profileUserName, setProfileUserName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<FormMessage | null>(
    null
  );

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<FormMessage | null>(
    null
  );

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const loadProfile = async () => {
      try {
        const response = await getProfile();
        setProfileFullName(response.fullName);
        setProfileUserName(response.userName);
        setProfileEmail(response.email);
      } catch {
        openDialog({
          title: t('error'),
          description: t('error_load_profile'),
          type: 'ok'
        });
      } finally {
        setProfileLoaded(true);
      }
    };
    loadProfile();
  });

  const handleSaveProfile = async () => {
    setProfileMessage(null);

    const userNameValidation = validateUserName(profileUserName);
    if (userNameValidation) {
      setProfileMessage({ type: 'error', text: t(userNameValidation) });
      return;
    }

    setProfileSaving(true);
    try {
      const result = await updateProfile({
        fullName: profileFullName,
        userName: profileUserName,
        email: profileEmail
      });

      if (result.success) {
        setProfileMessage({
          type: 'success',
          text: t('settings_profile_save_success')
        });
      }
    } catch (error) {
      const detail =
        error instanceof ApiError && error.message !== 'API Error'
          ? error.message
          : null;
      setProfileMessage({
        type: 'error',
        text: detail
          ? t(
              detail as
                | 'register_user_name_invalid'
                | 'register_user_name_already_exists'
                | 'register_email_already_exists'
                | 'settings_profile_save_failed'
            )
          : t('settings_profile_save_failed')
      });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSavePassword = async () => {
    setPasswordMessage(null);

    if (!currentPassword) {
      setPasswordMessage({
        type: 'error',
        text: t('settings_profile_current_password_required')
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({
        type: 'error',
        text: t('settings_profile_password_mismatch')
      });
      return;
    }

    const pwErrorKeys = validatePassword(newPassword);
    if (pwErrorKeys.length > 0) {
      setPasswordMessage({
        type: 'error',
        text: '',
        errors: pwErrorKeys.map(key => t(key))
      });
      return;
    }

    setPasswordSaving(true);
    try {
      const result = await updatePassword({
        currentPassword,
        newPassword
      });

      if (result.success) {
        setPasswordMessage({
          type: 'success',
          text: t('settings_password_save_success')
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else if (result.errors) {
        setPasswordMessage({
          type: 'error',
          text: '',
          errors: result.errors.map(e =>
            t(
              e as
                | 'register_password_min_length'
                | 'register_password_max_length'
                | 'register_password_uppercase'
                | 'register_password_lowercase'
                | 'register_password_number'
                | 'register_password_symbol'
            )
          )
        });
      }
    } catch (error) {
      const detail =
        error instanceof ApiError && error.message !== 'API Error'
          ? error.message
          : null;
      setPasswordMessage({
        type: 'error',
        text: detail
          ? t(
              detail as
                | 'settings_profile_current_password_incorrect'
                | 'settings_password_save_failed'
            )
          : t('settings_password_save_failed')
      });
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings_profile')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!profileLoaded && <ProfileSkeleton />}

          {profileLoaded && (
            <>
              <div className="space-y-2">
                <Label htmlFor="profile-full-name">
                  {t('settings_profile_full_name')}
                </Label>
                <Input
                  id="profile-full-name"
                  value={profileFullName}
                  onChange={e => setProfileFullName(e.target.value)}
                  maxLength={FULL_NAME_MAX_LENGTH}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-user-name">
                  {t('settings_profile_user_name')}
                </Label>
                <Input
                  id="profile-user-name"
                  value={profileUserName}
                  onChange={e => setProfileUserName(e.target.value)}
                  maxLength={USER_NAME_MAX_LENGTH}
                  required
                  pattern="[a-zA-Z0-9]+"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-email">
                  {t('settings_profile_email')}
                </Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={profileEmail}
                  onChange={e => setProfileEmail(e.target.value)}
                  maxLength={EMAIL_MAX_LENGTH}
                  required
                />
              </div>

              <FormMessageDisplay message={profileMessage} />

              <Button
                onClick={handleSaveProfile}
                disabled={profileSaving}
                className="w-full"
              >
                {profileSaving
                  ? t('settings_profile_saving')
                  : t('settings_profile_save')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings_password')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-current-password">
              {t('settings_profile_current_password')}
            </Label>
            <Input
              id="profile-current-password"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="current-password"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-new-password">
              {t('settings_profile_new_password')}
            </Label>
            <Input
              id="profile-new-password"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-confirm-password">
              {t('settings_profile_confirm_password')}
            </Label>
            <Input
              id="profile-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
            />
          </div>

          <FormMessageDisplay message={passwordMessage} />

          <Button
            onClick={handleSavePassword}
            disabled={passwordSaving}
            className="w-full"
          >
            {passwordSaving
              ? t('settings_password_saving')
              : t('settings_password_save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
