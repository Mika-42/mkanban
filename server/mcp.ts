import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { autoScheduleSchema, boardInputSchema, cardInputSchema, cardPatchSchema, columnInputSchema, columnDeletionSchema, ganttQuerySchema, idSchema, scheduleUpdateSchema, splitSchema } from './schema.js';
import { Store } from './store.js';
import { ganttCsv, ganttRange, ganttSvg } from '../shared/planning.js';

export function createMcpServer(store: Store) {
  const server = new McpServer({ name: 'mkanban', version: '1.0.0' }, {
    instructions: 'Manage local Kanban boards. Each board is a JSON file. Always read the current board before editing. IDs come from list_boards/get_board. Column totals are computed from cards. A completed card remains in its column. Splitting conserves total story points and transfers selected checklist items. Deletion is permanent: obtain user permission before deleting data.',
  });
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const destructive = { ...write, destructiveHint: true };
  const result = async (fn: () => Promise<unknown>) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await fn(), null, 2) }] }; }
    catch (e) { return { isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : 'Erreur inconnue' }] }; }
  };
  const boardId = idSchema.describe('Board UUID');
  const columnId = idSchema.describe('Column UUID');
  const cardId = idSchema.describe('Card UUID');
  server.registerTool('list_boards', { description: 'List local boards and their IDs.', inputSchema: {}, annotations: read }, () => result(() => store.listBoards()));
  server.registerTool('get_board', { description: 'Read a full board, its columns, cards, computed totals and pointHistory observations (at, total, completed). Point history starts when tracking was available; it does not reconstruct earlier progress.', inputSchema: { boardId }, annotations: read }, ({ boardId }) => result(async () => {
    const board = await store.getBoard(boardId);
    return { ...board, columns: board.columns.map(c => ({ ...c, cardCount: c.cards.length, totalPoints: c.cards.reduce((n, card) => n + card.points, 0) })) };
  }));
  server.registerTool('create_board', { description: 'Create an empty board as its own JSON file.', inputSchema: boardInputSchema.shape, annotations: write }, input => result(() => store.createBoard(input)));
  server.registerTool('update_board', { description: 'Rename a board or change its description/color.', inputSchema: { boardId, ...boardInputSchema.partial().shape }, annotations: write }, ({ boardId, ...patch }) => result(() => store.updateBoard(boardId, patch)));
  server.registerTool('delete_board', { description: 'Permanently delete a board and every card it contains. Requires user confirmation.', inputSchema: { boardId }, annotations: destructive }, ({ boardId }) => result(() => store.deleteBoard(boardId)));
  server.registerTool('create_column', { description: 'Append a column to a board.', inputSchema: { boardId, ...columnInputSchema.shape }, annotations: write }, ({ boardId, ...values }) => result(() => store.createColumn(boardId, values)));
  server.registerTool('update_column', { description: 'Rename or recolor a column.', inputSchema: { boardId, columnId, ...columnInputSchema.partial().shape }, annotations: write }, ({ boardId, columnId, ...patch }) => result(() => store.updateColumn(boardId, columnId, patch)));
  server.registerTool('move_column', { description: 'Move a column to a zero-based index.', inputSchema: { boardId, columnId, index: z.number().int().nonnegative() }, annotations: write }, ({ boardId, columnId, index }) => result(() => store.moveColumn(boardId, columnId, index)));
  server.registerTool('delete_column', { description: 'Delete a column. By default it must be empty. With user confirmation, options mode=move transfers all cards to targetColumnId before deleting, or mode=delete permanently removes the cards. For mode=delete, read the column first and pass its exact current card IDs as expectedCardIds; concurrent additions/removals are rejected.', inputSchema: { boardId, columnId, options: columnDeletionSchema.optional() }, annotations: destructive }, ({ boardId, columnId, options }) => result(() => store.deleteColumn(boardId, columnId, options)));
  server.registerTool('get_card', { description: 'Read one card, including Markdown and checklist.', inputSchema: { boardId, cardId }, annotations: read }, ({ boardId, cardId }) => result(() => store.getCard(boardId, cardId)));
  server.registerTool('create_card', { description: 'Create a card, optionally with startDate, dueDate and dependencies (predecessor card IDs in the same board). Checklist entries need unique IDs (use UUIDs). Dates use YYYY-MM-DD.', inputSchema: { boardId, columnId, ...cardInputSchema.shape }, annotations: write }, ({ boardId, columnId, ...values }) => result(() => store.createCard(boardId, columnId, values)));
  server.registerTool('update_card', { description: 'Patch card fields, completion, story points, flags, members, checklist, startDate, dueDate or dependencies (predecessor card IDs in this board). Dates are inclusive YYYY-MM-DD. Dependencies are finish-to-start. Self-links, cycles and references outside this board are rejected. Arrays replace the existing array. Read first. expectedUpdatedAt optionally protects against concurrent edits.', inputSchema: { boardId, cardId, expectedUpdatedAt: z.string().optional(), ...cardPatchSchema.shape }, annotations: write }, ({ boardId, cardId, expectedUpdatedAt, ...patch }) => result(() => store.updateCard(boardId, cardId, patch, expectedUpdatedAt)));
  server.registerTool('move_card', { description: 'Move a card within/between columns in the same board, to a zero-based index in the destination after removal.', inputSchema: { boardId, cardId, columnId, index: z.number().int().nonnegative() }, annotations: write }, ({ boardId, cardId, columnId, index }) => result(() => store.moveCard(boardId, cardId, columnId, index)));
  server.registerTool('delete_card', { description: 'Permanently delete a card. Requires user confirmation.', inputSchema: { boardId, cardId }, annotations: destructive }, ({ boardId, cardId }) => result(() => store.deleteCard(boardId, cardId)));
  server.registerTool('split_card', { description: 'Split into a new adjacent card. Transfer selected checklist IDs and points from source; points cannot exceed source points. Description, flags, members and date are copied.', inputSchema: { boardId, cardId, ...splitSchema.shape }, annotations: write }, ({ boardId, cardId, ...values }) => result(() => store.splitCard(boardId, cardId, values)));
  server.registerTool('get_gantt', { description: 'Read the Gantt plan: dates, inclusive calendar-day durations, finish-to-start links, blockedBy (unfinished predecessors), and scheduling conflicts. No dates means unscheduled; one date means a one-day milestone. Export the same plan as CSV or standalone SVG using format. SVG supports startDate/endDate and dayWidth zoom (28 day, 10 week, 3 month). Exported SVG is returned as text.', inputSchema: { boardId, ...ganttQuerySchema.shape }, annotations: read }, ({ boardId, ...options }) => result(async () => {
    const plan = await store.getGantt(boardId);
    if (options.format === 'csv') return { mimeType: 'text/csv', content: ganttCsv(plan) };
    if (options.format === 'svg') { const today = options.today ?? new Date().toISOString().slice(0, 10); return { mimeType: 'image/svg+xml', content: ganttSvg(plan, ganttRange(plan, today, options.startDate, options.endDate), options.dayWidth, today) }; }
    return plan;
  }));
  server.registerTool('update_schedule', { description: 'Atomically update dates and/or dependency arrays for multiple cards. Provide changes with cardId, startDate/dueDate (null clears a date), dependencies (replace all predecessor IDs), and optional expectedUpdatedAt. Validates final graph, rejecting cycles and unknown cards. Date overlaps are reported by get_gantt; use auto_schedule to resolve them.', inputSchema: { boardId, ...scheduleUpdateSchema.shape }, annotations: write }, ({ boardId, ...options }) => result(() => store.updateSchedule(boardId, options)));
  server.registerTool('auto_schedule', { description: 'Preview or apply dependency-aware scheduling. Default dryRun=true; first preview, then apply with dryRun=false and the returned revision passed as expectedRevision to reject stale previews. Existing dates are minimum start constraints; inclusive durations are preserved; undated cards use defaultDurationDays. Successors start at least one calendar day after predecessors end. Weekends count. Completed cards remain fixed unless includeCompleted=true. Does not change points or completion.', inputSchema: { boardId, ...autoScheduleSchema.shape }, annotations: write }, ({ boardId, ...options }) => result(() => store.autoSchedule(boardId, options)));
  server.registerResource('boards', 'kanban://boards', { description: 'All local Kanban boards', mimeType: 'application/json' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await store.listBoards()) }] }));
  server.registerResource('board', new ResourceTemplate('kanban://boards/{boardId}', { list: undefined }), { description: 'A complete board JSON document', mimeType: 'application/json' }, async (uri, { boardId }) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await store.getBoard(String(boardId))) }] }));
  return server;
}
