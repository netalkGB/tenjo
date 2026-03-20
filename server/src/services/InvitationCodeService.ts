import type { InvitationCodeRepository } from '../repositories/InvitationCodeRepository';
import type { UserRole } from '../types/api';
import { ServiceError } from '../errors/ServiceError';

export class InvitationCodeNotFoundError extends ServiceError {
  constructor(message: string = 'Invitation code not found') {
    super(message);
  }
}

export class InvitationCodeValidationError extends ServiceError {}

export interface InvitationCodeInfo {
  id: string;
  code: string;
  userRole: UserRole;
  used: boolean;
  createdAt: string | null;
}

export class InvitationCodeService {
  constructor(private invitationCodeRepo: InvitationCodeRepository) {}

  async listAll(): Promise<InvitationCodeInfo[]> {
    const codes = await this.invitationCodeRepo.findAll();
    return codes.map((c) => ({
      id: c.id,
      code: c.code,
      userRole: c.user_role,
      used: c.used,
      createdAt: c.created_at?.toISOString() ?? null
    }));
  }

  async create(
    userRole: UserRole,
    createdBy: string
  ): Promise<InvitationCodeInfo> {
    if (userRole !== 'admin' && userRole !== 'standard') {
      throw new InvitationCodeValidationError(
        'userRole must be "admin" or "standard"'
      );
    }

    const newCode = await this.invitationCodeRepo.create({
      user_role: userRole,
      created_by: createdBy
    });

    return {
      id: newCode.id,
      code: newCode.code,
      userRole: newCode.user_role,
      used: newCode.used,
      createdAt: newCode.created_at?.toISOString() ?? null
    };
  }

  async delete(id: string): Promise<void> {
    const success = await this.invitationCodeRepo.delete(id);
    if (!success) {
      throw new InvitationCodeNotFoundError();
    }
  }
}
