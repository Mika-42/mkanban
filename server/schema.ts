import { z } from 'zod';

export const idSchema = z.string().min(1).max(100);
const title = z.string().trim().min(1, 'Le titre est obligatoire').max(200);
export const checklistItemSchema = z.object({
  id: idSchema, text: z.string().trim().min(1).max(1000), done: z.boolean(),
});
export const cardInputSchema = z.object({
  title,
  description: z.string().max(100_000).default(''),
  points: z.number().int().min(0).max(999).default(0),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
    const date = new Date(v); return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === v;
  }, 'Date invalide').nullable().default(null),
  flags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  members: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  completed: z.boolean().default(false),
  checklist: z.array(checklistItemSchema).max(200).refine(items => new Set(items.map(i => i.id)).size === items.length, 'Identifiants de checklist dupliqués').default([]),
});
export const cardPatchSchema = cardInputSchema.partial();
export const boardInputSchema = z.object({ title, description: z.string().max(1000).default(''), color: z.enum(['violet', 'blue', 'green', 'rose']).default('violet') });
export const columnInputSchema = z.object({ title, color: z.enum(['gray', 'blue', 'violet', 'green', 'orange', 'rose']).default('gray') });
export const moveSchema = z.object({ index: z.number().int().min(0), columnId: idSchema });
export const splitSchema = z.object({ title, points: z.number().int().min(0).max(999), checklistIds: z.array(idSchema).default([]) });

export type CardInput = z.infer<typeof cardInputSchema>;
export type Card = CardInput & { id: string; columnId: string; position: number; createdAt: string; updatedAt: string };
export type Column = z.infer<typeof columnInputSchema> & { id: string; boardId: string; position: number; cards: Card[] };
export type BoardSummary = z.infer<typeof boardInputSchema> & { id: string; createdAt: string };
export type Board = BoardSummary & { schemaVersion: 1; columns: Column[] };
