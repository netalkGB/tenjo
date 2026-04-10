import { z } from 'zod';

export const KnowledgeSchema = z.object({
  id: z.string(),
  name: z.string(),
  display_path: z.string(),
  fs_path: z.string(),
  created_by: z.string().nullable(),
  updated_by: z.string().nullable(),
  created_at: z
    .string()
    .nullable()
    .transform(val => (val ? new Date(val) : null)),
  updated_at: z
    .string()
    .nullable()
    .transform(val => (val ? new Date(val) : null))
});

export type Knowledge = z.infer<typeof KnowledgeSchema>;

export const KnowledgeListResponseSchema = z.array(KnowledgeSchema);

export const KnowledgePaginatedResponseSchema = z.object({
  entries: z.array(KnowledgeSchema),
  totalPages: z.number(),
  currentPage: z.number(),
  totalCount: z.number()
});

export type KnowledgePaginatedResponse = z.infer<
  typeof KnowledgePaginatedResponseSchema
>;

export const KnowledgeContentResponseSchema = z.object({
  content: z.string()
});
