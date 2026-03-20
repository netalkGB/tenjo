import axios from 'axios';
import { z } from 'zod';
import { handleApiError } from '../../errors/handleApiError';
import {
  InvitationCodeSchema,
  GetInvitationCodesResponseSchema
} from './schemas';
import type {
  UserRole,
  InvitationCode,
  GetInvitationCodesResponse
} from './schemas';

export async function getInvitationCodes(): Promise<GetInvitationCodesResponse> {
  try {
    const response = await axios.get('/api/settings/invitation-codes');
    return GetInvitationCodesResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function createInvitationCode(
  userRole: UserRole
): Promise<InvitationCode> {
  try {
    const response = await axios.post('/api/settings/invitation-codes', {
      userRole
    });
    const validated = z
      .object({ code: InvitationCodeSchema })
      .parse(response.data);
    return validated.code;
  } catch (error) {
    handleApiError(error);
  }
}

export async function deleteInvitationCode(id: string): Promise<void> {
  try {
    await axios.delete(`/api/settings/invitation-codes/${id}`);
  } catch (error) {
    handleApiError(error);
  }
}
