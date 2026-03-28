import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import { UserPreferencesResponseSchema } from './schemas';
import type {
  UserPreferencesResponse,
  UpdatePreferencesRequest
} from './schemas';

export async function getPreferences(): Promise<UserPreferencesResponse> {
  try {
    const response = await axios.get('/api/settings/preferences');
    return UserPreferencesResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function updatePreferences(
  data: UpdatePreferencesRequest
): Promise<{ success: boolean }> {
  try {
    const response = await axios.patch('/api/settings/preferences', data);
    return response.data as { success: boolean };
  } catch (error) {
    handleApiError(error);
  }
}
