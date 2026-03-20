import { z } from 'zod';

export const LogoutResponseSchema = z.object({
  message: z.string()
});

export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
