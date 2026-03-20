import { z } from 'zod';

export const WhoamiResponseSchema = z.object({
  userName: z.string(),
  userRole: z.enum(['admin', 'standard']),
  singleUserMode: z.boolean()
});

export type WhoamiResponse = z.infer<typeof WhoamiResponseSchema>;
