import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import { LogoutResponseSchema } from './schemas';
import type { LogoutResponse } from './schemas';

export async function logout(): Promise<LogoutResponse> {
  try {
    const response = await axios.post('/api/logout');

    const validatedResponse = LogoutResponseSchema.parse(response.data);
    return validatedResponse;
  } catch (error) {
    handleApiError(error);
  }
}
