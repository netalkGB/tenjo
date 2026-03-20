import axios from 'axios';
import { z } from 'zod';
import { handleApiError } from '../../errors/handleApiError';
import {
  ApiThreadSchema,
  GetThreadsResponseSchema,
  GetThreadsParamsSchema,
  CreateThreadResponseSchema
} from './schemas';
import type {
  GetThreadsParams,
  GetThreadsResponse,
  ApiThread,
  CreateThreadResponse
} from './schemas';

export async function getThreads(
  params: GetThreadsParams = {}
): Promise<GetThreadsResponse> {
  try {
    const validatedParams = GetThreadsParamsSchema.parse(params);

    const response = await axios.get<GetThreadsResponse>('/api/chat/threads', {
      params: validatedParams
    });

    const validatedResponse = GetThreadsResponseSchema.parse(response.data);
    return validatedResponse;
  } catch (error) {
    handleApiError(error);
  }
}

export async function createThread(): Promise<CreateThreadResponse> {
  try {
    const response = await axios.post<CreateThreadResponse>(
      '/api/chat/threads/create'
    );

    const validatedResponse = CreateThreadResponseSchema.parse(response.data);
    return validatedResponse;
  } catch (error) {
    handleApiError(error);
  }
}

export async function renameThread(
  threadId: string,
  title: string
): Promise<ApiThread> {
  try {
    const response = await axios.patch<{ thread: ApiThread }>(
      `/api/chat/threads/${threadId}`,
      { title }
    );

    const validatedResponse = ApiThreadSchema.parse(response.data.thread);
    return validatedResponse;
  } catch (error) {
    handleApiError(error);
  }
}

export async function getPinnedThreads(): Promise<{ threads: ApiThread[] }> {
  try {
    const response = await axios.get<{ threads: ApiThread[] }>(
      '/api/chat/threads/pinned'
    );

    const validated = z
      .object({ threads: z.array(ApiThreadSchema) })
      .parse(response.data);
    return validated;
  } catch (error) {
    handleApiError(error);
  }
}

export async function pinThread(
  threadId: string,
  pinned: boolean
): Promise<ApiThread> {
  try {
    const response = await axios.patch<{ thread: ApiThread }>(
      `/api/chat/threads/${threadId}/pin`,
      { pinned }
    );

    const validatedResponse = ApiThreadSchema.parse(response.data.thread);
    return validatedResponse;
  } catch (error) {
    handleApiError(error);
  }
}

export async function deleteThread(threadId: string): Promise<void> {
  try {
    await axios.delete(`/api/chat/threads/${threadId}`);
  } catch (error) {
    handleApiError(error);
  }
}
