import axios from 'axios';
import { ApiError } from '../../errors/ApiError';
import { handleApiError } from '../../errors/handleApiError';
import {
  ProfileResponseSchema,
  UpdateProfileResponseSchema,
  UpdatePasswordResponseSchema
} from './schemas';
import type {
  ProfileResponse,
  UpdateProfileRequest,
  UpdatePasswordRequest
} from './schemas';

export async function getProfile(): Promise<ProfileResponse> {
  try {
    const response = await axios.get('/api/settings/profile');
    return ProfileResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function updateProfile(
  data: UpdateProfileRequest
): Promise<{ success: boolean }> {
  try {
    const response = await axios.patch('/api/settings/profile', data);
    return UpdateProfileResponseSchema.parse(response.data);
  } catch (error) {
    // Prioritize the detail field (per API spec)
    if (axios.isAxiosError(error)) {
      throw new ApiError(
        error.response?.data?.detail || error.response?.data?.message || null,
        error.response?.status || null
      );
    }
    handleApiError(error);
  }
}

export async function updatePassword(
  data: UpdatePasswordRequest
): Promise<{ success: boolean; errors?: string[] }> {
  try {
    const response = await axios.patch('/api/settings/profile/password', data);
    return UpdatePasswordResponseSchema.parse(response.data);
  } catch (error) {
    // Case where a validation error array is returned (per API spec)
    if (axios.isAxiosError(error)) {
      const responseData = error.response?.data;
      if (responseData?.errors) {
        return { success: false, errors: responseData.errors };
      }
      throw new ApiError(
        responseData?.detail || responseData?.message || null,
        error.response?.status || null
      );
    }
    handleApiError(error);
  }
}
