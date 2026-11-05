import express from 'express';
import { z, ZodError } from 'zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp.js';
import { moveSchema } from './schema.js';
import { Store, StoreError } from './store.js';

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
    if (err instanceof SyntaxError) { res.status(400).json({ error: 'JSON invalide' }); return; }
    console.error(err);
    res.status(500).json({ error: 'Impossible de traiter la demande. Consultez les journaux du serveur.' });
  });
  return app;
}
