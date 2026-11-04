import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { Store } from './store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = new Store(process.env.DATA_DIR || path.join(root, 'data/boards'));
await store.init();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const allowedHosts = ['localhost', '127.0.0.1', '[::1]', ...(process.env.ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean)];
const app = createApp(store, { allowedHosts });
if (process.env.NODE_ENV === 'production' || process.argv.includes('--production')) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: path.join(root, 'vite.config.ts'), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'spa' });
  app.use(vite.middlewares);
}
const server = app.listen(port, host, () => console.log(`mkanban : http://${host}:${port} | MCP : /mcp | JSON : ${store.directory}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)));
