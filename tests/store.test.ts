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
  const original = await store.getBoard(board.id);
  await assert.rejects(store.splitCard(board.id, card.id, { title: 'Brouillon périmé', points: 3, expectedUpdatedAt: 'stale' }), /changé/);
  assert.deepEqual(await store.getBoard(board.id), original);
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
test('duplicate creates an independent adjacent card with copied properties and accurate point history', async t => {
  const { store, board, a, directory } = await fixture(t);
  const predecessor = await store.createCard(board.id, a.id, { title: 'Préparation' });
  const source = await store.createCard(board.id, a.id, { title: 'Fiche terminée', description: '# Markdown\n**À conserver**', points: 5, completed: true, startDate: '2026-11-05', dueDate: '2026-11-08', dependencies: [predecessor.id], flags: ['Design'], members: ['Mika'], checklist: [{ id: 'one', text: 'Déjà fait', done: true }, { id: 'two', text: 'À faire', done: false }] });
  const following = await store.createCard(board.id, a.id, { title: 'Suite', dependencies: [source.id], points: 1 });
  const decision = await store.createDecision(board.id, { title: 'Décision liée', links: [{ kind: 'card', target: source.id }] });
  const copy = await store.duplicateCard(board.id, source.id, { expectedUpdatedAt: source.updatedAt });
  assert.notEqual(copy.id, source.id); assert.equal(copy.title, 'Fiche terminée (copie)'); assert.equal(copy.completed, false);
  assert.equal(copy.createdAt, copy.updatedAt); assert.ok(copy.createdAt > source.updatedAt);
  for (const key of ['description', 'points', 'members', 'flags', 'startDate', 'dueDate', 'dependencies', 'columnId'] as const) assert.deepEqual(copy[key], source[key]);
  assert.deepEqual(copy.checklist.map(({ text, done }) => ({ text, done })), source.checklist.map(({ text, done }) => ({ text, done })));
  assert.equal(new Set([...source.checklist, ...copy.checklist].map(i => i.id)).size, 4);
  const restored = await new Store(directory).getBoard(board.id);
  assert.deepEqual(restored.columns[0].cards.map(c => c.id), [predecessor.id, source.id, copy.id, following.id]);
  assert.deepEqual(restored.columns[0].cards.map(c => c.position), [0, 1, 2, 3]);
  assert.deepEqual(await store.getCard(board.id, source.id), source);
  assert.deepEqual((await store.getCard(board.id, following.id)).dependencies, [source.id]);
  assert.deepEqual(restored.decisions[0].links, decision.links);
  assert.deepEqual({ total: restored.pointHistory.at(-1)!.total, completed: restored.pointHistory.at(-1)!.completed }, { total: 11, completed: 5 });
  await store.updateCard(board.id, copy.id, { description: 'Copie modifiée', checklist: copy.checklist.map(item => ({ ...item, done: false })) });
  assert.deepEqual(await store.getCard(board.id, source.id), source);
});
test('duplicate supports bounded and custom titles and rejects stale or invalid requests without writes', async t => {
  const { store, board, a, directory } = await fixture(t);
  const source = await store.createCard(board.id, a.id, { title: 'A'.repeat(200) });
  const copy = await store.duplicateCard(board.id, source.id);
  assert.equal(copy.title.length, 200); assert.ok(copy.title.endsWith(' (copie)')); assert.deepEqual(copy.checklist, []);
  const latest = await store.updateCard(board.id, source.id, { title: 'Nouvelle version' });
  const filename = path.join(directory, `${board.id}.json`), before = await readFile(filename, 'utf8');
  await assert.rejects(store.duplicateCard(board.id, source.id, { expectedUpdatedAt: source.updatedAt }), /changé/);
  await assert.rejects(store.duplicateCard(board.id, source.id, { title: '' }));
  await assert.rejects(store.duplicateCard(board.id, source.id, { title: 'X'.repeat(201) }));
  await assert.rejects(store.duplicateCard(board.id, source.id, { completed: true }));
  await assert.rejects(store.duplicateCard(board.id, 'missing'), /introuvable/);
  assert.equal(await readFile(filename, 'utf8'), before);
  const named = await store.duplicateCard(board.id, source.id, { title: 'Copie personnalisée', expectedUpdatedAt: latest.updatedAt });
  assert.equal(named.title, 'Copie personnalisée');
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

test('column deletion transfers all cards atomically, preserving their content and order', async t => {
  const { store, directory, board, a, b } = await fixture(t);
  const existing = await store.createCard(board.id, b.id, { title: 'Déjà là', points: 2 });
  const first = await store.createCard(board.id, a.id, { title: 'Première', points: 5, description: '**À garder**', dueDate: '2026-12-20', members: ['Mika'], flags: ['Important'], checklist: [{ id: 'task', text: 'Une tâche', done: true }], completed: true });
  const second = await store.createCard(board.id, a.id, { title: 'Deuxième', points: 3 });
  const before = await store.getBoard(board.id);
  await assert.rejects(store.deleteColumn(board.id, a.id, { mode: 'move', targetColumnId: a.id }), /autre colonne/);
  await assert.rejects(store.deleteColumn(board.id, a.id, { mode: 'move', targetColumnId: 'missing' }), /introuvable/);
  const otherBoard = await store.createBoard({ title: 'Autre tableau' });
  const foreignColumn = await store.createColumn(otherBoard.id, { title: 'Ailleurs' });
  await assert.rejects(store.deleteColumn(board.id, a.id, { mode: 'move', targetColumnId: foreignColumn.id }), /introuvable/);
  assert.deepEqual(await store.getBoard(board.id), before);
  assert.deepEqual(await store.deleteColumn(board.id, a.id, { mode: 'move', targetColumnId: b.id }), { deleted: true, movedCards: 2, deletedCards: 0 });
  const restored = await new Store(directory).getBoard(board.id);
  assert.equal(restored.columns.length, 1);
  const cards = restored.columns[0].cards;
  assert.deepEqual(cards.map(c => c.id), [existing.id, first.id, second.id]);
  assert.deepEqual(cards.map(c => c.position), [0, 1, 2]);
  assert.ok(cards.every(c => c.columnId === b.id));
  assert.equal(cards.reduce((sum, c) => sum + c.points, 0), 10);
  assert.deepEqual({ ...cards[1], columnId: first.columnId, position: first.position, updatedAt: first.updatedAt }, first);
  await assert.rejects(store.updateCard(board.id, first.id, { title: 'Ancien brouillon' }, first.updatedAt), /changé/);
});

test('cascade deletion requires confirmation of the current card IDs and preserves other columns', async t => {
  const { store, directory, board, a, b } = await fixture(t);
  const first = await store.createCard(board.id, a.id, { title: 'À supprimer' });
  const keep = await store.createCard(board.id, b.id, { title: 'À garder' });
  const late = await store.createCard(board.id, a.id, { title: 'Ajoutée entre-temps' });
  const before = await store.getBoard(board.id);
  await assert.rejects(store.deleteColumn(board.id, a.id), /Déplacez/);
  await assert.rejects(store.deleteColumn(board.id, a.id, { mode: 'delete' }));
  await assert.rejects(store.deleteColumn(board.id, a.id, { mode: 'delete', expectedCardIds: [first.id] }), /ont changé/);
  await assert.rejects(store.deleteColumn(board.id, a.id, { mode: 'delete', expectedCardIds: [first.id, late.id, late.id] }), /ont changé/);
  assert.deepEqual(await store.getBoard(board.id), before);
  assert.deepEqual(await store.deleteColumn(board.id, a.id, { mode: 'delete', expectedCardIds: [first.id, late.id] }), { deleted: true, movedCards: 0, deletedCards: 2 });
  const restored = await new Store(directory).getBoard(board.id);
  assert.equal(restored.columns.length, 1); assert.deepEqual(restored.columns[0].cards, [keep]);
  await assert.rejects(store.getCard(board.id, first.id), /introuvable/);
  await assert.rejects(store.getCard(board.id, late.id), /introuvable/);
});
