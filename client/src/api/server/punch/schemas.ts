import { z } from 'zod';

export const PunchSkillEnabledFilterSchema = z.enum([
  'all',
  'enabled',
  'disabled'
]);
export type PunchSkillEnabledFilter = z.infer<
  typeof PunchSkillEnabledFilterSchema
>;

export const PunchSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  createdAt: z.union([z.string(), z.null()]).optional(),
  updatedAt: z.union([z.string(), z.null()]).optional()
});
export type PunchSkill = z.infer<typeof PunchSkillSchema>;

export const PunchSkillListResponseSchema = z.object({
  skills: z.array(PunchSkillSchema),
  totalPages: z.number().optional(),
  currentPage: z.number().optional(),
  totalCount: z.number().optional()
});
export type PunchSkillListResponse = z.infer<
  typeof PunchSkillListResponseSchema
>;

export const PunchSkillPaginatedResponseSchema = z.object({
  skills: z.array(PunchSkillSchema),
  totalPages: z.number(),
  currentPage: z.number(),
  totalCount: z.number()
});
export type PunchSkillPaginatedResponse = z.infer<
  typeof PunchSkillPaginatedResponseSchema
>;

export const PunchEnabledSkillSchema = z.object({
  name: z.string(),
  description: z.string()
});
export type PunchEnabledSkill = z.infer<typeof PunchEnabledSkillSchema>;

export const PunchEnabledListResponseSchema = z.object({
  skills: z.array(PunchEnabledSkillSchema)
});
