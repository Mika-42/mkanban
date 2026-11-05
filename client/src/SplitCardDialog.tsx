import { useState } from 'react';
import { GitFork } from 'lucide-react';
import type { Card } from '../../server/schema';
import { api } from './api';
import { Modal, Spinner } from './components';

export function SplitCardDialog({ card, boardId, onClose, onSaved }: { card: Card; boardId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [points, setPoints] = useState(Math.floor(card.points / 2));
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Modal title="Une idée, deux cartes" onClose={() => { if (!busy) onClose(); }}><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await api(`/boards/${boardId}/cards/${card.id}/split`, 'POST', { title, points, checklistIds: selected, expectedUpdatedAt: card.updatedAt }); await onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><div className="modal-body form-stack"><p className="muted">La nouvelle carte sera placée juste après l’originale. Description et propriétés seront copiées.</p><label htmlFor="split-title">Titre de la nouvelle carte</label><input autoFocus id="split-title" required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="Une tâche plus petite et plus claire" /><label htmlFor="split-points">Points à transférer</label><input id="split-points" type="number" required min={0} max={card.points} value={points} onChange={e => setPoints(Number(e.target.value))} /><p className="hint">{card.points - points} points resteront sur la carte originale. Le total est conservé.</p>{!!card.checklist.length && <><label>Éléments à transférer</label>{card.checklist.map(i => <label className="split-item" key={i.id}><input type="checkbox" checked={selected.includes(i.id)} onChange={e => setSelected(e.target.checked ? [...selected, i.id] : selected.filter(id => id !== i.id))} />{i.text}</label>)}</>}{error && <div className="form-error" role="alert">{error}</div>}</div><footer className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Annuler</button><button className="button primary" disabled={busy || !title.trim()}>{busy ? <Spinner /> : <GitFork size={16} />}Scinder la carte</button></footer></form></Modal>;
}
