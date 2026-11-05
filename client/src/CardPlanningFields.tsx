import { useState } from 'react';
import { CalendarDays, GitBranch, Search } from 'lucide-react';
import type { Board, Card, CardInput } from '../../server/schema';

export function CardPlanningFields({ card, board, draft, onChange }: { card: Card; board: Board; draft: CardInput; onChange: (patch: Partial<CardInput>) => void }) {
  const [search, setSearch] = useState('');
  const cards = board.columns.flatMap(c => c.cards);
  const forbidden = new Set([card.id]);
  let changed = true;
  while (changed) { changed = false; for (const candidate of cards) if (!forbidden.has(candidate.id) && candidate.dependencies.some(id => forbidden.has(id))) { forbidden.add(candidate.id); changed = true; } }
  const candidates = cards.filter(c => c.id !== card.id && c.title.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')));
  const successors = cards.filter(c => c.dependencies.includes(card.id));
  const pending = draft.dependencies.filter(id => !cards.find(c => c.id === id)?.completed);
  return <section className="card-planning" aria-label="Planning de la fiche">
    <h3><CalendarDays size={17} />Planning et dépendances</h3>
    <div className="planning-dates"><label htmlFor="card-start">Début planifié<input id="card-start" type="date" max={draft.dueDate || undefined} value={draft.startDate || ''} onChange={e => onChange({ startDate: e.target.value || null })} /></label><label htmlFor="card-date">Échéance<input id="card-date" type="date" min={draft.startDate || undefined} value={draft.dueDate || ''} onChange={e => onChange({ dueDate: e.target.value || null })} /></label></div>
    <p className="hint">Dates inclusives, en jours calendaires. Une seule date représente un jalon d’un jour dans le Gantt.</p>
    <div className="section-heading"><h3><GitBranch size={16} />Dépend de</h3><span className="muted small">{draft.dependencies.length} prédécesseur{draft.dependencies.length > 1 ? 's' : ''}</span></div>
    <div className="search-field dependency-search"><Search size={15} /><input aria-label="Rechercher un prédécesseur" placeholder="Rechercher une fiche…" value={search} onChange={e => setSearch(e.target.value)} /></div>
    <div className="dependency-list">{candidates.map(candidate => <label key={candidate.id} className={forbidden.has(candidate.id) ? 'dependency-unavailable' : ''}><input type="checkbox" aria-label={`Dépend de : ${candidate.title}`} disabled={forbidden.has(candidate.id)} checked={draft.dependencies.includes(candidate.id)} onChange={e => onChange({ dependencies: e.target.checked ? [...draft.dependencies, candidate.id] : draft.dependencies.filter(id => id !== candidate.id) })} /><span>{candidate.title}<small>{forbidden.has(candidate.id) ? 'Créerait une dépendance circulaire' : candidate.completed ? 'Terminée' : 'Non terminée'}</small></span></label>)}{!candidates.length && <p className="hint">Aucune autre fiche ne correspond.</p>}</div>
    {!draft.completed && pending.length > 0 && <p className="planning-notice">Cette fiche attend {pending.length} prédécesseur{pending.length > 1 ? 's' : ''} non terminé{pending.length > 1 ? 's' : ''}. Les dépendances signalent le blocage sans empêcher une clôture manuelle.</p>}
    {!!successors.length && <p className="hint">Fiches qui dépendent de celle-ci : {successors.map(c => c.title).join(', ')}.</p>}
  </section>;
}
