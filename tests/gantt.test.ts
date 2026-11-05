import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../server/store.js';
import { ganttCsv, ganttRange, ganttSvg } from '../shared/planning.js';

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mkanban-gantt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory), board = await store.createBoard({ title: 'Planning' });
  const column = await store.createColumn(board.id, { title: 'À faire' });
  const a = await store.createCard(board.id, column.id, { title: 'Conception', startDate: '2026-11-01', dueDate: '2026-11-03', points: 5 });
  const b = await store.createCard(board.id, column.id, { title: 'Construction', startDate: '2026-11-03', dueDate: '2026-11-05', dependencies: [a.id], points: 8 });
  const c = await store.createCard(board.id, column.id, { title: 'Validation', dependencies: [a.id, b.id] });
  return { store, directory, board, column, a, b, c };
}
test('Gantt derives inclusive durations, links, unscheduled tasks, blocking and overlaps', async t => {
  const { store, board, a, b, c } = await fixture(t);
  const plan = await store.getGantt(board.id);
  assert.deepEqual(plan.summary, { total: 3, scheduled: 2, unscheduled: 1, blocked: 2, conflicts: 1 });
  assert.equal(plan.tasks[0].duration, 3); assert.equal(plan.tasks[1].duration, 3);
  assert.deepEqual(plan.tasks[1].blockedBy, [a.id]); assert.match(plan.tasks[1].conflicts[0], /2026-11-03/);
  assert.deepEqual(plan.links.map(l => [l.from, l.to]), [[a.id, b.id], [a.id, c.id], [b.id, c.id]]);
  await store.updateCard(board.id, a.id, { completed: true });
  assert.equal((await store.getGantt(board.id)).tasks[1].blockedBy.length, 0);
});
test('date inversions, cycles, self-dependencies, unknown and foreign references are rejected without writing', async t => {
  const { store, board, column, a, b, c } = await fixture(t);
  const other = await store.createBoard({ title: 'Ailleurs' });
  const otherColumn = await store.createColumn(other.id, { title: 'Autre' });
  const foreign = await store.createCard(other.id, otherColumn.id, { title: 'Fiche externe' });
  const before = await store.getBoard(board.id);
  for (const patch of [{ startDate: '2026-11-10' }, { dueDate: '2026-02-30' }, { dependencies: [a.id] }, { dependencies: [b.id] }, { dependencies: [c.id] }, { dependencies: ['missing'] }, { dependencies: [foreign.id] }, { dependencies: [b.id, b.id] }]) await assert.rejects(store.updateCard(board.id, a.id, patch));
  await assert.rejects(store.createCard(board.id, column.id, { title: 'Invalid', dependencies: ['missing'] }));
  assert.deepEqual(await store.getBoard(board.id), before);
});
test('batch updates validate the final graph and preserve every card when a late change is stale', async t => {
  const { store, board, a, b } = await fixture(t);
  await store.updateSchedule(board.id, { changes: [{ cardId: a.id, dependencies: [b.id] }, { cardId: b.id, dependencies: [], startDate: '2026-11-01', dueDate: '2026-11-02' }] });
  assert.deepEqual((await store.getCard(board.id, a.id)).dependencies, [b.id]);
  const before = await store.getBoard(board.id);
  await assert.rejects(store.updateSchedule(board.id, { changes: [{ cardId: a.id, startDate: '2026-11-10', dueDate: '2026-11-12' }, { cardId: b.id, startDate: '2026-11-11', expectedUpdatedAt: 'stale' }] }), /changé/);
  await assert.rejects(store.updateSchedule(board.id, { changes: [{ cardId: a.id }, { cardId: a.id }] }), /plusieurs fois/);
  assert.deepEqual(await store.getBoard(board.id), before);
});
test('dependency-aware auto-scheduling previews without writes, preserves duration and protects stale previews', async t => {
  const { store, directory, board, a, b, c } = await fixture(t);
  const before = await readFile(path.join(directory, `${board.id}.json`), 'utf8');
  const options = { projectStart: '2026-11-01', defaultDurationDays: 2 };
  const preview = await store.autoSchedule(board.id, options);
  assert.equal(preview.applied, false);
  assert.equal(await readFile(path.join(directory, `${board.id}.json`), 'utf8'), before);
  assert.deepEqual(preview.changes.map(change => [change.cardId, change.startDate, change.dueDate]), [[b.id, '2026-11-04', '2026-11-06'], [c.id, '2026-11-07', '2026-11-08']]);
  await store.updateCard(board.id, a.id, { title: 'Conception revue' });
  await assert.rejects(store.autoSchedule(board.id, { ...options, dryRun: false, expectedRevision: preview.revision }), /changé/);
  const latest = await store.autoSchedule(board.id, options);
  const history = (await store.getBoard(board.id)).pointHistory;
  await store.autoSchedule(board.id, { ...options, dryRun: false, expectedRevision: latest.revision });
  assert.equal((await store.getGantt(board.id)).summary.conflicts, 0);
  assert.equal((await new Store(directory).getCard(board.id, c.id)).dueDate, '2026-11-08');
  assert.deepEqual((await store.getBoard(board.id)).pointHistory, history);
  assert.equal((await store.autoSchedule(board.id, options)).changes.length, 0);
});
test('completed tasks remain fixed by default, undated completed predecessors need an explicit choice', async t => {
  const { store, board, a, b } = await fixture(t);
  await store.updateCard(board.id, a.id, { completed: true, startDate: null, dueDate: null });
  await assert.rejects(store.autoSchedule(board.id, { projectStart: '2026-11-01' }), /terminé/);
  const preview = await store.autoSchedule(board.id, { projectStart: '2026-11-01', includeCompleted: true });
  assert.ok(preview.changes.some(change => change.cardId === a.id));
  await store.autoSchedule(board.id, { projectStart: '2026-11-01', includeCompleted: true, dryRun: false });
  assert.equal((await store.getCard(board.id, a.id)).completed, true);
  assert.ok((await store.getCard(board.id, b.id)).startDate! > (await store.getCard(board.id, a.id)).dueDate!);
});
test('deletion cleans dangling links and split preserves dates and predecessor semantics', async t => {
  const { store, board, column, a, b, c } = await fixture(t);
  const split = await store.splitCard(board.id, b.id, { title: 'Sous-tâche', points: 3 });
  assert.deepEqual(split.created.dependencies, [a.id]); assert.equal(split.created.startDate, b.startDate);
  assert.deepEqual((await store.getCard(board.id, c.id)).dependencies, [a.id, b.id]);
  await store.moveColumn(board.id, column.id, 0);
  assert.deepEqual((await store.getCard(board.id, b.id)).dependencies, [a.id]);
  await store.deleteCard(board.id, a.id);
  assert.deepEqual((await store.getCard(board.id, b.id)).dependencies, []);
  assert.deepEqual((await store.getCard(board.id, c.id)).dependencies, [b.id]);
  await assert.rejects(store.updateCard(board.id, b.id, { title: 'Ancien brouillon' }, b.updatedAt), /changé/);
  const target = await store.createColumn(board.id, { title: 'À garder' });
  await store.moveCard(board.id, c.id, target.id, 0);
  const ids = (await store.getBoard(board.id)).columns.find(col => col.id === column.id)!.cards.map(card => card.id);
  await store.deleteColumn(board.id, column.id, { mode: 'delete', expectedCardIds: ids });
  assert.deepEqual((await store.getCard(board.id, c.id)).dependencies, []);
});
test('legacy dates become milestones and CSV/SVG exports escape user content', async t => {
  const { store, directory, board, a } = await fixture(t);
  const filename = path.join(directory, `${board.id}.json`), raw = JSON.parse(await readFile(filename, 'utf8'));
  for (const column of raw.columns) for (const card of column.cards) { delete card.startDate; delete card.dependencies; }
  await writeFile(filename, JSON.stringify(raw));
  const legacy = await store.getGantt(board.id);
  assert.equal(legacy.tasks[0].milestone, true); assert.equal(legacy.tasks[0].duration, 1); assert.deepEqual(legacy.tasks[0].dependencies, []);
  await store.updateCard(board.id, a.id, { title: '=1+1</text><script>alert("x")</script>' });
  const plan = await store.getGantt(board.id), csv = ganttCsv(plan);
  assert.ok(csv.includes('"\'=1+1'));
  const svg = ganttSvg(plan, ganttRange(plan, '2026-11-05'), 28, '2026-11-05');
  assert.ok(svg.includes('&lt;script&gt;')); assert.equal(svg.includes('<script>'), false); assert.ok(svg.includes('data-card-id='));
  assert.throws(() => ganttRange(plan, '2026-11-05', '2026-11-10', '2026-11-01'));
});
