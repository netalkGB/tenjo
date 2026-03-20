import { z } from 'zod';

export const LoginRequestSchema = z.object({
  username: z.string(),
  password: z.string()
});

export const LoginResponseSchema = z.object({
  message: z.string()
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
