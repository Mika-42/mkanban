import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import type { Board, Card } from '../../server/schema';
import { api } from './api';
import { Avatar, Modal, Spinner } from './components';

export function AssignCardDialog({ card, board, onClose, onSaved }: { card: Card; board: Board; onClose: () => void; onSaved: () => Promise<void> }) {
  const [members, setMembers] = useState([...card.members]), [added, setAdded] = useState<string[]>([]), [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const candidates = [...new Set([...board.columns.flatMap(c => c.cards.flatMap(c => c.members)), ...members, ...added])].sort((a, b) => a.localeCompare(b, 'fr'));
  const close = () => { if (!busy) onClose(); };
  const add = () => { const value = name.trim(); if (!value || members.length >= 20) return; setAdded(values => [...new Set([...values, value])]); setMembers(values => [...new Set([...values, value])]); setName(''); };
  return <Modal title="Assigner la fiche" onClose={close}><form onSubmit={async e => {
    e.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await api(`/boards/${board.id}/cards/${card.id}`, 'PATCH', { members, expectedUpdatedAt: card.updatedAt }); await onSaved(); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}><div className="modal-body form-stack"><h2 className="quick-card-title">{card.title}</h2><p className="muted">Choisissez un ou plusieurs membres, ou ajoutez un nom. Les autres propriétés de la fiche sont conservées.</p><fieldset className="quick-members" disabled={busy}><legend>Membres de la fiche</legend>{candidates.map(member => <label key={member}><input type="checkbox" aria-label={`Assigner à ${member}`} checked={members.includes(member)} disabled={!members.includes(member) && members.length >= 20} onChange={e => setMembers(e.target.checked ? [...members, member] : members.filter(m => m !== member))} /><Avatar name={member} small /><span>{member}</span></label>)}{!candidates.length && <p className="hint">Ajoutez le premier membre de cette fiche.</p>}</fieldset><label htmlFor="quick-member">Ajouter un membre</label><div className="quick-member-add"><input id="quick-member" maxLength={80} placeholder="Nom du membre" value={name} disabled={busy} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /><button type="button" className="button secondary" disabled={busy || !name.trim() || members.length >= 20} onClick={add}><Plus size={15} />Ajouter</button></div><div className="quick-members-footer"><span className="hint">{members.length}/20 membres</span><button type="button" className="text-button" disabled={busy || !members.length} onClick={() => setMembers([])}>Retirer tous les membres</button></div>{error && <div className="form-error" role="alert">{error}</div>}</div><footer className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={close}>Annuler</button><button className="button primary" disabled={busy}>{busy ? <Spinner /> : <Save size={15} />}Enregistrer l’assignation</button></footer></form></Modal>;
}

export function DeleteCardDialog({ card, boardId, onClose, onSaved }: { card: Card; boardId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const close = () => { if (!busy) onClose(); };
  return <Modal title="Supprimer cette carte ?" onClose={close}><div className="modal-body form-stack"><h2 className="quick-card-title">{card.title}</h2><p className="muted">La carte et sa checklist seront définitivement supprimées. Les liens des autres fiches vers celle-ci seront retirés.</p>{error && <div className="form-error" role="alert">{error}</div>}</div><footer className="modal-footer"><button className="button secondary" disabled={busy} onClick={close}>Annuler</button><button className="button danger" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await api(`/boards/${boardId}/cards/${card.id}`, 'DELETE'); await onSaved(); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{busy ? <Spinner /> : <Trash2 size={15} />}Supprimer</button></footer></Modal>;
}
