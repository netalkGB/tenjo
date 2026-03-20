import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import {
  BranchStatusResponseSchema,
  ThreadMessagesResponseSchema
} from './schemas';
import type { BranchStatusResponse, ThreadMessagesResponse } from './schemas';

export async function getBranchStatus(
  threadId: string,
  messageIds: string[]
): Promise<BranchStatusResponse> {
  try {
    const response = await axios.post<BranchStatusResponse>(
      `/api/chat/threads/${threadId}/messages/branch-status`,
      { messageIds }
    );

    const validatedResponse = BranchStatusResponseSchema.parse(response.data);
    return validatedResponse;
  } catch (error) {
    handleApiError(error);
  }
}

export async function switchBranch(
  threadId: string,
  messageId: string,
  targetSiblingId: string
): Promise<ThreadMessagesResponse> {
  try {
    const response = await axios.post<ThreadMessagesResponse>(
      `/api/chat/threads/${threadId}/messages/${messageId}/switch-branch`,
      { targetSiblingId }
    );

    const validatedResponse = ThreadMessagesResponseSchema.parse(response.data);
    return validatedResponse;
  } catch (error) {
    handleApiError(error);
  }
}
