import express from 'express';
import { z, ZodError } from 'zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp.js';
import { ganttQuerySchema, moveSchema } from './schema.js';
import { Store, StoreError } from './store.js';
import { ganttCsv, ganttRange, ganttSvg, PlanningError } from '../shared/planning.js';
import { entityRefSchema } from './schema.js';

export function createApp(store: Store, options: { allowedHosts?: string[] } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const allowed = options.allowedHosts ?? ['localhost', '127.0.0.1', '[::1]'];
  // Protect local JSON data against DNS rebinding and cross-origin browser writes.
  app.use((req, res, next) => {
    if (!allowed.includes(req.hostname)) { res.status(403).json({ error: 'Hôte non autorisé' }); return; }
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) { res.status(403).json({ error: 'Origine non autorisée' }); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', storage: 'json', mcp: '/mcp' }));
  app.get('/api/boards', async (_req, res) => res.json(await store.listBoards()));
  app.post('/api/boards', async (req, res) => res.status(201).json(await store.createBoard(req.body)));
  app.get('/api/boards/:boardId', async (req, res) => res.json(await store.getBoard(req.params.boardId)));
  app.patch('/api/boards/:boardId', async (req, res) => res.json(await store.updateBoard(req.params.boardId, req.body)));
  app.delete('/api/boards/:boardId', async (req, res) => res.json(await store.deleteBoard(req.params.boardId)));
  app.get('/api/boards/:boardId/knowledge', async (req, res) => res.json(await store.listKnowledge(req.params.boardId, z.enum(['true', 'false']).default('false').parse(req.query.includeDeleted) === 'true')));
  app.post('/api/boards/:boardId/knowledge', async (req, res) => res.status(201).json(await store.createKnowledge(req.params.boardId, req.body)));
  app.patch('/api/boards/:boardId/knowledge/:itemId', async (req, res) => {
    const { expectedUpdatedAt, ...patch } = req.body;
    res.json(await store.updateKnowledge(req.params.boardId, req.params.itemId, patch, z.string().optional().parse(expectedUpdatedAt)));
  });
  app.delete('/api/boards/:boardId/knowledge/:itemId', async (req, res) => {
    const options = z.object({ expectedUpdatedAt: z.string().optional() }).strict().parse(req.body ?? {});
    res.json(await store.deleteKnowledge(req.params.boardId, req.params.itemId, options.expectedUpdatedAt));
  });
  app.get('/api/boards/:boardId/relations', async (req, res) => res.json(await store.listRelations(req.params.boardId, req.query.kind === undefined && req.query.id === undefined ? undefined : entityRefSchema.parse({ kind: req.query.kind, id: req.query.id }))));
  app.post('/api/boards/:boardId/relations', async (req, res) => res.status(201).json(await store.createRelation(req.params.boardId, req.body)));
  app.delete('/api/boards/:boardId/relations/:relationId', async (req, res) => res.json(await store.deleteRelation(req.params.boardId, req.params.relationId)));
  app.get('/api/boards/:boardId/decisions/:decisionId/impact', async (req, res) => res.json(await store.analyzeDecisionImpact(req.params.boardId, req.params.decisionId)));
  app.post('/api/boards/:boardId/decisions/:decisionId/impact', async (req, res) => res.json(await store.analyzeDecisionImpact(req.params.boardId, req.params.decisionId, true)));
  app.get('/api/boards/:boardId/impact-reviews', async (req, res) => res.json(await store.listImpactReviews(req.params.boardId, z.enum(['pending', 'reviewed', 'all']).default('pending').parse(req.query.status))));
  app.patch('/api/boards/:boardId/impact-reviews/:reviewId', async (req, res) => res.json(await store.reviewImpact(req.params.boardId, req.params.reviewId, req.body)));
  app.get('/api/boards/:boardId/decisions', async (req, res) => {
    const query = { ...req.query };
    for (const key of ['statuses', 'types']) if (typeof query[key] === 'string') query[key] = [query[key] as string];
    res.json(await store.listDecisions(req.params.boardId, query));
  });
  app.post('/api/boards/:boardId/decisions', async (req, res) => res.status(201).json(await store.createDecision(req.params.boardId, req.body)));
  app.get('/api/boards/:boardId/decisions/:decisionId', async (req, res) => res.json(await store.getDecision(req.params.boardId, req.params.decisionId)));
  app.patch('/api/boards/:boardId/decisions/:decisionId', async (req, res) => {
    const { expectedUpdatedAt, ...patch } = req.body;
    res.json(await store.updateDecision(req.params.boardId, req.params.decisionId, patch, z.string().optional().parse(expectedUpdatedAt)));
  });
  app.delete('/api/boards/:boardId/decisions/:decisionId', async (req, res) => {
    const { expectedUpdatedAt } = z.object({ expectedUpdatedAt: z.string().optional() }).strict().parse(req.body ?? {});
    res.json(await store.deleteDecision(req.params.boardId, req.params.decisionId, expectedUpdatedAt));
  });
  app.get('/api/boards/:boardId/gantt', async (req, res) => {
    const options = ganttQuerySchema.parse({ ...req.query, dayWidth: req.query.dayWidth === undefined ? undefined : Number(req.query.dayWidth) });
    const plan = await store.getGantt(req.params.boardId);
    if (options.format === 'csv') { res.type('text/csv').send(ganttCsv(plan)); return; }
    if (options.format === 'svg') { const today = options.today ?? new Date().toISOString().slice(0, 10); res.type('image/svg+xml').send(ganttSvg(plan, ganttRange(plan, today, options.startDate, options.endDate), options.dayWidth, today)); return; }
    res.json(plan);
  });
  app.patch('/api/boards/:boardId/schedule', async (req, res) => res.json(await store.updateSchedule(req.params.boardId, req.body)));
  app.post('/api/boards/:boardId/auto-schedule', async (req, res) => res.json(await store.autoSchedule(req.params.boardId, req.body)));
  app.post('/api/boards/:boardId/columns', async (req, res) => res.status(201).json(await store.createColumn(req.params.boardId, req.body)));
  app.patch('/api/boards/:boardId/columns/:columnId', async (req, res) => res.json(await store.updateColumn(req.params.boardId, req.params.columnId, req.body)));
  app.post('/api/boards/:boardId/columns/:columnId/move', async (req, res) => res.json(await store.moveColumn(req.params.boardId, req.params.columnId, z.number().int().nonnegative().parse(req.body.index))));
  app.delete('/api/boards/:boardId/columns/:columnId', async (req, res) => res.json(await store.deleteColumn(req.params.boardId, req.params.columnId, req.body)));
  app.post('/api/boards/:boardId/columns/:columnId/cards', async (req, res) => res.status(201).json(await store.createCard(req.params.boardId, req.params.columnId, req.body)));
  app.patch('/api/boards/:boardId/cards/:cardId', async (req, res) => {
    const { expectedUpdatedAt, ...patch } = req.body;
    res.json(await store.updateCard(req.params.boardId, req.params.cardId, patch, z.string().optional().parse(expectedUpdatedAt)));
  });
  app.post('/api/boards/:boardId/cards/:cardId/move', async (req, res) => {
    const { index, columnId } = moveSchema.parse(req.body);
    res.json(await store.moveCard(req.params.boardId, req.params.cardId, columnId, index));
  });
  app.delete('/api/boards/:boardId/cards/:cardId', async (req, res) => res.json(await store.deleteCard(req.params.boardId, req.params.cardId)));
  app.post('/api/boards/:boardId/cards/:cardId/split', async (req, res) => res.json(await store.splitCard(req.params.boardId, req.params.cardId, req.body)));
  app.post('/api/boards/:boardId/cards/:cardId/duplicate', async (req, res) => res.status(201).json(await store.duplicateCard(req.params.boardId, req.params.cardId, req.body)));
  app.post('/mcp', async (req, res) => {
    const server = createMcpServer(store);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').json({ error: 'MCP Streamable HTTP sans session : utilisez POST.' }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Route introuvable' }));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof ZodError) { res.status(400).json({ error: err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }); return; }
    if (err instanceof StoreError) { res.status(err.status).json({ error: err.message }); return; }
    if (err instanceof PlanningError) { res.status(400).json({ error: err.message }); return; }
    if (err instanceof SyntaxError) { res.status(400).json({ error: 'JSON invalide' }); return; }
    console.error(err);
    res.status(500).json({ error: 'Impossible de traiter la demande. Consultez les journaux du serveur.' });
  });
  return app;
}
