import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { createMcpServer } from './mcp.js';

// stdout is reserved for MCP JSON-RPC messages.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = new Store(process.env.DATA_DIR || path.join(root, 'data/boards'));
await store.init();
await createMcpServer(store).connect(new StdioServerTransport());
