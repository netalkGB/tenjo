import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import { WhoamiResponseSchema } from './schemas';
import type { WhoamiResponse } from './schemas';

export async function fetchWhoami(): Promise<WhoamiResponse> {
  try {
    const response = await axios.get('/api/whoami');

    const validatedResponse = WhoamiResponseSchema.parse(response.data);
    return validatedResponse;
  } catch (error) {
    handleApiError(error);
  }
}
