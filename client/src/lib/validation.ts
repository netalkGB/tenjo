export const FULL_NAME_MAX_LENGTH = 64;
export const USER_NAME_MAX_LENGTH = 32;
export const EMAIL_MAX_LENGTH = 100;
export const PASSWORD_MAX_LENGTH = 64;
export const USER_NAME_PATTERN = /^[a-zA-Z0-9]+$/;

const PASSWORD_VALIDATION_RULES = [
  {
    test: (pw: string) => pw.length >= 8,
    key: 'register_password_min_length' as const
  },
  {
    test: (pw: string) => pw.length <= PASSWORD_MAX_LENGTH,
    key: 'register_password_max_length' as const
  },
  {
    test: (pw: string) => /[A-Z]/.test(pw),
    key: 'register_password_uppercase' as const
  },
  {
    test: (pw: string) => /[a-z]/.test(pw),
    key: 'register_password_lowercase' as const
  },
  {
    test: (pw: string) => /[0-9]/.test(pw),
    key: 'register_password_number' as const
  },
  {
    test: (pw: string) => /[^A-Za-z0-9]/.test(pw),
    key: 'register_password_symbol' as const
  }
];

export type PasswordErrorKey =
  (typeof PASSWORD_VALIDATION_RULES)[number]['key'];

export function validatePassword(password: string): PasswordErrorKey[] {
  return PASSWORD_VALIDATION_RULES.filter(rule => !rule.test(password)).map(
    rule => rule.key
  );
}

export function validateUserName(
  userName: string
): 'register_user_name_invalid' | null {
  if (!userName || !USER_NAME_PATTERN.test(userName)) {
    return 'register_user_name_invalid';
  }
  return null;
}

/**
 * Blank input is unset (`undefined`). A positive integer is that number.
 * Anything else is invalid (`null`).
 */
export function parseOptionalPositiveInt(
  value: string
): number | undefined | null {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
