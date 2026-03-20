import { handleApiError } from '../../errors/handleApiError';
import axios from 'axios';

export async function approveToolCall(
  toolCallId: string,
  approved: boolean
): Promise<void> {
  try {
    await axios.post(`/api/chat/tools/${toolCallId}/approve`, { approved });
  } catch (error) {
    handleApiError(error);
  }
}
