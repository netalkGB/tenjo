import axios from 'axios';
import { z } from 'zod';
import { ApiError } from './ApiError';
import { ClientSideValidationError } from './ClientSideValidationError';

export function handleApiError(error: unknown): never {
  if (error instanceof z.ZodError) {
    throw new ClientSideValidationError(error.message);
  }
  if (axios.isAxiosError(error)) {
    throw new ApiError(
      error.response?.data?.detail || error.response?.data?.message || null,
      error.response?.status || null
    );
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new ApiError(null, null);
}
