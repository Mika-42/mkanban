import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { autoScheduleSchema, boardInputSchema, cardInputSchema, cardPatchSchema, columnInputSchema, columnDeletionSchema, idSchema, pointHistorySchema, scheduleUpdateSchema, splitSchema, type Board, type BoardSummary, type Card, type Column } from './schema.js';
import { buildGantt, orderedCards, planAutomatically } from '../shared/planning.js';

export class StoreError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const storedCardSchema = cardInputSchema.extend({ id: idSchema, columnId: idSchema, position: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string() });
const storedColumnSchema = columnInputSchema.extend({ id: idSchema, boardId: idSchema, position: z.number().int().nonnegative(), cards: z.array(storedCardSchema) });
const storedBoardSchema = boardInputSchema.extend({ schemaVersion: z.literal(1), id: z.string().uuid(), createdAt: z.string(), columns: z.array(storedColumnSchema), pointHistory: pointHistorySchema });
const nextTimestamp = (current: string) => new Date(Math.max(Date.now(), Date.parse(current) + 1)).toISOString();

/** One UTF-8 JSON document per board. Atomic replacement + interprocess lock. */
export class Store {
  readonly directory: string;
  constructor(directory = process.env.DATA_DIR || path.resolve('data/boards'), private readonly now: () => Date = () => new Date()) { this.directory = path.resolve(directory); }
  async init() { await mkdir(this.directory, { recursive: true }); }
  private file(id: string) {
    if (!z.string().uuid().safeParse(id).success) throw new StoreError('Tableau introuvable', 404);
    return path.join(this.directory, `${id}.json`);
  }
  private async readBoard(id: string): Promise<Board> {
    try {
      const board = storedBoardSchema.parse(JSON.parse(await readFile(this.file(id), 'utf8')));
      if (board.id !== id) throw new StoreError('Le nom du fichier ne correspond pas à son tableau', 500);
      orderedCards(board);
      return board;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new StoreError('Tableau introuvable', 404);
      throw e;
    }
  }
  async getBoard(id: string): Promise<Board> {
    const board = await this.readBoard(id);
    if (!this.needsSnapshot(board)) return board;
    // Migrate legacy JSON only once, under the same lock used by all writers.
    return this.locked(async () => {
      const latest = await this.readBoard(id);
      if (this.recordPoints(latest)) await this.write(latest);
      return latest;
    });
  }
  private totals(board: Board) {
    return board.columns.flatMap(c => c.cards).reduce((sum, card) => ({ total: sum.total + card.points, completed: sum.completed + (card.completed ? card.points : 0) }), { total: 0, completed: 0 });
  }
  private needsSnapshot(board: Board) {
    const previous = board.pointHistory.at(-1);
    const current = this.totals(board);
    return !previous || previous.total !== current.total || previous.completed !== current.completed;
  }
  private recordPoints(board: Board) {
    if (!this.needsSnapshot(board)) return false;
    const previous = board.pointHistory.at(-1);
    const at = new Date(Math.max(this.now().valueOf(), previous ? Date.parse(previous.at) + 1 : 0)).toISOString();
    board.pointHistory.push({ at, ...this.totals(board) });
    return true;
  }
  async listBoards(): Promise<BoardSummary[]> {
    await this.init();
    const files = (await readdir(this.directory)).filter(f => /^[\da-f-]{36}\.json$/i.test(f));
    const boards = await Promise.all(files.map(f => this.getBoard(f.slice(0, -5))));
    return boards.map(({ columns: _, schemaVersion: __, pointHistory: ___, ...board }) => board).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    await this.init();
    const release = await lockfile.lock(this.directory, { retries: { retries: 40, minTimeout: 10, maxTimeout: 100 }, stale: 10_000 });
    try { return await operation(); } finally { await release(); }
  }
  private async write(board: Board) {
    const target = this.file(board.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(board, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  }
  private async mutate<T>(boardId: string, change: (board: Board) => T): Promise<T> {
    return this.locked(async () => {
      const board = await this.readBoard(boardId);
      this.recordPoints(board);
      const result = change(board);
      this.normalize(board);
      orderedCards(board);
      this.recordPoints(board);
      await this.write(board);
      return result;
    });
  }
  private normalize(board: Board) {
    board.columns.forEach((column, position) => {
      column.position = position;
      column.cards.forEach((card, i) => { card.position = i; card.columnId = column.id; });
    });
  }
  private column(board: Board, id: string): Column {
    const column = board.columns.find(c => c.id === id);
    if (!column) throw new StoreError('Colonne introuvable', 404);
    return column;
  }
  private card(board: Board, id: string) {
    for (const column of board.columns) {
      const card = column.cards.find(c => c.id === id);
      if (card) return { card, column };
    }
    throw new StoreError('Carte introuvable', 404);
  }
  private cleanDependencies(board: Board, removed: Set<string>) {
    for (const card of board.columns.flatMap(c => c.cards)) {
      if (card.dependencies.some(id => removed.has(id))) {
        card.dependencies = card.dependencies.filter(id => !removed.has(id));
        card.updatedAt = nextTimestamp(card.updatedAt);
      }
    }
  }
  private scheduleRevision(board: Board) {
    return createHash('sha256').update(JSON.stringify(board.columns.flatMap(c => c.cards).map(c => [c.id, c.startDate, c.dueDate, c.dependencies, c.completed, c.updatedAt]))).digest('hex');
  }
  async getGantt(boardId: string) { return buildGantt(await this.getBoard(boardId)); }
  async updateSchedule(boardId: string, input: unknown) {
    const { changes } = scheduleUpdateSchema.parse(input);
    if (new Set(changes.map(c => c.cardId)).size !== changes.length) throw new StoreError('Une fiche figure plusieurs fois dans la mise à jour');
    return this.mutate(boardId, board => {
      for (const { cardId, expectedUpdatedAt, ...patch } of changes) {
        const { card } = this.card(board, cardId);
        if (expectedUpdatedAt && card.updatedAt !== expectedUpdatedAt) throw new StoreError('Le planning a changé. Rechargez les fiches avant de réessayer.', 409);
        Object.assign(card, patch, { updatedAt: nextTimestamp(card.updatedAt) });
      }
      return buildGantt(board);
    });
  }
  async autoSchedule(boardId: string, input: unknown) {
    const options = autoScheduleSchema.parse(input);
    const plan = (board: Board) => {
      const revision = this.scheduleRevision(board);
      if (options.expectedRevision && options.expectedRevision !== revision) throw new StoreError('Le planning a changé. Générez un nouvel aperçu avant de confirmer.', 409);
      const changes = planAutomatically(board, options);
      return { revision, changes, applied: !options.dryRun };
    };
    if (options.dryRun) return plan(await this.getBoard(boardId));
    return this.mutate(boardId, board => {
      const result = plan(board);
      for (const change of result.changes) Object.assign(this.card(board, change.cardId).card, { startDate: change.startDate, dueDate: change.dueDate, updatedAt: nextTimestamp(this.card(board, change.cardId).card.updatedAt) });
      return result;
    });
  }
  async createBoard(input: unknown): Promise<Board> {
    const values = boardInputSchema.parse(input);
    return this.locked(async () => {
      const board: Board = { ...values, schemaVersion: 1, id: randomUUID(), createdAt: this.now().toISOString(), columns: [], pointHistory: [] };
      this.recordPoints(board);
      await this.write(board); return board;
    });
  }
  async updateBoard(boardId: string, input: unknown) {
    const patch = boardInputSchema.partial().parse(input);
    return this.mutate(boardId, board => Object.assign(board, patch));
  }
  async deleteBoard(boardId: string) {
    return this.locked(async () => { await this.readBoard(boardId); await unlink(this.file(boardId)); return { deleted: true }; });
  }
  async createColumn(boardId: string, input: unknown) {
    const values = columnInputSchema.parse(input);
    return this.mutate(boardId, board => {
      const column: Column = { ...values, id: randomUUID(), boardId, position: board.columns.length, cards: [] };
      board.columns.push(column); return column;
    });
  }
  async updateColumn(boardId: string, columnId: string, input: unknown) {
    const patch = columnInputSchema.partial().parse(input);
    return this.mutate(boardId, board => Object.assign(this.column(board, columnId), patch));
  }
  async moveColumn(boardId: string, columnId: string, index: number) {
    z.number().int().nonnegative().parse(index);
    return this.mutate(boardId, board => {
      const column = this.column(board, columnId);
      board.columns.splice(board.columns.indexOf(column), 1);
      board.columns.splice(Math.min(index, board.columns.length), 0, column);
      return column;
    });
  }
  async deleteColumn(boardId: string, columnId: string, input: unknown = { mode: 'empty' }) {
    const options = columnDeletionSchema.parse(input);
    return this.mutate(boardId, board => {
      const column = this.column(board, columnId);
      const count = column.cards.length;
      if (options.mode === 'empty' && count) throw new StoreError('Déplacez les cartes ou confirmez leur suppression avant de supprimer cette colonne', 409);
      if (options.mode === 'delete') {
        const expected = new Set(options.expectedCardIds);
        if (expected.size !== options.expectedCardIds.length || expected.size !== count || column.cards.some(card => !expected.has(card.id))) {
          throw new StoreError('Les fiches de cette colonne ont changé. Vérifiez son contenu avant de confirmer à nouveau.', 409);
        }
      }
      if (options.mode === 'move') {
        if (options.targetColumnId === columnId) throw new StoreError('Choisissez une autre colonne pour déplacer les fiches');
        const target = this.column(board, options.targetColumnId);
        for (const card of column.cards) card.updatedAt = nextTimestamp(card.updatedAt);
        target.cards.push(...column.cards);
      }
      board.columns.splice(board.columns.indexOf(column), 1);
      if (options.mode !== 'move') this.cleanDependencies(board, new Set(column.cards.map(c => c.id)));
      return { deleted: true, movedCards: options.mode === 'move' ? count : 0, deletedCards: options.mode === 'delete' ? count : 0 };
    });
  }
  async getCard(boardId: string, cardId: string) { return this.card(await this.getBoard(boardId), cardId).card; }
  async createCard(boardId: string, columnId: string, input: unknown) {
    const values = cardInputSchema.parse(input);
    return this.mutate(boardId, board => {
      const column = this.column(board, columnId);
      const now = new Date().toISOString();
      const card: Card = { ...values, id: randomUUID(), columnId, position: column.cards.length, createdAt: now, updatedAt: now };
      column.cards.push(card); return card;
    });
  }
  async updateCard(boardId: string, cardId: string, input: unknown, expectedUpdatedAt?: string) {
    const patch = cardPatchSchema.parse(input);
    return this.mutate(boardId, board => {
      const { card } = this.card(board, cardId);
      if (expectedUpdatedAt && expectedUpdatedAt !== card.updatedAt) throw new StoreError('Cette carte a changé. Fermez et rouvrez-la avant de réessayer.', 409);
      Object.assign(card, patch, { updatedAt: nextTimestamp(card.updatedAt) }); return card;
    });
  }
  async moveCard(boardId: string, cardId: string, columnId: string, index: number) {
    z.number().int().nonnegative().parse(index);
    return this.mutate(boardId, board => {
      const target = this.column(board, columnId);
      const { card, column } = this.card(board, cardId);
      column.cards.splice(column.cards.indexOf(card), 1);
      target.cards.splice(Math.min(index, target.cards.length), 0, card);
      card.updatedAt = nextTimestamp(card.updatedAt); return card;
    });
  }
  async deleteCard(boardId: string, cardId: string) {
    return this.mutate(boardId, board => {
      const { card, column } = this.card(board, cardId);
      column.cards.splice(column.cards.indexOf(card), 1);
      this.cleanDependencies(board, new Set([cardId]));
      return { deleted: true };
    });
  }
  async splitCard(boardId: string, cardId: string, input: unknown) {
    const values = splitSchema.parse(input);
    return this.mutate(boardId, board => {
      const { card, column } = this.card(board, cardId);
      if (values.expectedUpdatedAt && values.expectedUpdatedAt !== card.updatedAt) throw new StoreError('Cette carte a changé. Fermez et rouvrez le découpage avant de réessayer.', 409);
      if (values.points > card.points) throw new StoreError('La nouvelle carte ne peut pas recevoir plus de points que la carte source');
      const ids = new Set(values.checklistIds);
      if (ids.size !== values.checklistIds.length || [...ids].some(id => !card.checklist.some(i => i.id === id))) throw new StoreError('Éléments de checklist invalides');
      const now = nextTimestamp(card.updatedAt);
      const newCard: Card = { ...structuredClone(card), id: randomUUID(), title: values.title, points: values.points, checklist: card.checklist.filter(i => ids.has(i.id)), completed: false, createdAt: now, updatedAt: now };
      card.checklist = card.checklist.filter(i => !ids.has(i.id));
      card.points -= values.points; card.updatedAt = now;
      column.cards.splice(column.cards.indexOf(card) + 1, 0, newCard);
      return { original: card, created: newCard };
    });
  }
}
