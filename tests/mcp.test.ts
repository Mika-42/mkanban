import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';

test('REST and official MCP HTTP client share JSON data, with errors and resource reads', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mkanban-http-'));
  const store = new Store(directory); await store.init();
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { force: true, recursive: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = new Client({ name: 'integration-test', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  t.after(() => client.close());
  const tools = await client.listTools(); assert.equal(tools.tools.length, 15);
  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return JSON.parse((result.content as { text: string }[])[0].text);
  }
  const board = await call('create_board', { title: 'MCP project' });
  const column = await call('create_column', { boardId: board.id, title: 'Todo' });
  const card = await call('create_card', { boardId: board.id, columnId: column.id, title: 'By AI', points: 8, checklist: [{ id: 'one', text: 'First', done: false }] });
  await call('update_card', { boardId: board.id, cardId: card.id, completed: true, description: '**MCP**' });
  const viaRest = await (await fetch(`${base}/api/boards/${board.id}`)).json();
  assert.equal(viaRest.columns[0].cards[0].completed, true);
  const split = await call('split_card', { boardId: board.id, cardId: card.id, title: 'Small', points: 3, checklistIds: ['one'] });
  assert.equal(split.created.checklist.length, 1);
  const viaMcp = await call('get_board', { boardId: board.id });
  assert.equal(viaMcp.columns[0].cardCount, 2); assert.equal(viaMcp.columns[0].totalPoints, 8);
  const resource = await client.readResource({ uri: `kanban://boards/${board.id}` });
  assert.equal(JSON.parse((resource.contents[0] as { text: string }).text).columns[0].cards.length, 2);
  const invalid = await client.callTool({ name: 'move_card', arguments: { boardId: board.id, cardId: card.id, columnId: 'missing', index: 0 } });
  assert.equal(invalid.isError, true);
  const rejected = await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ title: 'Denied' }) });
  assert.equal(rejected.status, 403);
  // Node fetch normalizes Host; use a raw HTTP request to test DNS rebinding.
  const badHost = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${base}/api/boards`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(badHost, 403);
  const badDate = await fetch(`${base}/api/boards/${board.id}/cards/${card.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dueDate: '2026-02-30' }) }); assert.equal(badDate.status, 400);
  const protectedColumn = await client.callTool({ name: 'delete_column', arguments: { boardId: board.id, columnId: column.id } });
  assert.equal(protectedColumn.isError, true);
  const target = await call('create_column', { boardId: board.id, title: 'Destination' });
  await call('delete_column', { boardId: board.id, columnId: column.id, options: { mode: 'move', targetColumnId: target.id } });
  const transferred = await call('get_board', { boardId: board.id });
  assert.equal(transferred.columns.length, 1); assert.equal(transferred.columns[0].totalPoints, 8);
  const staleDelete = await fetch(`${base}/api/boards/${board.id}/columns/${target.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'delete', expectedCardIds: [] }) });
  assert.equal(staleDelete.status, 409);
  const deleted = await fetch(`${base}/api/boards/${board.id}/columns/${target.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'delete', expectedCardIds: [card.id, split.created.id] }) });
  assert.equal(deleted.status, 200);
  assert.equal((await call('get_board', { boardId: board.id })).columns.length, 0);
  const empty = await call('create_column', { boardId: board.id, title: 'Vide' });
  assert.equal((await fetch(`${base}/api/boards/${board.id}/columns/${empty.id}`, { method: 'DELETE' })).status, 200);
});
test('official stdio client reads and edits persisted JSON from a separate process', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mkanban-stdio-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory); await store.init();
  const board = await store.createBoard({ title: 'Stdio' });
  const column = await store.createColumn(board.id, { title: 'Todo' });
  const client = new Client({ name: 'stdio-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'server/stdio.ts'], env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), DATA_DIR: directory }, stderr: 'pipe' });
  await client.connect(transport); t.after(() => client.close());
  const result = await client.callTool({ name: 'create_card', arguments: { boardId: board.id, columnId: column.id, title: 'From separate process', points: 5 } });
  assert.notEqual(result.isError, true);
  const loaded = await store.getBoard(board.id); assert.equal(loaded.columns[0].cards[0].title, 'From separate process'); assert.equal(loaded.columns[0].cards[0].points, 5);
});
