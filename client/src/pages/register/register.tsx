import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from '@/hooks/useTranslation';
import {
  RegisterForm,
  RegisterFormRef,
  RegisterFormData
} from '@/components/register/register-form';
import { register, fetchRegisterStatus } from '@/api/server/register';
import { ApiError } from '@/api/errors/ApiError';

export function Register() {
  const registerFormRef = useRef<RegisterFormRef>(null);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [needsInvitationCode, setNeedsInvitationCode] = useState<
    boolean | null
  >(null);

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    fetchRegisterStatus()
      .then(status => setNeedsInvitationCode(status.needsInvitationCode))
      .catch(() => setNeedsInvitationCode(true));
  });

  const handleRegister = async (data: RegisterFormData) => {
    registerFormRef.current?.setRegistering(true);
    registerFormRef.current?.setError(null);

    try {
      await register({
        fullName: data.fullName || undefined,
        userName: data.userName,
        email: data.email,
        password: data.password,
        invitationCode: data.invitationCode
      });

      navigate('/login');
    } catch (error) {
      if (error instanceof ApiError && error.message) {
        registerFormRef.current?.setError(
          t(
            error.message as
              | 'register_email_already_exists'
              | 'register_user_name_already_exists'
              | 'register_user_name_invalid'
              | 'register_invitation_code_required'
              | 'register_invitation_code_invalid'
              | 'register_failed'
          )
        );
      } else {
        registerFormRef.current?.setError(t('register_failed'));
      }
      registerFormRef.current?.setRegistering(false);
    }
  };

  if (needsInvitationCode === null) {
    return null;
  }

  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="md:w-100 w-full px-6">
        <RegisterForm
          ref={registerFormRef}
          needsInvitationCode={needsInvitationCode}
          onSubmitButtonClicked={handleRegister}
        />
      </div>
    </div>
  );
}
