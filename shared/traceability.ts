import type { Board, EntityRef, Relation } from '../server/schema.js';
import { decisionCode } from './decisions.js';

export const entityLabels: Record<EntityRef['kind'], string> = { card: 'Fiche', decision: 'Décision', document: 'Document', requirement: 'Exigence', url: 'Document externe' };
export const relationLabels: Record<Relation['type'], string> = { relates_to: 'Est associé à', implements: 'Met en œuvre', documents: 'Documente', validates: 'Valide' };
export const entityKey = (ref: EntityRef) => JSON.stringify([ref.kind, ref.id]);
export const sameEntity = (a: EntityRef, b: EntityRef) => a.kind === b.kind && a.id === b.id;
export function describeEntity(board: Board, ref: EntityRef): { title: string; deleted: boolean; missing: boolean } {
  if (ref.kind === 'url') return { title: ref.id, deleted: false, missing: false };
  const item = ref.kind === 'card' ? board.columns.flatMap(c => c.cards).find(c => c.id === ref.id) : ref.kind === 'decision' ? board.decisions.find(d => d.id === ref.id) : board.knowledge.find(k => k.id === ref.id && k.kind === ref.kind);
  if (!item) return { title: `${entityLabels[ref.kind]} supprimée`, deleted: true, missing: true };
  return { title: ref.kind === 'decision' ? `${decisionCode(board.decisions.find(d => d.id === ref.id)!.number)} · ${item.title}` : item.title, deleted: 'deletedAt' in item && !!item.deletedAt, missing: false };
}
export function projectEntities(board: Board): EntityRef[] {
  return [...board.columns.flatMap(c => c.cards.map(card => ({ kind: 'card' as const, id: card.id }))), ...board.decisions.filter(d => !d.deletedAt).map(d => ({ kind: 'decision' as const, id: d.id })), ...board.knowledge.filter(k => !k.deletedAt).map(k => ({ kind: k.kind, id: k.id }))];
}
export type TraceRelation = Relation & { origin: 'relation' | 'decision-link' };
export function allRelations(board: Board): TraceRelation[] {
  // Legacy decision links are projected in both directions without rewriting their history.
  return [...board.relations.map(r => ({ ...r, origin: 'relation' as const })), ...board.decisions.flatMap(d => d.links.map(link => ({ id: `legacy:${d.id}:${link.kind}:${link.target}`, source: { kind: 'decision' as const, id: d.id }, target: { kind: link.kind, id: link.target }, type: 'relates_to' as const, createdAt: d.createdAt, origin: 'decision-link' as const })))];
}
export function relatedEntities(board: Board, entity: EntityRef) {
  return allRelations(board).filter(r => sameEntity(r.source, entity) || sameEntity(r.target, entity)).map(r => {
    const outgoing = sameEntity(r.source, entity), other = outgoing ? r.target : r.source;
    return { ...r, outgoing, other, ...describeEntity(board, other) };
  });
}
export function analyzeImpact(board: Board, decisionId: string) {
  const root: EntityRef = { kind: 'decision', id: decisionId };
  const graph = new Map<string, EntityRef[]>();
  const connect = (a: EntityRef, b: EntityRef) => { const key = entityKey(a); graph.set(key, [...(graph.get(key) ?? []), b]); };
  for (const relation of allRelations(board)) {
    if (describeEntity(board, relation.source).deleted || describeEntity(board, relation.target).deleted) continue;
    connect(relation.source, relation.target); connect(relation.target, relation.source);
  }
  // Gantt predecessors remain a separate relation type, but propagate review impact.
  for (const card of board.columns.flatMap(c => c.cards)) for (const predecessor of card.dependencies) connect({ kind: 'card', id: predecessor }, { kind: 'card', id: card.id });
  const queue: { entity: EntityRef; path: EntityRef[] }[] = [{ entity: root, path: [root] }];
  const seen = new Set([entityKey(root)]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const next of graph.get(entityKey(current.entity)) ?? []) if (!seen.has(entityKey(next))) {
      seen.add(entityKey(next)); queue.push({ entity: next, path: [...current.path, next] });
    }
  }
  return queue.slice(1).map(({ entity, path }) => ({ entity, path, distance: path.length - 1, ...describeEntity(board, entity) }));
}
