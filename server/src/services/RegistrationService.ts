import type { UserRepository } from '../repositories/UserRepository';
import type { InvitationCodeRepository } from '../repositories/InvitationCodeRepository';
import { ServiceError } from '../errors/ServiceError';
import {
  validatePassword,
  validateUserName,
  validateFullName,
  validateEmail
} from '../utils/validation';
import { hashPassword } from '../utils/passwordHasher';

export class RegistrationValidationError extends ServiceError {}

export class RegistrationDuplicateError extends ServiceError {}

interface RegisterParams {
  fullName?: string;
  userName: string;
  email: string;
  password: string;
  invitationCode?: string;
}

export class RegistrationService {
  constructor(
    private userRepo: UserRepository,
    private invitationCodeRepo: InvitationCodeRepository
  ) {}

  async checkRegistrationStatus(): Promise<{ needsInvitationCode: boolean }> {
    const hasAdmin = await this.userRepo.existsAdmin();
    return { needsInvitationCode: hasAdmin };
  }

  async register(params: RegisterParams): Promise<void> {
    const { fullName, userName, email, password, invitationCode } = params;

    const userNameError = validateUserName(userName);
    if (userNameError) {
      throw new RegistrationValidationError(userNameError);
    }

    const emailError = validateEmail(email);
    if (emailError) {
      throw new RegistrationValidationError(emailError);
    }

    const fullNameError = validateFullName(fullName ?? '');
    if (fullNameError) {
      throw new RegistrationValidationError(fullNameError);
    }

    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      throw new RegistrationValidationError('Invalid password', passwordErrors);
    }

    const existingUserName = await this.userRepo.findByUserName(userName);
    if (existingUserName) {
      throw new RegistrationDuplicateError('register_user_name_already_exists');
    }

    const existingEmail = await this.userRepo.findByEmail(email);
    if (existingEmail) {
      throw new RegistrationDuplicateError('register_email_already_exists');
    }

    const hasAdmin = await this.userRepo.existsAdmin();

    let userRole: 'admin' | 'standard' = 'standard';

    if (!hasAdmin) {
      userRole = 'admin';
    } else {
      if (!invitationCode) {
        throw new RegistrationValidationError(
          'register_invitation_code_required'
        );
      }

      const code = await this.invitationCodeRepo.findByCode(invitationCode);

      if (!code || code.used) {
        throw new RegistrationValidationError(
          'register_invitation_code_invalid'
        );
      }

      userRole = code.user_role;
    }

    const hashedPassword = await hashPassword(password);

    const newUser = await this.userRepo.create({
      full_name: fullName || null,
      user_name: userName,
      email,
      password: hashedPassword,
      user_role: userRole
    });

    if (hasAdmin && invitationCode) {
      await this.invitationCodeRepo.markUsed(invitationCode, newUser.id);
    }
  }
}
