import { z } from 'zod';

export const idSchema = z.string().min(1).max(100);
const title = z.string().trim().min(1, 'Le titre est obligatoire').max(200);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const date = new Date(v); return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === v;
}, 'Date invalide');
export const dependencySchema = z.array(idSchema).max(200).refine(ids => new Set(ids).size === ids.length, 'Dépendances dupliquées');
export const checklistItemSchema = z.object({
  id: idSchema, text: z.string().trim().min(1).max(1000), done: z.boolean(),
});
export const cardInputSchema = z.object({
  title,
  description: z.string().max(100_000).default(''),
  points: z.number().int().min(0).max(999).default(0),
  startDate: dateSchema.nullable().default(null),
  dueDate: dateSchema.nullable().default(null),
  dependencies: dependencySchema.default([]),
  flags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  members: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  completed: z.boolean().default(false),
  checklist: z.array(checklistItemSchema).max(200).refine(items => new Set(items.map(i => i.id)).size === items.length, 'Identifiants de checklist dupliqués').default([]),
});
export const cardPatchSchema = cardInputSchema.partial();
export const scheduleChangeSchema = z.object({ cardId: idSchema, startDate: dateSchema.nullable().optional(), dueDate: dateSchema.nullable().optional(), dependencies: dependencySchema.optional(), expectedUpdatedAt: z.string().optional() });
export const scheduleUpdateSchema = z.object({ changes: z.array(scheduleChangeSchema).min(1).max(1000) });
export const autoScheduleSchema = z.object({ projectStart: dateSchema, defaultDurationDays: z.number().int().min(1).max(365).default(1), includeCompleted: z.boolean().default(false), dryRun: z.boolean().default(true), expectedRevision: z.string().optional() });
export const ganttQuerySchema = z.object({ startDate: dateSchema.optional(), endDate: dateSchema.optional(), today: dateSchema.optional(), dayWidth: z.number().min(2).max(80).default(28), format: z.enum(['json', 'csv', 'svg']).default('json') });
export const boardInputSchema = z.object({ title, description: z.string().max(1000).default(''), color: z.enum(['violet', 'blue', 'green', 'rose']).default('violet') });
export const columnInputSchema = z.object({ title, color: z.enum(['gray', 'blue', 'violet', 'green', 'orange', 'rose']).default('gray') });
export const columnDeletionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('empty') }),
  z.object({ mode: z.literal('move'), targetColumnId: idSchema }),
  z.object({ mode: z.literal('delete'), expectedCardIds: z.array(idSchema) }),
]);
export const moveSchema = z.object({ index: z.number().int().min(0), columnId: idSchema });
export const splitSchema = z.object({ title, points: z.number().int().min(0).max(999), checklistIds: z.array(idSchema).default([]), expectedUpdatedAt: z.string().optional() });
export const pointSnapshotSchema = z.object({
  at: z.string().datetime(),
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
}).refine(value => value.completed <= value.total, 'Les points terminés dépassent le total');
export const pointHistorySchema = z.array(pointSnapshotSchema).refine(
  entries => entries.every((entry, index) => index === 0 || Date.parse(entry.at) > Date.parse(entries[index - 1].at)),
  'Les observations doivent être dans l’ordre chronologique',
).default([]);

export type CardInput = z.infer<typeof cardInputSchema>;
export type Card = CardInput & { id: string; columnId: string; position: number; createdAt: string; updatedAt: string };
export type Column = z.infer<typeof columnInputSchema> & { id: string; boardId: string; position: number; cards: Card[] };
export type BoardSummary = z.infer<typeof boardInputSchema> & { id: string; createdAt: string };
export type PointSnapshot = z.infer<typeof pointSnapshotSchema>;
export type Board = BoardSummary & { schemaVersion: 1; columns: Column[]; pointHistory: PointSnapshot[] };
