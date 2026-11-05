import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../server/store.js';
import { addDays, buildChartDays, chartCsv, localDay } from '../client/src/chartData.js';
import type { PointSnapshot } from '../server/schema.js';

test('point history records scope, completion and reopening; ignores descriptions and moves', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mkanban-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = new Date('2026-11-01T10:00:00Z');
  const store = new Store(directory, () => time);
  const board = await store.createBoard({ title: 'Historique' });
  const a = await store.createColumn(board.id, { title: 'À faire' });
  const b = await store.createColumn(board.id, { title: 'Autre' });
  const card = await store.createCard(board.id, a.id, { title: 'Une fiche', points: 8 });
  time = new Date('2026-11-02T10:00:00Z');
  await store.updateCard(board.id, card.id, { completed: true });
  await store.updateCard(board.id, card.id, { description: '**Note**' });
  await store.moveCard(board.id, card.id, b.id, 0);
  await store.moveColumn(board.id, b.id, 0);
  await store.deleteColumn(board.id, b.id, { mode: 'move', targetColumnId: a.id });
  time = new Date('2026-11-03T10:00:00Z');
  await store.updateCard(board.id, card.id, { completed: false });
  await store.updateCard(board.id, card.id, { points: 10 });
  const split = await store.splitCard(board.id, card.id, { title: 'Une partie', points: 3 });
  await store.updateCard(board.id, card.id, { completed: true });
  await store.deleteCard(board.id, split.created.id);
  const history = (await store.getBoard(board.id)).pointHistory;
  assert.deepEqual(history.map(h => [h.total, h.completed]), [[0, 0], [8, 0], [8, 8], [8, 0], [10, 0], [10, 7], [7, 7]]);
  assert.ok(history.every((h, i) => !i || Date.parse(h.at) > Date.parse(history[i - 1].at)));
  assert.deepEqual((await new Store(directory).getBoard(board.id)).pointHistory, history);
  await store.deleteColumn(board.id, a.id, { mode: 'delete', expectedCardIds: [card.id] });
  assert.deepEqual((await store.getBoard(board.id)).pointHistory.at(-1), { at: new Date(Date.parse(history.at(-1)!.at) + 1).toISOString(), total: 0, completed: 0 });
});

test('legacy JSON is migrated once with an honest current baseline, including simultaneous readers', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mkanban-legacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const old = new Store(directory, () => new Date('2026-10-01T10:00:00Z'));
  const board = await old.createBoard({ title: 'Ancien tableau' });
  const column = await old.createColumn(board.id, { title: 'Travail' });
  const card = await old.createCard(board.id, column.id, { title: 'Déjà terminée', points: 5, completed: true });
  const filename = path.join(directory, `${board.id}.json`);
  const raw = JSON.parse(await readFile(filename, 'utf8')); delete raw.pointHistory;
  await writeFile(filename, JSON.stringify(raw));
  const now = () => new Date('2026-11-05T10:00:00Z');
  const [first, second] = await Promise.all([new Store(directory, now).getBoard(board.id), new Store(directory, now).getBoard(board.id)]);
  assert.deepEqual(first.pointHistory, [{ at: now().toISOString(), total: 5, completed: 5 }]);
  assert.deepEqual(second.pointHistory, first.pointHistory);
  assert.deepEqual(first.columns[0].cards[0], card);
  assert.equal(first.createdAt, board.createdAt);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')).pointHistory, first.pointHistory);
  assert.equal('pointHistory' in (await new Store(directory).listBoards())[0], false);
});

test('all concurrent point mutations are retained in history', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mkanban-history-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  const board = await store.createBoard({ title: 'Concurrence' });
  const column = await store.createColumn(board.id, { title: 'Travail' });
  await Promise.all(Array.from({ length: 6 }, (_, i) => new Store(directory).createCard(board.id, column.id, { title: `Fiche ${i}`, points: 2, completed: true })));
  const history = (await store.getBoard(board.id)).pointHistory;
  assert.deepEqual(history.map(h => h.total), [0, 2, 4, 6, 8, 10, 12]);
  assert.deepEqual(history.map(h => h.completed), [0, 2, 4, 6, 8, 10, 12]);
});

const history: PointSnapshot[] = [
  { at: '2026-11-01T10:00:00.000Z', total: 10, completed: 0 },
  { at: '2026-11-02T10:00:00.000Z', total: 10, completed: 5 },
  { at: '2026-11-02T15:00:00.000Z', total: 10, completed: 8 },
  { at: '2026-11-04T10:00:00.000Z', total: 15, completed: 8 },
];
test('charts use daily closing balances, carry unchanged days, and never project real values into the future', () => {
  const days = buildChartDays(history, '2026-11-01', '2026-11-06', new Date('2026-11-04T18:00:00Z'), 'UTC');
  assert.deepEqual(days.map(d => [d.total, d.completed, d.remaining]), [[10, 0, 10], [10, 8, 2], [10, 8, 2], [15, 8, 7], [null, null, null], [null, null, null]]);
  assert.deepEqual(days.map(d => d.ideal), [10, 8, 6, 4, 2, 0]);
  const clipped = buildChartDays(history, '2026-11-03', '2026-11-04', new Date('2026-11-04T18:00:00Z'), 'UTC');
  assert.equal(clipped[0].remaining, 2); assert.equal(clipped[0].ideal, 2); assert.equal(clipped[1].ideal, 0);
});
test('charts do not invent data before tracking begins and use local calendar days across timezone boundaries', () => {
  const days = buildChartDays([{ at: '2026-11-04T23:30:00.000Z', total: 8, completed: 3 }], '2026-11-03', '2026-11-06', new Date('2026-11-05T10:00:00Z'), 'Europe/Paris');
  assert.deepEqual(days.map(d => d.remaining), [null, null, 5, null]);
  assert.deepEqual(days.map(d => d.ideal), [null, null, 5, 0]);
  assert.equal(localDay('2026-11-04T23:30:00Z', 'Europe/Paris'), '2026-11-05');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
});
test('invalid periods, zero points, a single day and absent observations have defined outcomes', () => {
  for (const range of [['', '2026-11-05'], ['2026-11-05', '2026-11-01'], ['2026-02-30', '2026-11-05'], ['2000-01-01', '2026-11-05']]) assert.throws(() => buildChartDays(history, range[0], range[1]));
  const zero = buildChartDays([{ at: '2026-11-05T10:00:00.000Z', total: 0, completed: 0 }], '2026-11-05', '2026-11-05', new Date('2026-11-05T12:00:00Z'), 'UTC');
  assert.deepEqual(zero, [{ date: '2026-11-05', total: 0, completed: 0, remaining: 0, ideal: 0 }]);
  assert.equal(buildChartDays([], '2026-11-05', '2026-11-05')[0].total, null);
  assert.ok(chartCsv(zero).includes('2026-11-05;0;0;0;0'));
  assert.ok(chartCsv([{ date: '2026-11-06', total: null, completed: null, remaining: null, ideal: 0 }]).includes('2026-11-06;;;;0'));
});
