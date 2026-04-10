import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  validatePassword,
  validateUserName,
  FULL_NAME_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH
} from '@/lib/validation';

export interface RegisterFormData {
  fullName: string;
  userName: string;
  email: string;
  password: string;
  invitationCode?: string;
}

interface RegisterFormProps extends React.ComponentProps<'div'> {
  needsInvitationCode: boolean;
  onSubmitButtonClicked?: (data: RegisterFormData) => void;
}

export interface RegisterFormRef {
  setRegistering: (isRegistering: boolean) => void;
  setError: (error: string | null) => void;
}

export const RegisterForm = forwardRef<RegisterFormRef, RegisterFormProps>(
  function RegisterForm(
    { className, needsInvitationCode, onSubmitButtonClicked, ...props },
    ref
  ) {
    const { t } = useTranslation();
    const [isRegistering, setIsRegistering] = useState(false);
    const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
    const [confirmError, setConfirmError] = useState<string | null>(null);
    const [userNameError, setUserNameError] = useState<string | null>(null);
    const [serverError, setServerError] = useState<string | null>(null);
    const userNameInputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      setRegistering: (registering: boolean) => {
        setIsRegistering(registering);
      },
      setError: (error: string | null) => {
        setServerError(error);
      }
    }));

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setUserNameError(null);
      setPasswordErrors([]);
      setConfirmError(null);
      setServerError(null);

      const formData = new FormData(e.currentTarget);
      const fullName = (formData.get('fullName') as string).trim();
      const userName = (formData.get('userName') as string).trim();
      const email = (formData.get('email') as string).trim();
      const password = formData.get('password') as string;
      const passwordConfirm = formData.get('passwordConfirm') as string;
      const invitationCode = needsInvitationCode
        ? (formData.get('invitationCode') as string)?.trim()
        : undefined;

      // Validate userName (alphanumeric only)
      const userNameValidation = validateUserName(userName);
      if (userNameValidation) {
        setUserNameError(t(userNameValidation));
        return;
      }

      // Validate password
      const pwErrorKeys = validatePassword(password);
      if (pwErrorKeys.length > 0) {
        setPasswordErrors(pwErrorKeys.map(key => t(key)));
        return;
      }

      // Validate password confirmation
      if (password !== passwordConfirm) {
        setConfirmError(t('register_password_mismatch'));
        return;
      }

      onSubmitButtonClicked?.({
        fullName: fullName || '',
        userName,
        email,
        password,
        invitationCode: invitationCode || undefined
      });
    };

    return (
      <div className={cn('flex flex-col gap-6', className)} {...props}>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl" data-testid="register-card-title">
              {t('register')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                {needsInvitationCode && (
                  <Field>
                    <FieldLabel
                      htmlFor="invitationCode"
                      data-testid="register-invitation-code-label"
                    >
                      {t('register_invitation_code')}
                    </FieldLabel>
                    <Input
                      id="invitationCode"
                      name="invitationCode"
                      type="text"
                      required
                      data-testid="register-invitation-code-input"
                    />
                  </Field>
                )}
                <Field>
                  <FieldLabel htmlFor="fullName">
                    {t('register_full_name')}
                  </FieldLabel>
                  <Input
                    id="fullName"
                    name="fullName"
                    type="text"
                    maxLength={FULL_NAME_MAX_LENGTH}
                    data-testid="register-full-name-input"
                  />
                </Field>
                <Field data-invalid={!!userNameError || undefined}>
                  <FieldLabel htmlFor="userName">
                    {t('register_user_name')}
                  </FieldLabel>
                  <Input
                    id="userName"
                    name="userName"
                    type="text"
                    ref={userNameInputRef}
                    maxLength={USER_NAME_MAX_LENGTH}
                    data-testid="register-user-name-input"
                    required
                    pattern="[a-zA-Z0-9]+"
                    aria-invalid={!!userNameError || undefined}
                  />
                  {userNameError && <FieldError>{userNameError}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel htmlFor="email">{t('register_email')}</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    maxLength={EMAIL_MAX_LENGTH}
                    required
                    data-testid="register-email-input"
                  />
                </Field>
                <Field data-invalid={passwordErrors.length > 0 || undefined}>
                  <FieldLabel htmlFor="password">
                    {t('register_password')}
                  </FieldLabel>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    maxLength={PASSWORD_MAX_LENGTH}
                    required
                    aria-invalid={passwordErrors.length > 0 || undefined}
                    data-testid="register-password-input"
                  />
                  {passwordErrors.length > 0 && (
                    <FieldError>
                      <ul className="ml-4 flex list-disc flex-col gap-1">
                        {passwordErrors.map(error => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    </FieldError>
                  )}
                </Field>
                <Field data-invalid={!!confirmError || undefined}>
                  <FieldLabel htmlFor="passwordConfirm">
                    {t('register_password_confirm')}
                  </FieldLabel>
                  <Input
                    id="passwordConfirm"
                    name="passwordConfirm"
                    type="password"
                    maxLength={PASSWORD_MAX_LENGTH}
                    required
                    aria-invalid={!!confirmError || undefined}
                    data-testid="register-password-confirm-input"
                  />
                  {confirmError && <FieldError>{confirmError}</FieldError>}
                </Field>
                {serverError && <FieldError>{serverError}</FieldError>}
                <Field>
                  <Button
                    type="submit"
                    disabled={isRegistering}
                    data-testid="register-submit-button"
                  >
                    {isRegistering ? t('registering') : t('register')}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
            <div className="mt-6 text-center text-sm">
              <Link
                to="/login"
                className="text-primary underline underline-offset-4 hover:opacity-80"
                data-testid="register-back-to-login-link"
              >
                {t('register_back_to_login')}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
);
