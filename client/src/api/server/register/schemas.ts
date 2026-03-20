import { z } from 'zod';

export const RegisterRequestSchema = z.object({
  fullName: z.string().max(64).optional(),
  userName: z.string().min(1).max(32),
  email: z.string().min(1).max(100),
  password: z.string().min(8).max(64),
  invitationCode: z.string().uuid().optional()
});

export const RegisterResponseSchema = z.object({
  message: z.string()
});

export const RegisterStatusResponseSchema = z.object({
  needsInvitationCode: z.boolean()
});

export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;
export type RegisterStatusResponse = z.infer<
  typeof RegisterStatusResponseSchema
>;
