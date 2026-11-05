import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { autoScheduleSchema, boardInputSchema, cardInputSchema, cardPatchSchema, columnInputSchema, columnDeletionSchema, idSchema, pointHistorySchema, scheduleUpdateSchema, splitSchema, type Board, type BoardSummary, type Card, type Column } from './schema.js';
import { buildGantt, orderedCards, planAutomatically } from '../shared/planning.js';
import { decisionInputSchema, decisionPatchSchema, decisionQuerySchema, storedDecisionSchema, type Decision, type DecisionInput } from './schema.js';
import { decisionAuthority, decisionPolicy, decisionTransitions, filterDecisions } from '../shared/decisions.js';
import { duplicateCardSchema } from './schema.js';
import { entityRefSchema, httpUrlSchema, impactReviewSchema, knowledgeInputSchema, knowledgePatchSchema, relationInputSchema, reviewPatchSchema, storedKnowledgeSchema, storedRelationSchema, type EntityRef, type KnowledgeItem } from './schema.js';
import { allRelations, analyzeImpact, describeEntity, relatedEntities, sameEntity } from '../shared/traceability.js';

export class StoreError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const storedCardSchema = cardInputSchema.extend({ id: idSchema, columnId: idSchema, position: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string() });
const storedColumnSchema = columnInputSchema.extend({ id: idSchema, boardId: idSchema, position: z.number().int().nonnegative(), cards: z.array(storedCardSchema) });
const storedBoardSchema = boardInputSchema.extend({ schemaVersion: z.literal(1), id: z.string().uuid(), createdAt: z.string(), columns: z.array(storedColumnSchema), pointHistory: pointHistorySchema, decisions: z.array(storedDecisionSchema).default([]), nextDecisionNumber: z.number().int().positive().default(1), knowledge: z.array(storedKnowledgeSchema).default([]), relations: z.array(storedRelationSchema).default([]), impactReviews: z.array(impactReviewSchema).default([]) });
const nextTimestamp = (current: string) => new Date(Math.max(Date.now(), Date.parse(current) + 1)).toISOString();
const decisionInputSnapshot = (decision: Decision): DecisionInput => {
  const { title, type, status, context, alternatives, outcome, rationale, consequences, tags, links, supersededBy } = decision;
  return { title, type, status, context, alternatives, outcome, rationale, consequences, tags, links, supersededBy };
};

/** One UTF-8 JSON document per board. Atomic replacement + interprocess lock. */
export class Store {
  readonly directory: string;
  constructor(directory = process.env.DATA_DIR || path.resolve('data/boards'), private readonly now: () => Date = () => new Date()) { this.directory = path.resolve(directory); }
  async init() { await mkdir(this.directory, { recursive: true }); }
  private file(id: string) {
    if (!z.string().uuid().safeParse(id).success) throw new StoreError('Projet introuvable', 404);
    return path.join(this.directory, `${id}.json`);
  }
  private async readBoard(id: string): Promise<Board> {
    try {
      const board = storedBoardSchema.parse(JSON.parse(await readFile(this.file(id), 'utf8')));
      if (board.id !== id) throw new StoreError('Le nom du fichier ne correspond pas à son projet', 500);
      if (new Set(board.decisions.map(d => d.number)).size !== board.decisions.length || new Set(board.decisions.map(d => d.id)).size !== board.decisions.length) throw new StoreError('Identifiants de décisions dupliqués', 500);
      board.nextDecisionNumber = Math.max(board.nextDecisionNumber, ...board.decisions.map(d => d.number + 1));
      orderedCards(board);
      return board;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new StoreError('Projet introuvable', 404);
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
    return boards.map(({ id, title, description, color, createdAt }) => ({ id, title, description, color, createdAt })).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
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
    board.relations = board.relations.filter(r => ![r.source, r.target].some(e => e.kind === 'card' && removed.has(e.id)));
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
      const board: Board = { ...values, schemaVersion: 1, id: randomUUID(), createdAt: this.now().toISOString(), columns: [], pointHistory: [], decisions: [], nextDecisionNumber: 1, knowledge: [], relations: [], impactReviews: [] };
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
  private decision(board: Board, decisionId: string) {
    const decision = board.decisions.find(d => d.id === decisionId);
    if (!decision) throw new StoreError('Décision introuvable', 404);
    return decision;
  }
  private checkDecision(board: Board, id: string, values: DecisionInput) {
    if (values.status === 'accepted' && (!values.outcome.trim() || !values.rationale.trim())) throw new StoreError('Renseignez la décision retenue et sa justification avant de la valider.');
    if (values.status === 'superseded') {
      const successor = board.decisions.find(d => d.id === values.supersededBy);
      const existing = board.decisions.find(d => d.id === id);
      const preservedLink = existing?.status === 'superseded' && existing.supersededBy === values.supersededBy;
      if (!successor || successor.id === id || !preservedLink && (successor.deletedAt || successor.status !== 'accepted')) throw new StoreError('Choisissez une autre décision validée et active pour remplacer celle-ci.');
    } else if (values.supersededBy !== null) throw new StoreError('Le successeur est réservé aux décisions remplacées.');
    const links = new Set<string>();
    for (const link of values.links) {
      const key = `${link.kind}:${link.target}`;
      if (links.has(key)) throw new StoreError('Lien dupliqué');
      links.add(key);
      if (link.kind === 'card' && !board.columns.some(c => c.cards.some(card => card.id === link.target))) {
        // Keep historical links when a previously linked card was deleted.
        if (!board.decisions.find(d => d.id === id)?.links.some(l => l.kind === 'card' && l.target === link.target)) throw new StoreError('La fiche liée doit appartenir à ce projet.');
      }
      if (link.kind === 'decision' && (link.target === id || !board.decisions.some(d => d.id === link.target))) throw new StoreError('Choisissez une autre décision de ce projet pour créer un lien.');
      if (link.kind === 'url') {
        try { if (!['https:', 'http:'].includes(new URL(link.target).protocol)) throw new Error(); }
        catch { throw new StoreError('Les documents doivent utiliser une adresse HTTP ou HTTPS valide.'); }
      }
    }
  }
  async listDecisions(boardId: string, input: unknown = {}) {
    const query = decisionQuerySchema.parse(input);
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) throw new StoreError('La date de début doit précéder la date de fin.');
    const board = await this.getBoard(boardId);
    const decisions = filterDecisions(board.decisions, query).map(d => ({ ...d, authority: decisionAuthority(d) }));
    return { decisions, matching: decisions.length, total: board.decisions.filter(d => !d.deletedAt).length, policy: decisionPolicy };
  }
  async getDecision(boardId: string, decisionId: string) {
    const decision = this.decision(await this.getBoard(boardId), decisionId);
    return { ...decision, authority: decisionAuthority(decision), policy: decisionPolicy };
  }
  async createDecision(boardId: string, input: unknown) {
    const values = decisionInputSchema.parse(input);
    return this.mutate(boardId, board => {
      if (values.status === 'superseded') throw new StoreError('Créez la décision avant de la remplacer.');
      const id = randomUUID(); this.checkDecision(board, id, values);
      const at = this.now().toISOString();
      const decision: Decision = { ...values, id, number: board.nextDecisionNumber++, createdAt: at, updatedAt: at, statusChangedAt: at, decidedAt: ['accepted', 'rejected'].includes(values.status) ? at : null, deletedAt: null, history: [{ at, action: 'created', fromStatus: null, snapshot: structuredClone(values) }] };
      board.decisions.push(decision);
      return { ...decision, authority: decisionAuthority(decision) };
    });
  }
  async updateDecision(boardId: string, decisionId: string, input: unknown, expectedUpdatedAt?: string) {
    const patch = decisionPatchSchema.parse(input);
    return this.mutate(boardId, board => {
      const decision = this.decision(board, decisionId);
      this.checkDecisionVersion(decision, expectedUpdatedAt);
      if (decision.deletedAt) throw new StoreError('Cette décision a été supprimée et son historique est en lecture seule.', 409);
      const values = decisionInputSchema.parse({ ...decisionInputSnapshot(decision), ...patch });
      if (values.status !== decision.status && !decisionTransitions[decision.status].includes(values.status)) throw new StoreError('Transition d’état non autorisée. Suivez le cycle de vie de la décision.');
      this.checkDecision(board, decisionId, values);
      if (JSON.stringify(values) === JSON.stringify(decisionInputSnapshot(decision))) return { ...decision, authority: decisionAuthority(decision) };
      const at = new Date(Math.max(this.now().valueOf(), Date.parse(decision.updatedAt) + 1)).toISOString();
      const previous = decision.status, previousSuccessor = decision.supersededBy;
      if (values.status !== previous) {
        decision.statusChangedAt = at;
        if (['accepted', 'rejected'].includes(values.status)) decision.decidedAt = at;
      }
      Object.assign(decision, values, { updatedAt: at });
      decision.history.push({ at, action: 'updated', fromStatus: previous, snapshot: structuredClone(values) });
      if (decision.status === 'superseded' && (previous !== 'superseded' || previousSuccessor !== decision.supersededBy)) this.recordImpact(board, decision.id, at);
      return { ...decision, authority: decisionAuthority(decision) };
    });
  }
  private checkDecisionVersion(decision: Decision, expectedUpdatedAt?: string) {
    if (expectedUpdatedAt && expectedUpdatedAt !== decision.updatedAt) throw new StoreError('Cette décision a changé. Fermez et rouvrez-la avant de réessayer.', 409);
  }
  async deleteDecision(boardId: string, decisionId: string, expectedUpdatedAt?: string) {
    return this.mutate(boardId, board => {
      const decision = this.decision(board, decisionId);
      this.checkDecisionVersion(decision, expectedUpdatedAt);
      if (!decision.deletedAt) {
        const at = new Date(Math.max(this.now().valueOf(), Date.parse(decision.updatedAt) + 1)).toISOString();
        decision.deletedAt = at; decision.updatedAt = at;
        decision.history.push({ at, action: 'deleted', fromStatus: decision.status, snapshot: structuredClone(decisionInputSnapshot(decision)) });
      }
      return { deleted: true, retainedHistory: true, id: decision.id, number: decision.number };
    });
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
  async duplicateCard(boardId: string, cardId: string, input: unknown = {}) {
    const values = duplicateCardSchema.parse(input);
    return this.mutate(boardId, board => {
      const { card, column } = this.card(board, cardId);
      if (values.expectedUpdatedAt && values.expectedUpdatedAt !== card.updatedAt) throw new StoreError('Cette carte a changé. Rouvrez ses actions avant de la dupliquer.', 409);
      const suffix = ' (copie)';
      const at = new Date(Math.max(this.now().valueOf(), Date.parse(card.updatedAt) + 1)).toISOString();
      const copy: Card = {
        ...structuredClone(card), id: randomUUID(), title: values.title ?? `${card.title.slice(0, 200 - suffix.length).trimEnd()}${suffix}`,
        checklist: card.checklist.map(item => ({ ...item, id: randomUUID() })), completed: false, createdAt: at, updatedAt: at,
      };
      column.cards.splice(column.cards.indexOf(card) + 1, 0, copy);
      return copy;
    });
  }
  async listKnowledge(boardId: string, includeDeleted = false) {
    return (await this.getBoard(boardId)).knowledge.filter(k => includeDeleted || !k.deletedAt);
  }
  async createKnowledge(boardId: string, input: unknown) {
    const values = knowledgeInputSchema.parse(input);
    return this.mutate(boardId, board => {
      const at = this.now().toISOString();
      const item: KnowledgeItem = { ...values, id: randomUUID(), createdAt: at, updatedAt: at, deletedAt: null };
      board.knowledge.push(item); return item;
    });
  }
  private knowledgeItem(board: Board, id: string) {
    const item = board.knowledge.find(k => k.id === id);
    if (!item) throw new StoreError('Document ou exigence introuvable', 404);
    return item;
  }
  async updateKnowledge(boardId: string, id: string, input: unknown, expectedUpdatedAt?: string) {
    const patch = knowledgePatchSchema.parse(input);
    return this.mutate(boardId, board => {
      const item = this.knowledgeItem(board, id);
      if (item.deletedAt) throw new StoreError('Cet élément est supprimé et reste en lecture seule.', 409);
      if (expectedUpdatedAt && expectedUpdatedAt !== item.updatedAt) throw new StoreError('Cet élément a changé. Fermez et rouvrez-le avant de réessayer.', 409);
      Object.assign(item, patch, { updatedAt: new Date(Math.max(this.now().valueOf(), Date.parse(item.updatedAt) + 1)).toISOString() });
      return item;
    });
  }
  async deleteKnowledge(boardId: string, id: string, expectedUpdatedAt?: string) {
    return this.mutate(boardId, board => {
      const item = this.knowledgeItem(board, id);
      if (expectedUpdatedAt && expectedUpdatedAt !== item.updatedAt) throw new StoreError('Cet élément a changé. Fermez et rouvrez-le avant de réessayer.', 409);
      if (!item.deletedAt) item.updatedAt = item.deletedAt = new Date(Math.max(this.now().valueOf(), Date.parse(item.updatedAt) + 1)).toISOString();
      return { deleted: true, retainedRelations: true };
    });
  }
  private checkEntity(board: Board, ref: EntityRef) {
    if (ref.kind === 'url') { httpUrlSchema.parse(ref.id); return; }
    const item = describeEntity(board, ref);
    if (item.missing || item.deleted) throw new StoreError('Choisissez un élément actif de ce projet.', 404);
  }
  async listRelations(boardId: string, entity?: unknown) {
    const board = await this.getBoard(boardId);
    if (entity === undefined) return allRelations(board);
    return relatedEntities(board, entityRefSchema.parse(entity));
  }
  async createRelation(boardId: string, input: unknown) {
    const values = relationInputSchema.parse(input);
    return this.mutate(boardId, board => {
      this.checkEntity(board, values.source); this.checkEntity(board, values.target);
      if (sameEntity(values.source, values.target)) throw new StoreError('Un élément ne peut pas être relié à lui-même.');
      if (allRelations(board).some(r => r.type === values.type && (sameEntity(r.source, values.source) && sameEntity(r.target, values.target) || values.type === 'relates_to' && sameEntity(r.source, values.target) && sameEntity(r.target, values.source)))) throw new StoreError('Cette relation existe déjà.', 409);
      const relation = { ...values, id: randomUUID(), createdAt: this.now().toISOString() };
      board.relations.push(relation); return relation;
    });
  }
  async deleteRelation(boardId: string, relationId: string) {
    return this.mutate(boardId, board => {
      const index = board.relations.findIndex(r => r.id === relationId);
      if (index < 0) throw new StoreError('Relation introuvable. Les liens historiques des décisions se modifient dans leur décision.', 404);
      board.relations.splice(index, 1); return { deleted: true };
    });
  }
  private recordImpact(board: Board, decisionId: string, at: string) {
    const decision = this.decision(board, decisionId);
    if (decision.deletedAt || decision.status !== 'superseded' || !decision.supersededBy) throw new StoreError('Seule une décision remplacée peut signaler des éléments à réexaminer.');
    for (const affected of analyzeImpact(board, decisionId)) {
      if (affected.entity.kind === 'decision' || board.impactReviews.some(r => r.decisionId === decisionId && r.replacementId === decision.supersededBy && sameEntity(r.entity, affected.entity))) continue;
      board.impactReviews.push({ id: randomUUID(), decisionId, replacementId: decision.supersededBy, entity: affected.entity, entityTitle: affected.title, distance: affected.distance, path: affected.path, createdAt: at, updatedAt: at, reviewedAt: null, note: '' });
    }
  }
  async analyzeDecisionImpact(boardId: string, decisionId: string, recordReviews = false) {
    const result = (board: Board) => {
      const decision = this.decision(board, decisionId);
      return { decisionId, replacementId: decision.supersededBy, affected: analyzeImpact(board, decisionId), reviews: board.impactReviews.filter(r => r.decisionId === decisionId), policy: 'Potential review impact, not automatic changes or proof of implementation. Generic relations are traversed in both directions, Gantt dependencies only towards successors. Supersession links are not traversed.' };
    };
    if (!recordReviews) return result(await this.getBoard(boardId));
    return this.mutate(boardId, board => { this.recordImpact(board, decisionId, this.now().toISOString()); return result(board); });
  }
  async listImpactReviews(boardId: string, status: 'pending' | 'reviewed' | 'all' = 'pending') {
    return (await this.getBoard(boardId)).impactReviews.filter(r => status === 'all' || (status === 'pending' ? !r.reviewedAt : !!r.reviewedAt));
  }
  async reviewImpact(boardId: string, reviewId: string, input: unknown) {
    const values = reviewPatchSchema.parse(input);
    return this.mutate(boardId, board => {
      const review = board.impactReviews.find(r => r.id === reviewId);
      if (!review) throw new StoreError('Signalement introuvable', 404);
      if (values.expectedUpdatedAt && values.expectedUpdatedAt !== review.updatedAt) throw new StoreError('Ce signalement a changé. Rouvrez-le avant de réessayer.', 409);
      const at = new Date(Math.max(this.now().valueOf(), Date.parse(review.updatedAt) + 1)).toISOString();
      Object.assign(review, { reviewedAt: values.reviewed ? at : null, updatedAt: at, note: values.note ?? review.note }); return review;
    });
  }
}
