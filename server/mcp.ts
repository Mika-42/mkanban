import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { boardInputSchema, cardInputSchema, cardPatchSchema, columnInputSchema, columnDeletionSchema, idSchema, splitSchema } from './schema.js';
import { Store } from './store.js';

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
  server.registerTool('get_board', { description: 'Read a full board, its columns, cards and computed totals.', inputSchema: { boardId }, annotations: read }, ({ boardId }) => result(async () => {
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
  server.registerTool('create_card', { description: 'Create a card. Checklist entries need unique IDs (use UUIDs). Dates use YYYY-MM-DD.', inputSchema: { boardId, columnId, ...cardInputSchema.shape }, annotations: write }, ({ boardId, columnId, ...values }) => result(() => store.createCard(boardId, columnId, values)));
  server.registerTool('update_card', { description: 'Patch card fields, completion, story points, flags, members or checklist. Arrays replace the existing array. Read first. expectedUpdatedAt optionally protects against concurrent edits.', inputSchema: { boardId, cardId, expectedUpdatedAt: z.string().optional(), ...cardPatchSchema.shape }, annotations: write }, ({ boardId, cardId, expectedUpdatedAt, ...patch }) => result(() => store.updateCard(boardId, cardId, patch, expectedUpdatedAt)));
  server.registerTool('move_card', { description: 'Move a card within/between columns in the same board, to a zero-based index in the destination after removal.', inputSchema: { boardId, cardId, columnId, index: z.number().int().nonnegative() }, annotations: write }, ({ boardId, cardId, columnId, index }) => result(() => store.moveCard(boardId, cardId, columnId, index)));
  server.registerTool('delete_card', { description: 'Permanently delete a card. Requires user confirmation.', inputSchema: { boardId, cardId }, annotations: destructive }, ({ boardId, cardId }) => result(() => store.deleteCard(boardId, cardId)));
  server.registerTool('split_card', { description: 'Split into a new adjacent card. Transfer selected checklist IDs and points from source; points cannot exceed source points. Description, flags, members and date are copied.', inputSchema: { boardId, cardId, ...splitSchema.shape }, annotations: write }, ({ boardId, cardId, ...values }) => result(() => store.splitCard(boardId, cardId, values)));
  server.registerResource('boards', 'kanban://boards', { description: 'All local Kanban boards', mimeType: 'application/json' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await store.listBoards()) }] }));
  server.registerResource('board', new ResourceTemplate('kanban://boards/{boardId}', { list: undefined }), { description: 'A complete board JSON document', mimeType: 'application/json' }, async (uri, { boardId }) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await store.getBoard(String(boardId))) }] }));
  return server;
}
