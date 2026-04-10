import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  RegistrationService,
  RegistrationValidationError,
  RegistrationDuplicateError
} from '../RegistrationService';
import type { User, UserRepository } from '../../repositories/UserRepository';
import type {
  InvitationCode,
  InvitationCodeRepository
} from '../../repositories/InvitationCodeRepository';

vi.mock('../../utils/passwordHasher', () => ({
  hashPassword: vi.fn()
}));

vi.mock('../../utils/validation', () => ({
  validateUserName: vi.fn(),
  validateEmail: vi.fn(),
  validateFullName: vi.fn(),
  validatePassword: vi.fn()
}));

import { hashPassword } from '../../utils/passwordHasher';
import {
  validateUserName,
  validateEmail,
  validateFullName,
  validatePassword
} from '../../utils/validation';

function createMockUserRepo() {
  return {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findByUserName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    existsAdmin: vi.fn()
  };
}

function createMockInvitationCodeRepo() {
  return {
    findAll: vi.fn(),
    findByCode: vi.fn(),
    create: vi.fn(),
    markUsed: vi.fn(),
    delete: vi.fn(),
    pool: vi.fn(),
    insertReturning: vi.fn()
  };
}

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  full_name: 'Test User',
  user_name: 'testuser',
  email: 'test@example.com',
  password: '$argon2id$v=19$m=65536,t=3,p=4$salt$hash',
  user_role: 'standard',
  settings: {},
  created_by: null,
  updated_by: null,
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
  ...overrides
});

const makeInvitationCode = (
  overrides: Partial<InvitationCode> = {}
): InvitationCode => ({
  id: 'code-1',
  code: 'INVITE123',
  user_role: 'standard',
  used: false,
  used_by: null,
  created_by: 'admin-1',
  created_at: new Date('2025-01-01'),
  ...overrides
});

describe('RegistrationService', () => {
  let service: RegistrationService;
  let userRepo: ReturnType<typeof createMockUserRepo>;
  let invitationCodeRepo: ReturnType<typeof createMockInvitationCodeRepo>;

  beforeEach(() => {
    vi.resetAllMocks();
    userRepo = createMockUserRepo();
    invitationCodeRepo = createMockInvitationCodeRepo();
    service = new RegistrationService(
      userRepo as unknown as UserRepository,
      invitationCodeRepo as unknown as InvitationCodeRepository
    );

    // Default: all validations pass
    (validateUserName as Mock).mockReturnValue(null);
    (validateEmail as Mock).mockReturnValue(null);
    (validateFullName as Mock).mockReturnValue(null);
    (validatePassword as Mock).mockReturnValue([]);
  });

  // ---------- checkRegistrationStatus ----------
  describe('checkRegistrationStatus', () => {
    it('should return needsInvitationCode: true when admin exists', async () => {
      userRepo.existsAdmin.mockResolvedValue(true);

      const result = await service.checkRegistrationStatus();

      expect(result).toEqual({ needsInvitationCode: true });
      expect(userRepo.existsAdmin).toHaveBeenCalledOnce();
    });

    it('should return needsInvitationCode: false when no admin exists', async () => {
      userRepo.existsAdmin.mockResolvedValue(false);

      const result = await service.checkRegistrationStatus();

      expect(result).toEqual({ needsInvitationCode: false });
    });
  });

  // ---------- register ----------
  describe('register', () => {
    const validParams = {
      fullName: 'New User',
      userName: 'newuser',
      email: 'new@example.com',
      password: 'StrongPass1!'
    };

    // --- First user (admin) registration ---
    describe('first user registration (no admin exists)', () => {
      beforeEach(() => {
        userRepo.existsAdmin.mockResolvedValue(false);
        userRepo.findByUserName.mockResolvedValue(undefined);
        userRepo.findByEmail.mockResolvedValue(undefined);
        (hashPassword as Mock).mockResolvedValue('$argon2id$hashed');
        userRepo.create.mockResolvedValue(makeUser({ id: 'new-user-id' }));
      });

      it('should create the first user as admin without invitation code', async () => {
        await service.register(validParams);

        expect(userRepo.create).toHaveBeenCalledWith({
          full_name: 'New User',
          user_name: 'newuser',
          email: 'new@example.com',
          password: '$argon2id$hashed',
          user_role: 'admin'
        });
      });

      it('should not check or mark invitation codes for the first user', async () => {
        await service.register(validParams);

        expect(invitationCodeRepo.findByCode).not.toHaveBeenCalled();
        expect(invitationCodeRepo.markUsed).not.toHaveBeenCalled();
      });

      it('should set full_name to null when fullName is not provided', async () => {
        await service.register({
          userName: 'newuser',
          email: 'new@example.com',
          password: 'StrongPass1!'
        });

        expect(userRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ full_name: null })
        );
      });
    });

    // --- Subsequent user registration (admin exists) ---
    describe('subsequent user registration (admin exists)', () => {
      beforeEach(() => {
        userRepo.existsAdmin.mockResolvedValue(true);
        userRepo.findByUserName.mockResolvedValue(undefined);
        userRepo.findByEmail.mockResolvedValue(undefined);
        (hashPassword as Mock).mockResolvedValue('$argon2id$hashed');
        userRepo.create.mockResolvedValue(
          makeUser({ id: 'new-user-id', user_role: 'standard' })
        );
      });

      it('should create user with role from invitation code', async () => {
        invitationCodeRepo.findByCode.mockResolvedValue(
          makeInvitationCode({ user_role: 'standard' })
        );

        await service.register({ ...validParams, invitationCode: 'INVITE123' });

        expect(userRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ user_role: 'standard' })
        );
      });

      it('should create admin user when invitation code has admin role', async () => {
        invitationCodeRepo.findByCode.mockResolvedValue(
          makeInvitationCode({ user_role: 'admin' })
        );

        await service.register({
          ...validParams,
          invitationCode: 'ADMIN-CODE'
        });

        expect(userRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ user_role: 'admin' })
        );
      });

      it('should mark the invitation code as used after registration', async () => {
        invitationCodeRepo.findByCode.mockResolvedValue(makeInvitationCode());

        await service.register({ ...validParams, invitationCode: 'INVITE123' });

        expect(invitationCodeRepo.markUsed).toHaveBeenCalledWith(
          'INVITE123',
          'new-user-id'
        );
      });

      it('should throw RegistrationValidationError when invitation code is missing', async () => {
        await expect(service.register(validParams)).rejects.toThrow(
          RegistrationValidationError
        );

        await expect(service.register(validParams)).rejects.toThrow(
          'register_invitation_code_required'
        );
      });

      it('should throw RegistrationValidationError when invitation code is not found', async () => {
        invitationCodeRepo.findByCode.mockResolvedValue(undefined);

        await expect(
          service.register({ ...validParams, invitationCode: 'INVALID' })
        ).rejects.toThrow(RegistrationValidationError);

        invitationCodeRepo.findByCode.mockResolvedValue(undefined);

        await expect(
          service.register({ ...validParams, invitationCode: 'INVALID' })
        ).rejects.toThrow('register_invitation_code_invalid');
      });

      it('should throw RegistrationValidationError when invitation code is already used', async () => {
        invitationCodeRepo.findByCode.mockResolvedValue(
          makeInvitationCode({ used: true, used_by: 'other-user' })
        );

        await expect(
          service.register({ ...validParams, invitationCode: 'USED-CODE' })
        ).rejects.toThrow(RegistrationValidationError);

        invitationCodeRepo.findByCode.mockResolvedValue(
          makeInvitationCode({ used: true, used_by: 'other-user' })
        );

        await expect(
          service.register({ ...validParams, invitationCode: 'USED-CODE' })
        ).rejects.toThrow('register_invitation_code_invalid');
      });
    });

    // --- Validation errors ---
    describe('validation errors', () => {
      it('should throw RegistrationValidationError for invalid userName', async () => {
        (validateUserName as Mock).mockReturnValue(
          'register_user_name_invalid'
        );

        await expect(service.register(validParams)).rejects.toThrow(
          RegistrationValidationError
        );

        (validateUserName as Mock).mockReturnValue(
          'register_user_name_invalid'
        );

        await expect(service.register(validParams)).rejects.toThrow(
          'register_user_name_invalid'
        );
      });

      it('should throw RegistrationValidationError for invalid email', async () => {
        (validateEmail as Mock).mockReturnValue('register_email_invalid');

        await expect(service.register(validParams)).rejects.toThrow(
          RegistrationValidationError
        );
      });

      it('should throw RegistrationValidationError for invalid fullName', async () => {
        (validateFullName as Mock).mockReturnValue(
          'register_full_name_too_long'
        );

        await expect(service.register(validParams)).rejects.toThrow(
          RegistrationValidationError
        );
      });

      it('should throw RegistrationValidationError for invalid password', async () => {
        (validatePassword as Mock).mockReturnValue([
          'register_password_min_length'
        ]);

        await expect(service.register(validParams)).rejects.toThrow(
          RegistrationValidationError
        );

        (validatePassword as Mock).mockReturnValue([
          'register_password_min_length'
        ]);

        await expect(service.register(validParams)).rejects.toThrow(
          'Invalid password'
        );
      });

      it('should include password errors in the RegistrationValidationError', async () => {
        const passwordErrors = [
          'register_password_min_length',
          'register_password_uppercase'
        ];
        (validatePassword as Mock).mockReturnValue(passwordErrors);

        try {
          await service.register(validParams);
          expect.fail('Expected RegistrationValidationError');
        } catch (error) {
          expect(error).toBeInstanceOf(RegistrationValidationError);
          expect((error as RegistrationValidationError).errors).toEqual(
            passwordErrors
          );
        }
      });

      it('should validate userName before checking other fields', async () => {
        (validateUserName as Mock).mockReturnValue(
          'register_user_name_invalid'
        );

        await expect(service.register(validParams)).rejects.toThrow(
          RegistrationValidationError
        );

        // Should not proceed to email validation or repo calls
        expect(userRepo.findByUserName).not.toHaveBeenCalled();
        expect(userRepo.findByEmail).not.toHaveBeenCalled();
        expect(userRepo.create).not.toHaveBeenCalled();
      });
    });

    // --- Duplicate errors ---
    describe('duplicate errors', () => {
      beforeEach(() => {
        userRepo.existsAdmin.mockResolvedValue(false);
        (hashPassword as Mock).mockResolvedValue('$argon2id$hashed');
      });

      it('should throw RegistrationDuplicateError for duplicate userName', async () => {
        userRepo.findByUserName.mockResolvedValue(
          makeUser({ user_name: 'newuser' })
        );

        await expect(service.register(validParams)).rejects.toThrow(
          RegistrationDuplicateError
        );

        userRepo.findByUserName.mockResolvedValue(
          makeUser({ user_name: 'newuser' })
        );

        await expect(service.register(validParams)).rejects.toThrow(
          'register_user_name_already_exists'
        );
      });

      it('should throw RegistrationDuplicateError for duplicate email', async () => {
        userRepo.findByUserName.mockResolvedValue(undefined);
        userRepo.findByEmail.mockResolvedValue(
          makeUser({ email: 'new@example.com' })
        );

        await expect(service.register(validParams)).rejects.toThrow(
          RegistrationDuplicateError
        );

        userRepo.findByEmail.mockResolvedValue(
          makeUser({ email: 'new@example.com' })
        );

        await expect(service.register(validParams)).rejects.toThrow(
          'register_email_already_exists'
        );
      });

      it('should check userName duplicate before email duplicate', async () => {
        userRepo.findByUserName.mockResolvedValue(
          makeUser({ user_name: 'newuser' })
        );

        await expect(service.register(validParams)).rejects.toThrow(
          'register_user_name_already_exists'
        );

        // Should not check email when userName is already duplicate
        expect(userRepo.findByEmail).not.toHaveBeenCalled();
      });
    });

    // --- Password hashing ---
    describe('password hashing', () => {
      beforeEach(() => {
        userRepo.existsAdmin.mockResolvedValue(false);
        userRepo.findByUserName.mockResolvedValue(undefined);
        userRepo.findByEmail.mockResolvedValue(undefined);
        userRepo.create.mockResolvedValue(makeUser({ id: 'new-user-id' }));
      });

      it('should hash the password before storing', async () => {
        (hashPassword as Mock).mockResolvedValue('$argon2id$hashed-password');

        await service.register(validParams);

        expect(hashPassword).toHaveBeenCalledWith('StrongPass1!');
        expect(userRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ password: '$argon2id$hashed-password' })
        );
      });
    });
  });
});
