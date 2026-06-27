import type {
  UserRepository,
  User,
  UpdateUser
} from '../repositories/UserRepository';
import type { UserRole } from '../types/api';
import { ServiceError } from '../errors/ServiceError';

export class UserNotFoundError extends ServiceError {
  constructor(message: string = 'User not found') {
    super(message);
  }
}

export class UserValidationError extends ServiceError {}

export class UserDuplicateError extends ServiceError {}
import {
  validatePassword,
  validateUserName,
  validateFullName
} from '../utils/validation';
import { isDevelopment } from '../utils/env';
import { hashPassword, verifyPassword } from '../utils/passwordHasher';

export interface ProfileInfo {
  fullName: string;
  userName: string;
}

interface UpdateProfileParams {
  fullName?: string;
  userName?: string;
}

export interface UserListItem {
  id: string;
  fullName: string;
  userName: string;
  userRole: UserRole;
}

export class UserService {
  constructor(private userRepo: UserRepository) {}

  async listAll(): Promise<UserListItem[]> {
    const allUsers = await this.userRepo.findAll();
    return allUsers.map((u: User) => ({
      id: u.id,
      fullName: u.full_name ?? '',
      userName: u.user_name,
      userRole: u.user_role as UserRole
    }));
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.userRepo.delete(id);
  }

  async getActiveModelId(userId: string): Promise<string | undefined> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UserNotFoundError();
    }
    return user.settings?.activeModelId;
  }

  async getProfile(userId: string): Promise<ProfileInfo> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    return {
      fullName: user.full_name ?? '',
      userName: user.user_name
    };
  }

  async updateProfile(
    userId: string,
    params: UpdateProfileParams
  ): Promise<{ userName?: string }> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    const updates: UpdateUser = {};

    if (params.fullName !== undefined) {
      const fullNameError = validateFullName(params.fullName);
      if (fullNameError) {
        throw new UserValidationError(fullNameError);
      }
      updates.full_name = params.fullName || null;
    }

    if (params.userName !== undefined && params.userName !== user.user_name) {
      const userNameError = validateUserName(params.userName);
      if (userNameError) {
        throw new UserValidationError(userNameError);
      }
      const existing = await this.userRepo.findByUserName(params.userName);
      if (existing) {
        throw new UserDuplicateError('register_user_name_already_exists');
      }
      updates.user_name = params.userName;
    }

    if (Object.keys(updates).length === 0) {
      return {};
    }

    updates.updated_by = userId;
    await this.userRepo.update(userId, updates);

    return { userName: updates.user_name };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    if (!currentPassword || !newPassword) {
      throw new UserValidationError(
        'settings_profile_current_password_required'
      );
    }

    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    let isValid = false;
    if (user.password.startsWith('$argon2')) {
      isValid = await verifyPassword(user.password, currentPassword);
    } else if (isDevelopment()) {
      isValid = user.password === currentPassword;
    }
    if (!isValid) {
      throw new UserValidationError(
        'settings_profile_current_password_incorrect'
      );
    }

    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      throw new UserValidationError('Invalid password', passwordErrors);
    }

    const hashedPassword = await hashPassword(newPassword);

    await this.userRepo.update(userId, {
      password: hashedPassword,
      updated_by: userId
    });
  }

  async getUserPreferences(userId: string): Promise<{
    language?: string;
    theme?: string;
    selectedKnowledgeIds?: string[];
    disabledMcpTools?: string[];
    executeCodeEnabled?: boolean;
    webSearchEnabled?: boolean;
    webSearchExtendedTimeoutEnabled?: boolean;
  }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new UserNotFoundError();
    return {
      language: user.settings?.language,
      theme: user.settings?.theme,
      selectedKnowledgeIds: user.settings?.selectedKnowledgeIds,
      disabledMcpTools: user.settings?.disabledMcpTools,
      executeCodeEnabled: user.settings?.executeCodeEnabled,
      webSearchEnabled: user.settings?.webSearchEnabled,
      webSearchExtendedTimeoutEnabled:
        user.settings?.webSearchExtendedTimeoutEnabled
    };
  }

  async updateUserPreferences(
    userId: string,
    preferences: {
      language?: string;
      theme?: string;
      selectedKnowledgeIds?: string[];
      disabledMcpTools?: string[];
      executeCodeEnabled?: boolean;
      webSearchEnabled?: boolean;
      webSearchExtendedTimeoutEnabled?: boolean;
    }
  ): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new UserNotFoundError();

    // Only merge defined values to avoid overwriting existing fields with undefined
    const merged = { ...user.settings };
    if (preferences.language !== undefined) {
      merged.language = preferences.language;
    }
    if (preferences.theme !== undefined) {
      merged.theme = preferences.theme;
    }
    if (preferences.selectedKnowledgeIds !== undefined) {
      merged.selectedKnowledgeIds = preferences.selectedKnowledgeIds;
    }
    if (preferences.disabledMcpTools !== undefined) {
      merged.disabledMcpTools = preferences.disabledMcpTools;
    }
    if (preferences.executeCodeEnabled !== undefined) {
      merged.executeCodeEnabled = preferences.executeCodeEnabled;
    }
    if (preferences.webSearchEnabled !== undefined) {
      merged.webSearchEnabled = preferences.webSearchEnabled;
    }
    if (preferences.webSearchExtendedTimeoutEnabled !== undefined) {
      merged.webSearchExtendedTimeoutEnabled =
        preferences.webSearchExtendedTimeoutEnabled;
    }

    await this.userRepo.update(userId, { settings: merged });
  }

  async setActiveModel(userId: string, activeId: string): Promise<void> {
    if (typeof activeId !== 'string') {
      throw new UserValidationError('activeId is required');
    }

    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    await this.userRepo.update(userId, {
      settings: { ...user.settings, activeModelId: activeId }
    });
  }
}
