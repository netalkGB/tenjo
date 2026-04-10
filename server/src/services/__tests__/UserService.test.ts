import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  UserService,
  UserNotFoundError,
  UserValidationError,
  UserDuplicateError
} from '../UserService';
import type { User, UserRepository } from '../../repositories/UserRepository';

vi.mock('../../utils/passwordHasher', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn()
}));

vi.mock('../../utils/validation', () => ({
  validateUserName: vi.fn(),
  validateFullName: vi.fn(),
  validateEmail: vi.fn(),
  validatePassword: vi.fn()
}));

vi.mock('../../utils/env', () => ({
  isDevelopment: vi.fn()
}));

import { hashPassword, verifyPassword } from '../../utils/passwordHasher';
import {
  validateUserName,
  validateFullName,
  validateEmail,
  validatePassword
} from '../../utils/validation';
import { isDevelopment } from '../../utils/env';

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

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  full_name: 'Test User',
  user_name: 'testuser',
  email: 'test@example.com',
  password: '$argon2id$v=19$m=65536,t=3,p=4$salt$hash',
  user_role: 'standard',
  settings: { activeModelId: 'model-1', language: 'en', theme: 'dark' },
  created_by: null,
  updated_by: null,
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
  ...overrides
});

describe('UserService', () => {
  let service: UserService;
  let repo: ReturnType<typeof createMockUserRepo>;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = createMockUserRepo();
    service = new UserService(repo as unknown as UserRepository);

    // Default: validation passes
    (validateUserName as Mock).mockReturnValue(null);
    (validateFullName as Mock).mockReturnValue(null);
    (validateEmail as Mock).mockReturnValue(null);
    (validatePassword as Mock).mockReturnValue([]);
  });

  // ---------- listAll ----------
  describe('listAll', () => {
    it('should return mapped user list', async () => {
      const users: User[] = [
        makeUser({
          id: 'u1',
          full_name: 'Alice',
          user_name: 'alice',
          email: 'alice@test.com',
          user_role: 'admin'
        }),
        makeUser({
          id: 'u2',
          full_name: null,
          user_name: 'bob',
          email: 'bob@test.com',
          user_role: 'standard'
        })
      ];
      repo.findAll.mockResolvedValue(users);

      const result = await service.listAll();

      expect(result).toEqual([
        {
          id: 'u1',
          fullName: 'Alice',
          userName: 'alice',
          email: 'alice@test.com',
          userRole: 'admin'
        },
        {
          id: 'u2',
          fullName: '',
          userName: 'bob',
          email: 'bob@test.com',
          userRole: 'standard'
        }
      ]);
      expect(repo.findAll).toHaveBeenCalledOnce();
    });
  });

  // ---------- deleteUser ----------
  describe('deleteUser', () => {
    it('should return true when user is deleted', async () => {
      repo.delete.mockResolvedValue(true);

      const result = await service.deleteUser('user-1');

      expect(result).toBe(true);
      expect(repo.delete).toHaveBeenCalledWith('user-1');
    });

    it('should return false when user is not found', async () => {
      repo.delete.mockResolvedValue(false);

      const result = await service.deleteUser('nonexistent');

      expect(result).toBe(false);
    });
  });

  // ---------- getActiveModelId ----------
  describe('getActiveModelId', () => {
    it('should return the active model id', async () => {
      repo.findById.mockResolvedValue(
        makeUser({ settings: { activeModelId: 'gpt-4' } })
      );

      const result = await service.getActiveModelId('user-1');

      expect(result).toBe('gpt-4');
    });

    it('should return undefined when no active model is set', async () => {
      repo.findById.mockResolvedValue(makeUser({ settings: {} }));

      const result = await service.getActiveModelId('user-1');

      expect(result).toBeUndefined();
    });

    it('should throw UserNotFoundError when user does not exist', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(service.getActiveModelId('unknown')).rejects.toThrow(
        UserNotFoundError
      );
    });
  });

  // ---------- getProfile ----------
  describe('getProfile', () => {
    it('should return profile info', async () => {
      repo.findById.mockResolvedValue(makeUser());

      const result = await service.getProfile('user-1');

      expect(result).toEqual({
        fullName: 'Test User',
        userName: 'testuser',
        email: 'test@example.com'
      });
    });

    it('should return empty string for null full_name', async () => {
      repo.findById.mockResolvedValue(makeUser({ full_name: null }));

      const result = await service.getProfile('user-1');

      expect(result.fullName).toBe('');
    });

    it('should throw UserNotFoundError when user does not exist', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(service.getProfile('unknown')).rejects.toThrow(
        UserNotFoundError
      );
    });
  });

  // ---------- updateProfile ----------
  describe('updateProfile', () => {
    it('should update userName and return it', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      repo.findByUserName.mockResolvedValue(undefined);
      repo.update.mockResolvedValue(makeUser({ user_name: 'newname' }));

      const result = await service.updateProfile('user-1', {
        userName: 'newname'
      });

      expect(result).toEqual({ userName: 'newname' });
      expect(repo.update).toHaveBeenCalledWith('user-1', {
        user_name: 'newname',
        updated_by: 'user-1'
      });
    });

    it('should update email', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      repo.findByEmail.mockResolvedValue(undefined);
      repo.update.mockResolvedValue(makeUser({ email: 'new@example.com' }));

      const result = await service.updateProfile('user-1', {
        email: 'new@example.com'
      });

      expect(result).toEqual({ userName: undefined });
      expect(repo.update).toHaveBeenCalledWith('user-1', {
        email: 'new@example.com',
        updated_by: 'user-1'
      });
    });

    it('should update fullName', async () => {
      repo.findById.mockResolvedValue(makeUser());
      repo.update.mockResolvedValue(makeUser({ full_name: 'New Name' }));

      await service.updateProfile('user-1', { fullName: 'New Name' });

      expect(repo.update).toHaveBeenCalledWith('user-1', {
        full_name: 'New Name',
        updated_by: 'user-1'
      });
    });

    it('should set full_name to null when empty string is provided', async () => {
      repo.findById.mockResolvedValue(makeUser());
      repo.update.mockResolvedValue(makeUser({ full_name: null }));

      await service.updateProfile('user-1', { fullName: '' });

      expect(repo.update).toHaveBeenCalledWith('user-1', {
        full_name: null,
        updated_by: 'user-1'
      });
    });

    it('should return empty object when nothing changes', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);

      // Same userName as existing
      const result = await service.updateProfile('user-1', {
        userName: 'testuser'
      });

      expect(result).toEqual({});
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('should throw UserValidationError for invalid userName', async () => {
      repo.findById.mockResolvedValue(makeUser());
      (validateUserName as Mock).mockReturnValue('register_user_name_invalid');

      await expect(
        service.updateProfile('user-1', { userName: 'bad name!' })
      ).rejects.toThrow(UserValidationError);
    });

    it('should throw UserValidationError for invalid email', async () => {
      repo.findById.mockResolvedValue(makeUser());
      (validateEmail as Mock).mockReturnValue('profile_email_required');

      await expect(
        service.updateProfile('user-1', { email: '' })
      ).rejects.toThrow(UserValidationError);
    });

    it('should throw UserValidationError for invalid fullName', async () => {
      repo.findById.mockResolvedValue(makeUser());
      (validateFullName as Mock).mockReturnValue('profile_full_name_too_long');

      await expect(
        service.updateProfile('user-1', { fullName: 'x'.repeat(100) })
      ).rejects.toThrow(UserValidationError);
    });

    it('should throw UserDuplicateError for duplicate userName', async () => {
      repo.findById.mockResolvedValue(makeUser());
      repo.findByUserName.mockResolvedValue(makeUser({ id: 'other-user' }));

      await expect(
        service.updateProfile('user-1', { userName: 'taken' })
      ).rejects.toThrow(UserDuplicateError);
    });

    it('should throw UserDuplicateError for duplicate email', async () => {
      repo.findById.mockResolvedValue(makeUser());
      repo.findByEmail.mockResolvedValue(makeUser({ id: 'other-user' }));

      await expect(
        service.updateProfile('user-1', { email: 'taken@example.com' })
      ).rejects.toThrow(UserDuplicateError);
    });

    it('should throw UserNotFoundError when user does not exist', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(
        service.updateProfile('unknown', { fullName: 'Name' })
      ).rejects.toThrow(UserNotFoundError);
    });
  });

  // ---------- changePassword ----------
  describe('changePassword', () => {
    it('should change password with argon2 hash verification', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      (verifyPassword as Mock).mockResolvedValue(true);
      (hashPassword as Mock).mockResolvedValue('$argon2id$newhash');

      await service.changePassword('user-1', 'oldPass1!', 'NewPass1!');

      expect(verifyPassword).toHaveBeenCalledWith(user.password, 'oldPass1!');
      expect(hashPassword).toHaveBeenCalledWith('NewPass1!');
      expect(repo.update).toHaveBeenCalledWith('user-1', {
        password: '$argon2id$newhash',
        updated_by: 'user-1'
      });
    });

    it('should allow plain text password comparison in development mode', async () => {
      const user = makeUser({ password: 'plaintext' });
      repo.findById.mockResolvedValue(user);
      (isDevelopment as Mock).mockReturnValue(true);
      (hashPassword as Mock).mockResolvedValue('$argon2id$newhash');

      await service.changePassword('user-1', 'plaintext', 'NewPass1!');

      expect(verifyPassword).not.toHaveBeenCalled();
      expect(hashPassword).toHaveBeenCalledWith('NewPass1!');
    });

    it('should throw UserValidationError when current password is wrong', async () => {
      repo.findById.mockResolvedValue(makeUser());
      (verifyPassword as Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', 'wrongPass', 'NewPass1!')
      ).rejects.toThrow(UserValidationError);
    });

    it('should throw UserValidationError when current password is empty', async () => {
      await expect(
        service.changePassword('user-1', '', 'NewPass1!')
      ).rejects.toThrow(UserValidationError);
    });

    it('should throw UserValidationError when new password is empty', async () => {
      await expect(
        service.changePassword('user-1', 'oldPass', '')
      ).rejects.toThrow(UserValidationError);
    });

    it('should reject when password is not argon2 and isDevelopment is false', async () => {
      const user = makeUser({ password: 'plaintext' });
      repo.findById.mockResolvedValue(user);
      (isDevelopment as Mock).mockReturnValue(false);

      await expect(
        service.changePassword('user-1', 'plaintext', 'NewPass1!')
      ).rejects.toThrow(UserValidationError);
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it('should throw UserNotFoundError when user does not exist', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(
        service.changePassword('unknown', 'old', 'new')
      ).rejects.toThrow(UserNotFoundError);
    });

    it('should throw UserValidationError when new password fails validation', async () => {
      repo.findById.mockResolvedValue(makeUser());
      (verifyPassword as Mock).mockResolvedValue(true);
      (validatePassword as Mock).mockReturnValue([
        'register_password_min_length'
      ]);

      await expect(
        service.changePassword('user-1', 'oldPass', 'short')
      ).rejects.toThrow(UserValidationError);
    });
  });

  // ---------- getUserPreferences ----------
  describe('getUserPreferences', () => {
    it('should return language and theme from user settings', async () => {
      repo.findById.mockResolvedValue(
        makeUser({ settings: { language: 'ja', theme: 'light' } })
      );

      const result = await service.getUserPreferences('user-1');

      expect(result).toEqual({ language: 'ja', theme: 'light' });
    });

    it('should return selectedKnowledgeIds from user settings', async () => {
      repo.findById.mockResolvedValue(
        makeUser({
          settings: {
            language: 'ja',
            theme: 'light',
            selectedKnowledgeIds: ['k1', 'k2']
          }
        })
      );

      const result = await service.getUserPreferences('user-1');

      expect(result).toEqual({
        language: 'ja',
        theme: 'light',
        selectedKnowledgeIds: ['k1', 'k2']
      });
    });

    it('should return undefined values when settings are empty', async () => {
      repo.findById.mockResolvedValue(makeUser({ settings: {} }));

      const result = await service.getUserPreferences('user-1');

      expect(result).toEqual({
        language: undefined,
        theme: undefined,
        selectedKnowledgeIds: undefined
      });
    });

    it('should throw UserNotFoundError when user does not exist', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(service.getUserPreferences('unknown')).rejects.toThrow(
        UserNotFoundError
      );
    });
  });

  // ---------- updateUserPreferences ----------
  describe('updateUserPreferences', () => {
    it('should merge language preference into existing settings', async () => {
      repo.findById.mockResolvedValue(
        makeUser({ settings: { activeModelId: 'model-1', theme: 'dark' } })
      );

      await service.updateUserPreferences('user-1', { language: 'ja' });

      expect(repo.update).toHaveBeenCalledWith('user-1', {
        settings: { activeModelId: 'model-1', theme: 'dark', language: 'ja' }
      });
    });

    it('should merge theme preference without overwriting language', async () => {
      repo.findById.mockResolvedValue(
        makeUser({ settings: { language: 'en' } })
      );

      await service.updateUserPreferences('user-1', { theme: 'light' });

      expect(repo.update).toHaveBeenCalledWith('user-1', {
        settings: { language: 'en', theme: 'light' }
      });
    });

    it('should merge selectedKnowledgeIds into existing settings', async () => {
      repo.findById.mockResolvedValue(
        makeUser({
          settings: { activeModelId: 'model-1', language: 'en', theme: 'dark' }
        })
      );

      await service.updateUserPreferences('user-1', {
        selectedKnowledgeIds: ['k1', 'k2']
      });

      expect(repo.update).toHaveBeenCalledWith('user-1', {
        settings: {
          activeModelId: 'model-1',
          language: 'en',
          theme: 'dark',
          selectedKnowledgeIds: ['k1', 'k2']
        }
      });
    });

    it('should overwrite selectedKnowledgeIds without affecting other fields', async () => {
      repo.findById.mockResolvedValue(
        makeUser({
          settings: {
            language: 'ja',
            theme: 'light',
            selectedKnowledgeIds: ['old-k1']
          }
        })
      );

      await service.updateUserPreferences('user-1', {
        selectedKnowledgeIds: ['new-k1', 'new-k2']
      });

      expect(repo.update).toHaveBeenCalledWith('user-1', {
        settings: {
          language: 'ja',
          theme: 'light',
          selectedKnowledgeIds: ['new-k1', 'new-k2']
        }
      });
    });

    it('should allow clearing selectedKnowledgeIds with empty array', async () => {
      repo.findById.mockResolvedValue(
        makeUser({
          settings: { language: 'en', selectedKnowledgeIds: ['k1'] }
        })
      );

      await service.updateUserPreferences('user-1', {
        selectedKnowledgeIds: []
      });

      expect(repo.update).toHaveBeenCalledWith('user-1', {
        settings: { language: 'en', selectedKnowledgeIds: [] }
      });
    });

    it('should not overwrite existing fields when preference is undefined', async () => {
      repo.findById.mockResolvedValue(
        makeUser({
          settings: {
            language: 'en',
            theme: 'dark',
            selectedKnowledgeIds: ['k1']
          }
        })
      );

      await service.updateUserPreferences('user-1', {});

      expect(repo.update).toHaveBeenCalledWith('user-1', {
        settings: {
          language: 'en',
          theme: 'dark',
          selectedKnowledgeIds: ['k1']
        }
      });
    });

    it('should throw UserNotFoundError when user does not exist', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(
        service.updateUserPreferences('unknown', { language: 'en' })
      ).rejects.toThrow(UserNotFoundError);
    });
  });

  // ---------- setActiveModel ----------
  describe('setActiveModel', () => {
    it('should merge activeModelId into existing settings', async () => {
      repo.findById.mockResolvedValue(
        makeUser({ settings: { language: 'en', theme: 'dark' } })
      );

      await service.setActiveModel('user-1', 'gpt-4o');

      expect(repo.update).toHaveBeenCalledWith('user-1', {
        settings: { language: 'en', theme: 'dark', activeModelId: 'gpt-4o' }
      });
    });

    it('should throw UserNotFoundError when user does not exist', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(service.setActiveModel('unknown', 'gpt-4o')).rejects.toThrow(
        UserNotFoundError
      );
    });

    it('should throw UserValidationError when activeId is not a string', async () => {
      await expect(
        service.setActiveModel('user-1', undefined as unknown as string)
      ).rejects.toThrow(UserValidationError);
    });
  });
});
