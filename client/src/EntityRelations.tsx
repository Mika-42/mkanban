import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, Plus, Save, Unlink } from 'lucide-react';
import type { Board, EntityRef, ImpactReview, Relation } from '../../server/schema';
import { describeEntity, entityKey, entityLabels, projectEntities, relatedEntities, relationLabels, sameEntity } from '../../shared/traceability';
import { decisionCode } from '../../shared/decisions';
import { api } from './api';
import { Modal, Spinner } from './components';
import { DecisionBadge, DecisionTime } from './DecisionComponents';

export type EntityNavigation = (entity: EntityRef) => void;
export function EntityLink({ board, entity, onNavigate, title }: { board: Board; entity: EntityRef; onNavigate?: EntityNavigation; title?: string }) {
  const item = describeEntity(board, entity);
  const label = title ?? item.title;
  return entity.kind === 'url' ? <a href={entity.id} target="_blank" rel="noreferrer">{label}</a> : <button type="button" className="text-button entity-link" disabled={item.missing || !onNavigate} onClick={() => onNavigate?.(entity)}>{entityLabels[entity.kind]} · {label}{item.deleted && ' (supprimé)'}</button>;
}
export function EntityRelations({ board, entity, refresh, onNavigate, readOnly = false }: { board: Board; entity: EntityRef; refresh: () => Promise<void>; onNavigate?: EntityNavigation; readOnly?: boolean }) {
  const [target, setTarget] = useState(''), [url, setUrl] = useState('');
  const [type, setType] = useState<Relation['type']>('relates_to'), [direction, setDirection] = useState('outgoing');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [review, setReview] = useState<ImpactReview | null>(null);
  const candidates = projectEntities(board).filter(e => !sameEntity(e, entity));
  const relations = relatedEntities(board, entity);
  const pending = board.impactReviews.filter(r => !r.reviewedAt && sameEntity(r.entity, entity));
  const act = async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <section className="entity-relations" aria-label="Relations de cet élément"><h3><Link2 size={16} />Relations et traçabilité</h3><p className="hint">Les liens se consultent dans les deux sens. Ils ne changent ni l’état des décisions ni l’avancement des fiches.</p>
    {!!pending.length && <div className="impact-alert"><strong>À réexaminer</strong>{pending.map(r => <button type="button" className="text-button" key={r.id} onClick={() => setReview(structuredClone(r))}>Suite au remplacement de {decisionCode(board.decisions.find(d => d.id === r.decisionId)!.number)} · Réexaminer</button>)}</div>}
    <ul className="entity-relation-list">{relations.map(relation => {
      const decision = relation.other.kind === 'decision' ? board.decisions.find(d => d.id === relation.other.id) : undefined;
      return <li key={relation.id}><div><span className="trace-label">{relation.type === 'relates_to' ? relationLabels[relation.type] : `${relation.outgoing ? '→' : '←'} ${relationLabels[relation.type]}`}</span><EntityLink board={board} entity={relation.other} onNavigate={onNavigate} />{decision && <DecisionBadge status={decision.status} />}{relation.origin === 'decision-link' && <small>Lien issu de la décision · modifiable dans ses liens</small>}</div>{relation.origin === 'relation' && !readOnly && <button type="button" className="icon-button" aria-label={`Retirer la relation avec ${relation.title}`} disabled={busy} onClick={() => void act(() => api(`/boards/${board.id}/relations/${relation.id}`, 'DELETE'))}><Unlink size={15} /></button>}</li>;
    })}</ul>{!relations.length && <p className="hint">Aucune relation pour le moment.</p>}
    {!readOnly && <div className="entity-relation-add"><label>Élément à relier<select aria-label="Élément à relier" value={target} disabled={busy} onChange={e => setTarget(e.target.value)}><option value="">Choisir un élément du projet</option>{(['card', 'decision', 'document', 'requirement'] as const).map(kind => <optgroup key={kind} label={entityLabels[kind]}>{candidates.filter(e => e.kind === kind).map(e => <option key={entityKey(e)} value={entityKey(e)}>{describeEntity(board, e).title}</option>)}</optgroup>)}<option value="url">Document externe (URL)</option></select></label>{target === 'url' && <label>Adresse du document lié<input aria-label="Adresse du document lié" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label>}<div className="trace-field-row"><label>Type de relation<select aria-label="Type de relation" value={type} disabled={busy} onChange={e => setType(e.target.value as Relation['type'])}>{Object.entries(relationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Sens<select aria-label="Sens de la relation" disabled={busy || type === 'relates_to'} value={direction} onChange={e => setDirection(e.target.value)}><option value="outgoing">Cet élément → l’élément lié</option><option value="incoming">L’élément lié → cet élément</option></select></label></div><button type="button" className="button secondary" disabled={busy || !target || target === 'url' && !url.trim()} onClick={() => void act(async () => {
      const other: EntityRef = target === 'url' ? { kind: 'url', id: url.trim() } : (() => { const [kind, id] = JSON.parse(target); return { kind, id }; })();
      const incoming = type !== 'relates_to' && direction === 'incoming';
      await api(`/boards/${board.id}/relations`, 'POST', { source: incoming ? other : entity, target: incoming ? entity : other, type }); setTarget(''); setUrl('');
    })}>{busy ? <Spinner /> : <Plus size={15} />}Ajouter la relation</button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {review && <ImpactReviewEditor review={review} board={board} onClose={() => setReview(null)} onSaved={refresh} />}
  </section>;
}
export function ImpactReviewEditor({ review, board, onClose, onSaved }: { review: ImpactReview; board: Board; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reviewed, setReviewed] = useState(true), [note, setNote] = useState(review.note);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const close = () => { if (!busy) onClose(); };
  return createPortal(<Modal title="Réexaminer un élément" onClose={close}><form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); try { await api(`/boards/${board.id}/impact-reviews/${review.id}`, 'PATCH', { reviewed, note, expectedUpdatedAt: review.updatedAt }); await onSaved(); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><div className="modal-body form-stack"><h2>{review.entityTitle}</h2><p className="muted">Signalé le <DecisionTime value={review.createdAt} />. Cette revue ne termine pas la fiche et ne modifie pas le document.</p><label htmlFor="review-state">État du réexamen</label><select id="review-state" value={reviewed ? 'reviewed' : 'pending'} onChange={e => setReviewed(e.target.value === 'reviewed')}><option value="reviewed">Réexaminé</option><option value="pending">À réexaminer</option></select><label htmlFor="review-note">Note de réexamen</label><textarea id="review-note" rows={4} maxLength={5000} value={note} onChange={e => setNote(e.target.value)} /></div><footer className="modal-footer trace-review-footer">{error && <p role="alert" className="form-error">{error}</p>}<button type="button" className="button secondary" disabled={busy} onClick={close}>Annuler</button><button className="button primary" disabled={busy}>{busy ? <Spinner /> : <Save size={15} />}Enregistrer le réexamen</button></footer></form></Modal>, document.body);
}
