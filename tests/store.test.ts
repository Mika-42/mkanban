import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../server/store.js';

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mkanban-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory); await store.init();
  const board = await store.createBoard({ title: 'Projet' });
  const a = await store.createColumn(board.id, { title: 'À faire' });
  const b = await store.createColumn(board.id, { title: 'Terminé' });
  return { store, directory, board, a, b };
}
test('one readable JSON file per board, restored with all card properties', async t => {
  const { store, directory, board, a } = await fixture(t);
  const card = await store.createCard(board.id, a.id, { title: 'Carte', description: '# Markdown\n**Texte**', points: 5, flags: ['urgent'], members: ['Mika'], dueDate: '2026-12-04', checklist: [{ id: 'one', text: 'Test', done: true }] });
  await store.createBoard({ title: 'Autre' });
  assert.equal((await readdir(directory)).filter(f => f.endsWith('.json')).length, 2);
  const raw = JSON.parse(await readFile(path.join(directory, `${board.id}.json`), 'utf8'));
  assert.equal(raw.columns[0].cards[0].description, '# Markdown\n**Texte**');
  assert.deepEqual((await new Store(directory).getBoard(board.id)).columns[0].cards[0], card);
});
test('move cards between and within columns, reorder columns and protect nonempty deletion', async t => {
  const { store, board, a, b } = await fixture(t);
  const one = await store.createCard(board.id, a.id, { title: 'one' });
  const two = await store.createCard(board.id, a.id, { title: 'two' });
  await store.moveCard(board.id, two.id, a.id, 0);
  assert.deepEqual((await store.getBoard(board.id)).columns[0].cards.map(c => c.id), [two.id, one.id]);
  await store.moveCard(board.id, two.id, b.id, 99);
  assert.equal((await store.getCard(board.id, two.id)).columnId, b.id);
  await store.moveColumn(board.id, b.id, 0);
  await store.updateColumn(board.id, b.id, { title: 'Livré', color: 'green' });
  assert.equal((await store.getBoard(board.id)).columns[0].title, 'Livré');
  await assert.rejects(store.deleteColumn(board.id, b.id), /Déplacez/);
  await store.deleteCard(board.id, two.id);
  await store.deleteColumn(board.id, b.id);
  assert.equal((await store.getBoard(board.id)).columns.length, 1);
});
test('split is atomic and conserves story points and checklist items', async t => {
  const { store, board, a } = await fixture(t);
  const card = await store.createCard(board.id, a.id, { title: 'Large', description: 'hello', points: 8, completed: true, flags: ['design'], members: ['Mika'], checklist: [{ id: 'a', text: 'A', done: true }, { id: 'b', text: 'B', done: false }] });
  const split = await store.splitCard(board.id, card.id, { title: 'Petite', points: 3, checklistIds: ['b'] });
  assert.equal(split.original.points, 5); assert.equal(split.created.points, 3);
  assert.equal(split.created.completed, false); assert.equal(split.original.completed, true);
  assert.deepEqual(split.created.checklist.map(i => i.id), ['b']); assert.deepEqual(split.original.checklist.map(i => i.id), ['a']);
  assert.equal(split.created.description, 'hello'); assert.deepEqual(split.created.members, ['Mika']);
  const before = await store.getBoard(board.id);
  await assert.rejects(store.splitCard(board.id, card.id, { title: 'No', points: 6 }), /points/);
  await assert.rejects(store.splitCard(board.id, card.id, { title: 'No', points: 1, checklistIds: ['unknown'] }), /invalides/);
  assert.deepEqual(await store.getBoard(board.id), before);
});
test('parallel writes from independent stores do not lose changes', async t => {
  const { store, board, a, directory } = await fixture(t);
  await Promise.all(Array.from({ length: 20 }, (_, i) => new Store(directory).createCard(board.id, a.id, { title: `Card ${i}`, points: 1 })));
  const cards = (await store.getBoard(board.id)).columns[0].cards;
  assert.equal(cards.length, 20); assert.equal(new Set(cards.map(c => c.id)).size, 20);
  assert.deepEqual(cards.map(c => c.position), Array.from({ length: 20 }, (_, i) => i));
});
test('invalid properties, dates, checklist IDs and path traversal are rejected', async t => {
  const { store, board, a } = await fixture(t);
  for (const input of [{ title: '' }, { title: 'x', points: -1 }, { title: 'x', points: 1.5 }, { title: 'x', dueDate: '2026-02-30' }, { title: 'x', checklist: [{ id: 'a', text: 'A', done: false }, { id: 'a', text: 'B', done: true }] }]) await assert.rejects(store.createCard(board.id, a.id, input));
  await assert.rejects(store.getBoard('../../etc/passwd'));
  assert.equal((await store.getBoard(board.id)).columns[0].cards.length, 0);
});
test('optimistic concurrency rejects stale card edits and completion does not move cards', async t => {
  const { store, board, a } = await fixture(t);
  const card = await store.createCard(board.id, a.id, { title: 'Initial' });
  await store.updateCard(board.id, card.id, { title: 'IA', completed: true }, card.updatedAt);
  await assert.rejects(store.updateCard(board.id, card.id, { title: 'Stale' }, 'stale'), /changé/);
  const latest = await store.getCard(board.id, card.id);
  assert.equal(latest.title, 'IA'); assert.equal(latest.completed, true); assert.equal(latest.columnId, a.id);
});
