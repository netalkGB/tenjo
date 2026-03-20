export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;
export const USER_NAME_MAX_LENGTH = 32;
export const FULL_NAME_MAX_LENGTH = 64;
export const EMAIL_MAX_LENGTH = 100;

export const USER_NAME_PATTERN = /^[a-zA-Z0-9]+$/;

export function validateUserName(userName: string): string | null {
  if (!userName || !USER_NAME_PATTERN.test(userName)) {
    return 'register_user_name_invalid';
  }
  if (userName.length > USER_NAME_MAX_LENGTH) {
    return 'register_user_name_invalid';
  }
  return null;
}

export function validateFullName(fullName: string): string | null {
  if (fullName && fullName.length > FULL_NAME_MAX_LENGTH) {
    return 'profile_full_name_too_long';
  }
  return null;
}

export function validateEmail(email: string): string | null {
  if (!email) {
    return 'profile_email_required';
  }
  if (email.length > EMAIL_MAX_LENGTH) {
    return 'profile_email_too_long';
  }
  return null;
}

export function validatePassword(password: string): string[] {
  const errors: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push('register_password_min_length');
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push('register_password_max_length');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('register_password_uppercase');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('register_password_lowercase');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('register_password_number');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('register_password_symbol');
  }

  return errors;
}
