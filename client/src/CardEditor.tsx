import { useState, type FormEvent } from 'react';
import { AlignLeft, Check, CheckSquare2, Circle, Flag, GitFork, Plus, Save, Trash2, X, Eye, Code2, CalendarDays, Users, Diamond, ArrowRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Board, Card, CardInput } from '../../server/schema';
import { api } from './api';
import { Avatar, Confirm, Modal, Spinner } from './components';
import { CardPlanningFields } from './CardPlanningFields';

export function CardEditor({ card, board, onClose, onSaved }: { card: Card; board: Board; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<CardInput>(() => structuredClone(card));
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [item, setItem] = useState('');
  const [member, setMember] = useState('');
  const [flag, setFlag] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [split, setSplit] = useState(false);
  const [moveTo, setMoveTo] = useState(card.columnId);
  const base = `/boards/${board.id}/cards/${card.id}`;
  const update = <K extends keyof CardInput>(key: K, value: CardInput[K]) => setDraft(d => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(card) || moveTo !== card.columnId;
  const close = () => { if (!dirty || window.confirm('Abandonner les modifications non enregistrées ?')) onClose(); };
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await onSaved(); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await act(async () => {
      await api(base, 'PATCH', { ...draft, expectedUpdatedAt: card.updatedAt });
      if (moveTo !== card.columnId) await api(`${base}/move`, 'POST', { columnId: moveTo, index: board.columns.find(c => c.id === moveTo)?.cards.length || 0 });
    });
  };
  const addItem = () => { if (item.trim()) { update('checklist', [...draft.checklist, { id: crypto.randomUUID(), text: item.trim(), done: false }]); setItem(''); } };
  const addValue = (key: 'members' | 'flags', value: string, clear: () => void) => {
    if (value.trim() && !draft[key].includes(value.trim())) update(key, [...draft[key], value.trim()]); clear();
  };
  const done = draft.checklist.filter(i => i.done).length;
  return <>
    <Modal title={`CARTE · ${board.columns.find(c => c.id === card.columnId)?.title || ''}`} onClose={close} wide>
      <form onSubmit={save}><div className="modal-body card-editor">
        <div className="card-title-edit"><button type="button" className={`completion large ${draft.completed ? 'checked' : ''}`} aria-label={draft.completed ? 'Marquer non terminée' : 'Marquer terminée'} onClick={() => update('completed', !draft.completed)}>{draft.completed ? <Check size={19} /> : <Circle size={23} />}</button><input aria-label="Titre de la carte" value={draft.title} required maxLength={200} onChange={e => update('title', e.target.value)} /></div>
        {draft.completed && <div className="completed-notice"><Check size={15} /> Cette carte est terminée</div>}
        <div className="editor-grid"><div className="editor-content">
          <div className="section-heading"><h3><AlignLeft size={17} /> Description</h3><div className="segmented"><button type="button" className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}><Code2 size={14} />Écrire</button><button type="button" className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}><Eye size={14} />Aperçu</button></div></div>
          {tab === 'edit' ? <textarea className="markdown-input" aria-label="Description Markdown" value={draft.description} onChange={e => update('description', e.target.value)} placeholder={'Décrivez cette idée…\n\nLe Markdown est le bienvenu : **gras**, listes, liens.'} rows={9} maxLength={100000} /> : <div className="markdown-preview markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.description || '*Pas encore de description.*'}</ReactMarkdown></div>}
          <span className="hint markdown-hint">Markdown pris en charge</span>
          <div className="section-heading checklist-heading"><h3><CheckSquare2 size={17} /> Checklist</h3><span className="muted small">{done}/{draft.checklist.length}</span></div>
          {!!draft.checklist.length && <div className="progress-track"><span style={{ width: `${done / draft.checklist.length * 100}%` }} /></div>}
          <div className="checklist">{draft.checklist.map(entry => <div className={`checklist-row ${entry.done ? 'is-done' : ''}`} key={entry.id}><input type="checkbox" aria-label={`Terminer : ${entry.text}`} checked={entry.done} onChange={e => update('checklist', draft.checklist.map(i => i.id === entry.id ? { ...i, done: e.target.checked } : i))} /><input aria-label="Texte de l’élément" value={entry.text} maxLength={1000} required onChange={e => update('checklist', draft.checklist.map(i => i.id === entry.id ? { ...i, text: e.target.value } : i))} /><button type="button" className="icon-button" aria-label={`Supprimer : ${entry.text}`} onClick={() => update('checklist', draft.checklist.filter(i => i.id !== entry.id))}><X size={15} /></button></div>)}</div>
          <div className="inline-add"><Plus size={16} /><input aria-label="Nouvel élément de checklist" placeholder="Ajouter un élément…" value={item} maxLength={1000} onChange={e => setItem(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }} /><button type="button" className="text-button" disabled={!item.trim()} onClick={addItem}>Ajouter</button></div>
          <CardPlanningFields card={card} board={board} draft={draft} onChange={patch => setDraft(d => ({ ...d, ...patch }))} />
        </div><aside className="editor-properties">
          <h4>PROPRIÉTÉS</h4>
          <label htmlFor="card-column"><ArrowRight size={15} />Colonne</label><select id="card-column" value={moveTo} onChange={e => setMoveTo(e.target.value)}>{board.columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
          <label htmlFor="card-points"><Diamond size={15} />Story points</label><input id="card-points" type="number" min={0} max={999} required value={draft.points} onChange={e => update('points', Number(e.target.value))} />
          <label htmlFor="card-member"><Users size={15} />Membres</label><div className="property-tags">{draft.members.map(name => <span className="member-chip" key={name}><Avatar name={name} small />{name}<button type="button" aria-label={`Retirer ${name}`} onClick={() => update('members', draft.members.filter(n => n !== name))}><X size={12} /></button></span>)}</div><div className="property-add"><input id="card-member" placeholder="Nom du membre" maxLength={80} value={member} onChange={e => setMember(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValue('members', member, () => setMember('')); } }} /><button type="button" aria-label="Ajouter le membre" disabled={!member.trim() || draft.members.length >= 20} onClick={() => addValue('members', member, () => setMember(''))}><Plus size={16} /></button></div>
          <label htmlFor="card-flag"><Flag size={15} />Étiquettes / flags</label><div className="property-tags">{draft.flags.map(name => <span className={`flag-tag ${flagColor(name)}`} key={name}>{name}<button type="button" aria-label={`Retirer ${name}`} onClick={() => update('flags', draft.flags.filter(n => n !== name))}><X size={12} /></button></span>)}</div><div className="property-add"><input id="card-flag" placeholder="Nouvelle étiquette" maxLength={40} value={flag} list="flag-suggestions" onChange={e => setFlag(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValue('flags', flag, () => setFlag('')); } }} /><button type="button" aria-label="Ajouter l’étiquette" disabled={!flag.trim() || draft.flags.length >= 15} onClick={() => addValue('flags', flag, () => setFlag(''))}><Plus size={16} /></button></div><datalist id="flag-suggestions">{['Priorité haute', 'Design', 'Technique', 'Contenu', 'Produit', 'Idée', 'Bug', 'Bloqué'].map(f => <option key={f}>{f}</option>)}</datalist>
        </aside></div>
        {error && <div role="alert" className="form-error">{error}</div>}
      </div><footer className="modal-footer editor-footer"><div><button type="button" className="button quiet" disabled={busy} onClick={() => { if (dirty) { setError('Enregistrez vos modifications avant de scinder la carte.'); return; } setSplit(true); }}><GitFork size={16} />Scinder</button><button type="button" className="icon-button danger-text" aria-label="Supprimer la carte" disabled={busy} onClick={() => setConfirm(true)}><Trash2 size={17} /></button></div><div><button type="button" className="button secondary" disabled={busy} onClick={close}>Annuler</button><button type="submit" className="button primary" disabled={busy}>{busy ? <Spinner /> : <Save size={16} />}Enregistrer</button></div></footer></form>
    </Modal>
    {confirm && <Confirm title="Supprimer cette carte ?" description="La carte et sa checklist seront définitivement supprimées. Les liens des autres fiches vers celle-ci seront retirés." busy={busy} onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void act(() => api(base, 'DELETE')); }} />}
    {split && <SplitDialog card={card} boardId={board.id} onClose={() => setSplit(false)} onSaved={async () => { await onSaved(); onClose(); }} />}
  </>;
}

export function flagColor(name: string) {
  if (/priorité|bug|bloqué|urgent/i.test(name)) return 'rose';
  if (/design|idée/i.test(name)) return 'violet';
  if (/tech/i.test(name)) return 'blue';
  if (/contenu/i.test(name)) return 'orange';
  return 'green';
}

function SplitDialog({ card, boardId, onClose, onSaved }: { card: Card; boardId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [points, setPoints] = useState(Math.floor(card.points / 2));
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Modal title="Une idée, deux cartes" onClose={onClose}><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await api(`/boards/${boardId}/cards/${card.id}/split`, 'POST', { title, points, checklistIds: selected }); await onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><div className="modal-body form-stack"><p className="muted">La nouvelle carte sera placée juste après l’originale. Description et propriétés seront copiées.</p><label htmlFor="split-title">Titre de la nouvelle carte</label><input autoFocus id="split-title" required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="Une tâche plus petite et plus claire" /><label htmlFor="split-points">Points à transférer</label><input id="split-points" type="number" required min={0} max={card.points} value={points} onChange={e => setPoints(Number(e.target.value))} /><p className="hint">{card.points - points} points resteront sur la carte originale. Le total est conservé.</p>{!!card.checklist.length && <><label>Éléments à transférer</label>{card.checklist.map(i => <label className="split-item" key={i.id}><input type="checkbox" checked={selected.includes(i.id)} onChange={e => setSelected(e.target.checked ? [...selected, i.id] : selected.filter(id => id !== i.id))} />{i.text}</label>)}</>}{error && <div className="form-error" role="alert">{error}</div>}</div><footer className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Annuler</button><button className="button primary" disabled={busy || !title.trim()}>{busy ? <Spinner /> : <GitFork size={16} />}Scinder la carte</button></footer></form></Modal>;
}
