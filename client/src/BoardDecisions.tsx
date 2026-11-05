import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, Clock3, FileText, Link2, Pencil, Plus, Search, SlidersHorizontal } from 'lucide-react';
import type { Board, Card, Decision, DecisionQuery, DecisionStatus, DecisionType } from '../../server/schema';
import { decisionAuthority, decisionCode, decisionStatuses, decisionTypes, filterDecisions } from '../../shared/decisions';
import { DecisionEditor } from './DecisionEditor';
import { DecisionBadge, DecisionTime } from './DecisionComponents';
import type { EntityNavigation } from './EntityRelations';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const contentFields = [['context', 'Contexte'], ['alternatives', 'Alternatives'], ['outcome', 'Décision retenue'], ['rationale', 'Justification'], ['consequences', 'Conséquences']] as const;
const initialQuery: DecisionQuery = { search: '', dateField: 'createdAt', deleted: 'exclude', sort: 'newest' };
export function BoardDecisions({ board, refresh, onCard, onNavigate }: { board: Board; refresh: () => Promise<void>; onCard: (card: Card) => void; onNavigate: EntityNavigation }) {
  const [query, setQuery] = useState<DecisionQuery>(initialQuery);
  const [advanced, setAdvanced] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const advancedCount = [query.dateFrom, query.dateTo, query.tag, query.linkedCardId, query.deleted !== 'exclude', query.sort !== 'newest', query.dateField !== 'createdAt'].filter(Boolean).length;
  const [editor, setEditor] = useState<Decision | 'new' | null>(null);
  const patchQuery = (patch: Partial<DecisionQuery>) => setQuery(current => ({ ...current, ...patch }));
  const invalidDates = !!(query.dateFrom && query.dateTo && query.dateFrom > query.dateTo);
  const decisions = invalidDates ? [] : filterDecisions(board.decisions, query);
  const active = board.decisions.filter(d => !d.deletedAt);
  const tags = [...new Set(board.decisions.flatMap(d => d.tags))].sort((a, b) => a.localeCompare(b, 'fr'));
  const cards = board.columns.flatMap(c => c.cards);
  const openDecision = (decision: Decision) => setEditor(structuredClone(decision));
  return <section className="decision-panel" role="tabpanel" id="decisions-panel" aria-labelledby="decisions-tab">
    <div className="decision-heading"><div><span className="decision-eyebrow"><BookOpen size={15} /> LA MÉMOIRE DU PROJET</span><h2>Journal des décisions</h2><p>Le contexte, les choix et leurs raisons, au fil du projet.</p></div><button className="button primary" onClick={() => setEditor('new')}><Plus size={17} />Nouvelle décision</button></div>
    <div className="decision-status-filters" aria-label="Filtrer par état">{(Object.keys(decisionStatuses) as DecisionStatus[]).map(status => <button key={status} className={query.statuses?.includes(status) ? 'selected' : ''} aria-pressed={!!query.statuses?.includes(status)} onClick={() => patchQuery({ statuses: query.statuses?.includes(status) ? undefined : [status] })}><DecisionBadge status={status} /><span>{active.filter(d => d.status === status).length}</span></button>)}</div>
    <div className="decision-policy"><BookOpen size={17} /><p><strong>Validées :</strong> références officielles. <strong>Propositions :</strong> contexte. <strong>Rejetées, remplacées ou supprimées :</strong> historique. L’implémentation se suit dans les fiches liées.</p></div>
    <div className="decision-filters">
      <label className="decision-search">Rechercher<div className="search-field"><Search size={15} /><input aria-label="Rechercher des décisions" placeholder="Titre, numéro ADR, contenu…" value={query.search} onChange={e => patchQuery({ search: e.target.value })} /></div></label>
      <label>Type de décision<select aria-label="Type de décision" value={query.types?.[0] ?? ''} onChange={e => patchQuery({ types: e.target.value ? [e.target.value as DecisionType] : undefined })}><option value="">Tous les types</option>{Object.entries(decisionTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>État de la décision<select aria-label="État de la décision" value={query.statuses?.[0] ?? ''} onChange={e => patchQuery({ statuses: e.target.value ? [e.target.value as DecisionStatus] : undefined })}><option value="">Tous les états</option>{Object.entries(decisionStatuses).map(([value, state]) => <option key={value} value={value}>{state.label}</option>)}</select></label>
      <div className="decision-filter-actions"><button className="text-button" aria-expanded={advanced} aria-controls="decision-extra-filters" onClick={() => setAdvanced(!advanced)}><SlidersHorizontal size={14} />Dates et autres filtres{advancedCount > 0 && <span className="filter-count">{advancedCount}</span>}</button><button className="text-button" onClick={() => setQuery(initialQuery)}>Réinitialiser les filtres</button></div>
      <div className="decision-extra-filters" id="decision-extra-filters" hidden={!advanced}>
      <label>Date à filtrer<select aria-label="Date à filtrer" value={query.dateField} onChange={e => patchQuery({ dateField: e.target.value as DecisionQuery['dateField'] })}><option value="createdAt">Création</option><option value="updatedAt">Dernière modification</option><option value="decidedAt">Validation ou rejet</option><option value="statusChangedAt">Dernier changement d’état</option></select></label>
      <label>Du (UTC)<input type="date" value={query.dateFrom ?? ''} onChange={e => patchQuery({ dateFrom: e.target.value || undefined })} /></label>
      <label>Au (UTC)<input type="date" value={query.dateTo ?? ''} onChange={e => patchQuery({ dateTo: e.target.value || undefined })} /></label>
      <label>Étiquette de décision<select aria-label="Étiquette de décision" value={query.tag ?? ''} onChange={e => patchQuery({ tag: e.target.value || undefined })}><option value="">Toutes les étiquettes</option>{tags.map(tag => <option key={tag}>{tag}</option>)}</select></label>
      <label>Fiche liée<select aria-label="Fiche liée" value={query.linkedCardId ?? ''} onChange={e => patchQuery({ linkedCardId: e.target.value || undefined })}><option value="">Toutes les fiches</option>{cards.map(card => <option key={card.id} value={card.id}>{card.title}</option>)}</select></label>
      <label>Afficher<select aria-label="Afficher" value={query.deleted} onChange={e => patchQuery({ deleted: e.target.value as DecisionQuery['deleted'] })}><option value="exclude">Décisions non supprimées</option><option value="include">Toutes, même supprimées</option><option value="only">Décisions supprimées</option></select></label>
      <label>Trier les décisions<select aria-label="Trier les décisions" value={query.sort} onChange={e => patchQuery({ sort: e.target.value as DecisionQuery['sort'] })}><option value="newest">Plus récentes d’abord</option><option value="oldest">Plus anciennes d’abord</option><option value="updated">Dernière modification</option><option value="number">Numéro ADR</option></select></label>
      </div>
    </div>
    {invalidDates && <p className="form-error" role="alert">La date de début doit précéder la date de fin.</p>}
    <div className="decision-results" role="status">{decisions.length} décision{decisions.length > 1 ? 's' : ''} affichée{decisions.length > 1 ? 's' : ''} · {active.length} dans le journal</div>
    {!decisions.length ? <div className="decision-empty"><FileText size={30} /><h3>{board.decisions.length ? 'Aucune décision ne correspond' : 'Gardez une trace de vos choix'}</h3><p>{board.decisions.length ? 'Ajustez les filtres pour retrouver une décision.' : 'Documentez une première décision et donnez du contexte aux prochains choix.'}</p>{!board.decisions.length && <button className="button secondary" onClick={() => setEditor('new')}><Plus size={16} />Créer une décision</button>}</div> : <ol className="decision-timeline">{decisions.map(decision => {
      const successor = board.decisions.find(d => d.id === decision.supersededBy);
      const isExpanded = expanded.has(decision.id), contentId = `decision-content-${decision.id}`;
      return <li key={decision.id} className={`decision-bubble decision-${decisionStatuses[decision.status].color} ${decision.deletedAt ? 'decision-deleted' : ''}`}>
        <button className="decision-open" aria-label={`${isExpanded ? 'Replier' : 'Déplier'} ${decisionCode(decision.number)} : ${decision.title}`} aria-expanded={isExpanded} aria-controls={contentId} onClick={() => toggleExpanded(decision.id)}><span className="decision-bubble-top"><span className="decision-number">{decisionCode(decision.number)}</span><span className="decision-type">{decisionTypes[decision.type]}</span><DecisionBadge status={decision.status} />{decision.deletedAt && <span className="decision-removed-label">Supprimée</span>}</span><h3>{decision.title}</h3><span className="decision-bubble-meta"><span><Clock3 size={13} />Créée le <DecisionTime value={decision.createdAt} /></span>{decision.decidedAt && <span>Dernière validation ou rejet : <DecisionTime value={decision.decidedAt} /></span>}<span className={`decision-authority ${decisionAuthority(decision)}`}>{decisionAuthority(decision) === 'binding' ? 'Référence officielle' : decisionAuthority(decision) === 'historical' ? 'Historique' : 'Proposition'}</span></span>{!!decision.tags.length && <span className="decision-tags">{decision.tags.map(tag => <span key={tag}>{tag}</span>)}</span>}</button>
        <div className="decision-bubble-actions"><button aria-label={`${isExpanded ? 'Replier' : 'Déplier'} le contenu ${decisionCode(decision.number)}`} aria-expanded={isExpanded} aria-controls={contentId} onClick={() => toggleExpanded(decision.id)}>{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{isExpanded ? 'Replier' : 'Lire la décision'}</button><button aria-label={`Ouvrir ${decisionCode(decision.number)} : ${decision.title}`} onClick={() => openDecision(decision)}><Pencil size={13} />{decision.deletedAt ? 'Consulter l’historique' : 'Modifier'}</button></div>
        <div id={contentId} className="decision-expanded" role="region" aria-label={`Contenu complet ${decisionCode(decision.number)}`} hidden={!isExpanded}>{isExpanded && contentFields.map(([key, label]) => <section key={key}><h4>{label}</h4><div className="markdown"><Markdown remarkPlugins={[remarkGfm]}>{decision[key] || '*Non renseigné*'}</Markdown></div></section>)}</div>
        {(successor || decision.links.length > 0) && <div className="decision-bubble-links">{successor && <button onClick={() => openDecision(successor)}><Link2 size={13} />Remplacée par {decisionCode(successor.number)} · {successor.title}</button>}{decision.links.map(link => {
          const card = link.kind === 'card' ? cards.find(c => c.id === link.target) : undefined;
          const related = link.kind === 'decision' ? board.decisions.find(d => d.id === link.target) : undefined;
          return card ? <button key={`card:${link.target}`} onClick={() => onCard(card)}><FileText size={13} />{card.title} · {card.completed ? 'Terminée' : 'À réaliser'}</button> : related ? <button key={`decision:${link.target}`} onClick={() => openDecision(related)}><Link2 size={13} />{decisionCode(related.number)} · {related.title}</button> : link.kind === 'url' ? <a key={`url:${link.target}`} href={link.target} target="_blank" rel="noreferrer"><Link2 size={13} />{link.label || link.target}</a> : <span key={`${link.kind}:${link.target}`} className="hint">Fiche supprimée</span>;
        })}</div>}
      </li>;
    })}</ol>}
    {editor && <DecisionEditor key={editor === 'new' ? 'new' : editor.id} decision={editor === 'new' ? null : editor} board={board} onClose={() => setEditor(null)} onSaved={refresh} onNavigate={entity => { setEditor(null); onNavigate(entity); }} />}
  </section>;
}
