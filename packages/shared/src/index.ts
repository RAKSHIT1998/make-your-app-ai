import { z } from 'zod';

/** Product categories a customer can create. Mirrors the Prisma ProjectType enum. */
export const ProjectTypeSchema = z.enum([
  'mobile_app',
  'website',
  'ecommerce',
  'business_website',
  'saas',
  'custom_software',
]);
export type ProjectType = z.infer<typeof ProjectTypeSchema>;

export const ProjectStatusSchema = z.enum(['draft', 'generating', 'ready', 'error', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const CreateProjectSchema = z.object({
  organizationId: z.uuid().optional(), // defaults to the caller's personal org
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(4000).default(''),
  type: ProjectTypeSchema,
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(4000),
    status: z.literal('archived'),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

export const ListProjectsQuerySchema = z.object({
  organizationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});

export const ProjectDtoSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string(),
  description: z.string(),
  type: ProjectTypeSchema,
  status: ProjectStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectDto = z.infer<typeof ProjectDtoSchema>;

export const StartGenerationSchema = z.object({
  prompt: z.string().trim().min(3).max(8000),
});
export type StartGenerationInput = z.infer<typeof StartGenerationSchema>;

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  mobile_app: 'Mobile app',
  website: 'Website',
  ecommerce: 'E-commerce store',
  business_website: 'Business website',
  saas: 'SaaS application',
  custom_software: 'Custom software',
};

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}
