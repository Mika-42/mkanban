import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store, StoreError } from '../server/store.js';
import { decisionAuthority, decisionCode } from '../shared/decisions.js';

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mkagile-decisions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = new Date('2026-11-05T10:00:00.000Z');
  const store = new Store(directory, () => time); await store.init();
  const board = await store.createBoard({ title: 'Projet' });
  return { directory, store, board, setTime: (value: string) => { time = new Date(value); } };
}
const accepted = { status: 'accepted', outcome: 'Fichiers JSON', rationale: 'Usage local simple' };

test('decision numbers and revisions persist in the same project JSON, including legacy projects', async t => {
  const { directory, store, board } = await fixture(t);
  const filename = path.join(directory, `${board.id}.json`);
  const legacy = JSON.parse(await readFile(filename, 'utf8')); delete legacy.decisions; delete legacy.nextDecisionNumber;
  await writeFile(filename, JSON.stringify(legacy));
  assert.deepEqual((await store.getBoard(board.id)).decisions, []);
  const first = await store.createDecision(board.id, { title: 'Stockage', context: '**Contexte**', ...accepted });
  assert.equal(decisionCode(first.number), 'ADR-001'); assert.equal(first.authority, 'binding');
  assert.equal(first.createdAt, '2026-11-05T10:00:00.000Z'); assert.equal(first.decidedAt, first.createdAt);
  const updated = await store.updateDecision(board.id, first.id, { title: 'Stockage local' }, first.updatedAt);
  assert.ok(updated.updatedAt > first.updatedAt); assert.equal(updated.statusChangedAt, first.createdAt);
  assert.equal(updated.history[0].snapshot.title, 'Stockage'); assert.equal(updated.history[1].snapshot.title, 'Stockage local');
  await store.deleteDecision(board.id, first.id, updated.updatedAt);
  const next = await store.createDecision(board.id, { title: 'Autre choix' });
  assert.equal(next.number, 2);
  const restored = await new Store(directory).getBoard(board.id);
  assert.equal(restored.decisions.length, 2); assert.ok(restored.decisions[0].deletedAt);
  assert.equal(restored.decisions[0].history.length, 3); assert.equal(restored.nextDecisionNumber, 3);
  assert.equal((await readdir(directory)).filter(f => f.endsWith('.json')).length, 1);
  assert.deepEqual(restored.pointHistory, board.pointHistory);
  const summary = (await store.listBoards())[0]; assert.equal('decisions' in summary, false); assert.equal('nextDecisionNumber' in summary, false);
});

test('concurrent independent writers allocate permanent distinct ADR numbers without gaps', async t => {
  const { directory, board, store } = await fixture(t);
  await Promise.all(Array.from({ length: 12 }, (_, index) => new Store(directory).createDecision(board.id, { title: `Décision ${index}` })));
  const decisions = (await store.getBoard(board.id)).decisions;
  assert.deepEqual(decisions.map(d => d.number), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(new Set(decisions.map(d => d.id)).size, 12);
  await store.deleteDecision(board.id, decisions.at(-1)!.id);
  assert.equal((await store.createDecision(board.id, { title: 'Après suppression' })).number, 13);
});

test('lifecycle preserves each transition and timestamp, enforces meaningful acceptance and replacement', async t => {
  const { store, board, setTime } = await fixture(t);
  let decision = await store.createDecision(board.id, { title: 'Architecture' });
  assert.equal(decision.authority, 'contextual'); assert.equal(decision.decidedAt, null);
  await assert.rejects(store.updateDecision(board.id, decision.id, accepted), /Transition/);
  decision = await store.updateDecision(board.id, decision.id, { status: 'discussing' });
  decision = await store.updateDecision(board.id, decision.id, { status: 'proposed' });
  await assert.rejects(store.updateDecision(board.id, decision.id, { status: 'accepted' }), /justification/);
  setTime('2026-11-06T12:00:00.000Z');
  decision = await store.updateDecision(board.id, decision.id, accepted);
  assert.equal(decision.authority, 'binding'); assert.equal(decision.decidedAt, '2026-11-06T12:00:00.000Z');
  await assert.rejects(store.updateDecision(board.id, decision.id, { status: 'draft' }), /Transition/);
  await assert.rejects(store.updateDecision(board.id, decision.id, { status: 'superseded' }), /validée/);
  await assert.rejects(store.updateDecision(board.id, decision.id, { status: 'superseded', supersededBy: decision.id }), /validée/);
  const replacement = await store.createDecision(board.id, { title: 'Nouvelle architecture', ...accepted });
  decision = await store.updateDecision(board.id, decision.id, { status: 'superseded', supersededBy: replacement.id });
  assert.equal(decision.authority, 'historical'); assert.equal(decision.supersededBy, replacement.id);
  assert.deepEqual(decision.history.map(h => h.snapshot.status), ['draft', 'discussing', 'proposed', 'accepted', 'superseded']);
  assert.ok(decision.history.every((h, i) => i === 0 || h.at > decision.history[i - 1].at));
  assert.equal(decision.decidedAt, '2026-11-06T12:00:00.000Z');
  await store.deleteDecision(board.id, replacement.id);
  // Revisions of a historical decision may retain the original successor link.
  await store.updateDecision(board.id, decision.id, { consequences: 'Historique conservé' });
});

test('rejected proposals remain contextual when reopened and deleted decisions are historical/read-only', async t => {
  const { store, board } = await fixture(t);
  let decision = await store.createDecision(board.id, { title: 'Proposition', status: 'discussing' });
  decision = await store.updateDecision(board.id, decision.id, { status: 'rejected', rationale: 'Trop complexe' });
  assert.equal(decision.authority, 'historical'); assert.ok(decision.decidedAt);
  decision = await store.updateDecision(board.id, decision.id, { status: 'discussing' });
  assert.equal(decision.authority, 'contextual');
  await store.deleteDecision(board.id, decision.id);
  assert.equal((await store.listDecisions(board.id)).matching, 0);
  assert.equal((await store.listDecisions(board.id, { deleted: 'only' })).decisions[0].authority, 'historical');
  const deleted = await store.getDecision(board.id, decision.id);
  assert.equal(deleted.history.at(-1)!.action, 'deleted');
  await assert.rejects(store.updateDecision(board.id, decision.id, { title: 'Réécriture' }), /lecture seule/);
  await store.deleteDecision(board.id, decision.id);
  assert.equal((await store.getDecision(board.id, decision.id)).history.length, deleted.history.length);
});

test('partial updates reject stale versions and immutable fields without changing persisted JSON', async t => {
  const { store, board, directory } = await fixture(t);
  const decision = await store.createDecision(board.id, { title: 'Titre', context: 'À garder', tags: ['UX'] });
  const updated = await store.updateDecision(board.id, decision.id, { alternatives: 'Nouvelle piste' }, decision.updatedAt);
  assert.equal(updated.context, 'À garder'); assert.deepEqual(updated.tags, ['UX']);
  const filename = path.join(directory, `${board.id}.json`), before = await readFile(filename, 'utf8');
  await assert.rejects(store.updateDecision(board.id, decision.id, { title: 'Brouillon obsolète' }, decision.updatedAt), (error: unknown) => error instanceof StoreError && error.status === 409);
  await assert.rejects(store.deleteDecision(board.id, decision.id, decision.updatedAt), /changé/);
  for (const patch of [{ number: 999 }, { id: 'other' }, { history: [] }, { createdAt: '2020-01-01' }, { status: 'unknown' }, { title: '' }]) await assert.rejects(store.updateDecision(board.id, decision.id, patch));
  assert.equal(await readFile(filename, 'utf8'), before);
  const noChange = await store.updateDecision(board.id, decision.id, {}, updated.updatedAt);
  assert.equal(noChange.history.length, updated.history.length);
});

test('links are scoped to the project, allow HTTP(S) documents and retain historical card references', async t => {
  const { store, board } = await fixture(t);
  const other = await store.createBoard({ title: 'Autre projet' });
  const otherDecision = await store.createDecision(other.id, { title: 'Ailleurs', ...accepted });
  const column = await store.createColumn(board.id, { title: 'À faire' });
  const card = await store.createCard(board.id, column.id, { title: 'Implémentation' });
  const reference = await store.createDecision(board.id, { title: 'Référence' });
  const links = [{ kind: 'card', target: card.id }, { kind: 'decision', target: reference.id }, { kind: 'url', target: 'https://example.org/design', label: 'Design' }];
  const decision = await store.createDecision(board.id, { title: 'Liens', links, ...accepted });
  assert.equal(decision.links.length, 3); assert.equal((await store.getCard(board.id, card.id)).completed, false);
  for (const invalidLinks of [[{ kind: 'decision', target: otherDecision.id }], [{ kind: 'decision', target: decision.id }], [{ kind: 'card', target: 'missing' }], [{ kind: 'url', target: 'javascript:alert(1)' }], [links[0], links[0]]]) await assert.rejects(store.updateDecision(board.id, decision.id, { links: invalidLinks }));
  await assert.rejects(store.updateDecision(board.id, decision.id, { status: 'superseded', supersededBy: otherDecision.id }));
  await store.deleteCard(board.id, card.id);
  const edited = await store.updateDecision(board.id, decision.id, { context: 'Fiche supprimée depuis' });
  assert.equal(edited.links[0].target, card.id); assert.equal(edited.history[0].snapshot.links[0].target, card.id);
});

test('filters combine type, status, full text, tags, card links and inclusive UTC date ranges', async t => {
  const { store, board, setTime } = await fixture(t);
  const column = await store.createColumn(board.id, { title: 'À faire' });
  const card = await store.createCard(board.id, column.id, { title: 'Tâche' });
  setTime('2026-11-04T23:59:59.999Z');
  const first = await store.createDecision(board.id, { title: 'Architecture', type: 'technical', tags: ['MVP'], links: [{ kind: 'card', target: card.id }], ...accepted });
  setTime('2026-11-05T00:00:00.000Z');
  const second = await store.createDecision(board.id, { title: 'Navigation', type: 'functional', context: 'Rechercher les projets' });
  setTime('2026-11-05T23:59:59.999Z');
  await store.createDecision(board.id, { title: 'Budget', type: 'organization', status: 'rejected', tags: ['MVP'] });
  const query = await store.listDecisions(board.id, { types: ['technical'], statuses: ['accepted'], search: 'adr-001', tag: 'MVP', linkedCardId: card.id, dateFrom: '2026-11-04', dateTo: '2026-11-04' });
  assert.deepEqual(query.decisions.map(d => d.id), [first.id]);
  assert.equal((await store.listDecisions(board.id, { dateFrom: '2026-11-05', dateTo: '2026-11-05' })).matching, 2);
  assert.equal((await store.listDecisions(board.id, { dateField: 'decidedAt', dateFrom: '2026-11-05' })).matching, 1);
  assert.equal((await store.listDecisions(board.id, { search: 'rechercher' })).decisions[0].id, second.id);
  assert.deepEqual((await store.listDecisions(board.id, { sort: 'oldest' })).decisions.map(d => d.number), [1, 2, 3]);
  assert.deepEqual((await store.listDecisions(board.id)).decisions.map(d => d.number), [3, 2, 1]);
  await assert.rejects(store.listDecisions(board.id, { dateFrom: '2026-11-06', dateTo: '2026-11-05' }), /date/);
  await assert.rejects(store.listDecisions(board.id, { dateFrom: '2026-02-30' }));
  assert.equal(decisionAuthority({ status: 'accepted', deletedAt: '2026-11-06T00:00:00.000Z' }), 'historical');
});
