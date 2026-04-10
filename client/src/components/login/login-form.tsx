import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Link } from 'react-router';

interface LoginFormProps extends React.ComponentProps<'div'> {
  onSubmitButtonClicked?: (data: { id: string; password: string }) => void;
}

export interface LoginFormRef {
  setLoggingIn: (isLoggingIn: boolean) => void;
  resetPassword: () => void;
  focusIdInput: () => void;
}

export const LoginForm = forwardRef<LoginFormRef, LoginFormProps>(
  function LoginForm({ className, onSubmitButtonClicked, ...props }, ref) {
    const { t } = useTranslation();
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const passwordInputRef = useRef<HTMLInputElement>(null);
    const idInputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      setLoggingIn: (loggingIn: boolean) => {
        setIsLoggingIn(loggingIn);
      },
      resetPassword: () => {
        if (passwordInputRef.current) {
          passwordInputRef.current.value = '';
          passwordInputRef.current.focus();
        }
      },
      focusIdInput: () => {
        if (idInputRef.current) {
          idInputRef.current.focus();
        }
      }
    }));

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const id = formData.get('id') as string;
      const password = formData.get('password') as string;
      onSubmitButtonClicked?.({ id, password });
    };

    return (
      <div className={cn('flex flex-col gap-6', className)} {...props}>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{t('login')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="id">{t('id')}</FieldLabel>
                  <Input
                    id="id"
                    name="id"
                    type="text"
                    ref={idInputRef}
                    required
                    data-testid="login-form-id-input"
                  />
                </Field>
                <Field>
                  <div className="flex items-center">
                    <FieldLabel htmlFor="password">{t('password')}</FieldLabel>
                  </div>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    required
                    ref={passwordInputRef}
                    data-testid="login-form-password-input"
                  />
                </Field>
                <Field>
                  <Button
                    type="submit"
                    disabled={isLoggingIn}
                    data-testid="login-form-submit-button"
                  >
                    {isLoggingIn ? t('logging_in') : t('login')}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
            <div className="mt-6 text-center text-sm">
              <Link
                to="/register"
                className="text-primary underline underline-offset-4 hover:opacity-80"
                data-testid="login-form-register-link"
              >
                {t('register_link')}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
);
