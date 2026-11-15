import { z } from 'zod';

export const AGENT_NAMES = ['architect', 'designer', 'frontend', 'backend', 'qa', 'release'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const ProductSpecSchema = z.object({
  name: z.string().min(1).max(80),
  category: z.string().max(60),
  summary: z.string().max(1200),
  audience: z.string().max(400),
  pages: z
    .array(
      z.object({
        route: z.string().regex(/^\/[a-z0-9\-/]*$/),
        title: z.string().max(80),
        purpose: z.string().max(400),
        sections: z.array(z.string().max(200)).max(12),
      }),
    )
    .min(1)
    .max(15),
  entities: z.array(z.object({ name: z.string().max(60), fields: z.array(z.string().max(80)).max(30) })).max(20),
  integrations: z.array(z.object({ name: z.string().max(60), purpose: z.string().max(200), requiresCustomerConfig: z.boolean() })).max(15),
  securityNotes: z.array(z.string().max(300)).max(15),
});
export type ProductSpec = z.infer<typeof ProductSpecSchema>;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Plan-first mode: the architect's draft spec plus the few questions that would most change it. */
export const PlanDraftSchema = z.object({
  spec: ProductSpecSchema,
  questions: z.array(z.object({ id: z.string().regex(/^[a-z0-9_]{1,30}$/), question: z.string().max(300), why: z.string().max(300) })).max(5),
  assumptions: z.array(z.string().max(300)).max(10),
});
export type PlanDraft = z.infer<typeof PlanDraftSchema>;

/** Ask mode: an answer about the project. Never changes code. */
export const AskAnswerSchema = z.object({
  answer: z.string().min(1).max(6000),
  /** A ready-to-send change request, when the customer would likely want to act on the answer. */
  suggestedPrompt: z.string().max(600).nullable(),
});
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

export const DesignSpecSchema = z.object({
  tone: z.string().max(120),
  palette: z.object({ primary: hex, primaryForeground: hex, background: hex, surface: hex, text: hex, muted: hex, accent: hex, border: hex }),
  typography: z.object({ headingStack: z.string().max(200), bodyStack: z.string().max(200), scale: z.enum(['compact', 'comfortable', 'spacious']) }),
  radius: z.enum(['none', 'sm', 'md', 'lg', 'xl', 'full']),
  componentNotes: z.array(z.string().max(300)).max(15),
});
export type DesignSpec = z.infer<typeof DesignSpecSchema>;

/**
 * File changes as the model writes them. `content` is required (an empty string for "delete"): providers enforce
 * structured output only for required fields, and with an optional field a real model left out the code of most
 * new files on a large site. "update" with empty content on an existing file means "keep it".
 */
export const ModelPatchSchema = z.object({
  op: z.enum(['create', 'update', 'delete']),
  path: z.string().min(1).max(300),
  content: z.string().max(400_000),
  reason: z.string().max(500),
}).superRefine((p, ctx) => {
  if (p.op === 'create' && p.content === '') ctx.addIssue({ code: 'custom', path: ['content'], message: 'create needs the full file content' });
});

export const CodeChangeSchema = z.object({
  summary: z.string().max(1500),
  patches: z.array(ModelPatchSchema).max(60),
});
export type CodeChange = z.infer<typeof CodeChangeSchema>;

export const QaFixSchema = z.object({
  diagnosis: z.string().max(2000),
  patches: z.array(ModelPatchSchema).max(30),
});
export type QaFix = z.infer<typeof QaFixSchema>;
