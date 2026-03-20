import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import { GetUsersResponseSchema } from './schemas';
import type { GetUsersResponse } from './schemas';

export async function getUsers(): Promise<GetUsersResponse> {
  try {
    const response = await axios.get('/api/settings/users');
    return GetUsersResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function deleteUser(id: string): Promise<void> {
  try {
    await axios.delete(`/api/settings/users/${id}`);
  } catch (error) {
    handleApiError(error);
  }
}
