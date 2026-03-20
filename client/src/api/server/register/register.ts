import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import {
  RegisterRequestSchema,
  RegisterResponseSchema,
  RegisterStatusResponseSchema
} from './schemas';
import type { RegisterResponse, RegisterStatusResponse } from './schemas';

export async function fetchRegisterStatus(): Promise<RegisterStatusResponse> {
  try {
    const response = await axios.get('/api/register/status');
    return RegisterStatusResponseSchema.parse(response.data);
  } catch (error) {
    handleApiError(error);
  }
}

export async function register(data: {
  fullName?: string;
  userName: string;
  email: string;
  password: string;
  invitationCode?: string;
}): Promise<RegisterResponse> {
  try {
    const requestData = RegisterRequestSchema.parse(data);

    const response = await axios.post('/api/register', requestData);

    const validatedResponse = RegisterResponseSchema.parse(response.data);
    return validatedResponse;
  } catch (error) {
    handleApiError(error);
  }
}
