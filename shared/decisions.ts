import type { Decision, DecisionQuery, DecisionStatus, DecisionType } from '../server/schema.js';

export const decisionStatuses: Record<DecisionStatus, { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: 'gray' }, discussing: { label: 'En réflexion', color: 'blue' },
  proposed: { label: 'À valider', color: 'orange' }, accepted: { label: 'Validée', color: 'green' },
  rejected: { label: 'Rejetée', color: 'red' }, superseded: { label: 'Remplacée', color: 'gray' },
};
export const decisionTypes: Record<DecisionType, string> = { technical: 'Technique', functional: 'Fonctionnelle', product: 'Produit', organization: 'Organisation', other: 'Autre' };
export const decisionTransitions: Record<DecisionStatus, DecisionStatus[]> = {
  draft: ['discussing', 'rejected'], discussing: ['draft', 'proposed', 'rejected'],
  proposed: ['discussing', 'accepted', 'rejected'], accepted: ['superseded'],
  rejected: ['discussing'], superseded: [],
};
export const decisionCode = (number: number) => `ADR-${String(number).padStart(3, '0')}`;
export const decisionAuthority = (decision: Pick<Decision, 'status' | 'deletedAt'>) => decision.deletedAt || ['rejected', 'superseded'].includes(decision.status) ? 'historical' : decision.status === 'accepted' ? 'binding' : 'contextual';
export const decisionPolicy = {
  binding: 'Only active accepted decisions are official project constraints. Acceptance does not mean implementation is complete; track implementation in linked Kanban cards.',
  contextual: 'Draft, discussing and proposed decisions provide context, never definitive instructions. Obtain user approval before accepting a decision.',
  historical: 'Rejected, superseded and deleted decisions are historical only and must not guide implementation. Follow supersededBy to the successor.',
};
export function filterDecisions(decisions: Decision[], query: DecisionQuery) {
  const search = query.search.trim().toLocaleLowerCase('fr');
  return decisions.filter(d => {
    if (query.deleted === 'exclude' && d.deletedAt || query.deleted === 'only' && !d.deletedAt) return false;
    if (query.statuses?.length && !query.statuses.includes(d.status) || query.types?.length && !query.types.includes(d.type)) return false;
    if (query.tag && !d.tags.includes(query.tag) || query.linkedCardId && !d.links.some(l => l.kind === 'card' && l.target === query.linkedCardId)) return false;
    const date = d[query.dateField]?.slice(0, 10);
    if ((query.dateFrom || query.dateTo) && (!date || query.dateFrom && date < query.dateFrom || query.dateTo && date > query.dateTo)) return false;
    return !search || [decisionCode(d.number), d.title, d.context, d.alternatives, d.outcome, d.rationale, d.consequences, ...d.tags].join('\n').toLocaleLowerCase('fr').includes(search);
  }).sort((a, b) => query.sort === 'number' ? a.number - b.number : query.sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) || a.number - b.number : query.sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number : b.createdAt.localeCompare(a.createdAt) || b.number - a.number);
}
