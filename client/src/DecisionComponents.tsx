import type { DecisionStatus } from '../../server/schema';
import { decisionStatuses } from '../../shared/decisions';

export function DecisionTime({ value }: { value: string }) {
  return <time dateTime={value} title={value}>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))} UTC</time>;
}
export function DecisionBadge({ status }: { status: DecisionStatus }) {
  const state = decisionStatuses[status];
  return <span className={`decision-badge decision-${state.color}`}><i />{state.label}</span>;
}
