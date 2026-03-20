import { useEffect, useRef } from 'react';
import { LoginForm, LoginFormRef } from '@/components/login/login-form';
import { login } from '@/api/server/login';

export function Login() {
  const loginFormRef = useRef<LoginFormRef>(null);

  const handleLogin = async (data: { id: string; password: string }) => {
    loginFormRef.current?.setLoggingIn(true);

    try {
      await login(data.id, data.password);
      // Reload page to get new CSRF token and replace history
      window.location.replace('/');
    } catch (_error) {
      // Reset password on error
      loginFormRef.current?.resetPassword();
      loginFormRef.current?.setLoggingIn(false);
    }
  };

  useEffect(() => {
    loginFormRef.current?.focusIdInput();
  }, []);

  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="md:w-100 w-full px-6">
        <LoginForm ref={loginFormRef} onSubmitButtonClicked={handleLogin} />
      </div>
    </div>
  );
}
