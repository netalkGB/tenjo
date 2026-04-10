import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import {
  CleanupStatusResponseSchema,
  type CleanupStatusResponse,
  type StartCleanupResponse
} from './schemas';

export async function getCleanupStatus(): Promise<CleanupStatusResponse> {
  try {
    const response = await axios.get('/api/settings/cleanup-status');
    return CleanupStatusResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function startCleanup(): Promise<StartCleanupResponse> {
  try {
    const response = await axios.post('/api/settings/cleanup');
    return response.data as StartCleanupResponse;
  } catch (error) {
    handleApiError(error);
  }
}
