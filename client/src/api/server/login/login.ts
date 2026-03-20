import axios from 'axios';
import { handleApiError } from '../../errors/handleApiError';
import { LoginRequestSchema, LoginResponseSchema } from './schemas';
import type { LoginResponse } from './schemas';

export async function login(
  username: string,
  password: string
): Promise<LoginResponse> {
  try {
    const requestData = LoginRequestSchema.parse({ username, password });

    const response = await axios.post('/api/login', requestData);

    const validatedResponse = LoginResponseSchema.parse(response.data);
    return validatedResponse;
  } catch (error) {
    handleApiError(error);
  }
}
