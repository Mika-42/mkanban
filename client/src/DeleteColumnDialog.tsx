import { useState } from 'react';
import { ArrowRight, Trash2 } from 'lucide-react';
import type { Board, Column } from '../../server/schema';
import { api } from './api';
import { Modal, Spinner } from './components';

export function DeleteColumnDialog({ column, board, onClose, onDeleted }: { column: Column; board: Board; onClose: () => void; onDeleted: () => Promise<void> }) {
  const targets = board.columns.filter(c => c.id !== column.id);
  const [mode, setMode] = useState<'move' | 'delete' | ''>('');
  const [targetId, setTargetId] = useState(targets[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const count = column.cards.length;
  const valid = !count || mode === 'delete' || (mode === 'move' && targets.some(c => c.id === targetId));
  const close = () => { if (!busy) onClose(); };
  return <Modal title={`Supprimer « ${column.title} » ?`} onClose={close}>
    <form onSubmit={async e => {
      e.preventDefault();
      if (!valid || busy) return;
      setBusy(true); setError('');
      const options = !count ? { mode: 'empty' } : mode === 'move' ? { mode, targetColumnId: targetId } : { mode, expectedCardIds: column.cards.map(c => c.id) };
      try {
        await api(`/boards/${board.id}/columns/${column.id}`, 'DELETE', options);
        await onDeleted(); onClose();
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>
      <div className="modal-body form-stack">
        {count ? <>
          <p className="muted">Cette colonne contient <strong>{count} fiche{count > 1 ? 's' : ''}</strong>. Choisissez ce qu’elles doivent devenir avant de supprimer la colonne.</p>
          <fieldset className="column-delete-options" disabled={busy}>
            <legend className="sr-only">Que faire des fiches ?</legend>
            <label className={`delete-option ${mode === 'move' ? 'selected' : ''} ${!targets.length ? 'unavailable' : ''}`}>
              <input type="radio" name="column-deletion" value="move" checked={mode === 'move'} disabled={!targets.length} onChange={() => setMode('move')} />
              <span><strong><ArrowRight size={16} />Déplacer toutes les fiches</strong><span>Les conserver dans une autre colonne de ce projet.</span></span>
            </label>
            {!targets.length && <p className="hint">Créez une autre colonne pour pouvoir y déplacer les fiches.</p>}
            {mode === 'move' && <div className="move-column-target"><label htmlFor="delete-column-target">Colonne de destination</label><select id="delete-column-target" value={targetId} onChange={e => setTargetId(e.target.value)}><option value="" disabled>Choisir une colonne</option>{targets.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select><p className="hint">Les fiches seront ajoutées à la fin de cette colonne, dans leur ordre actuel.</p></div>}
            <label className={`delete-option destructive-option ${mode === 'delete' ? 'selected' : ''}`}>
              <input type="radio" name="column-deletion" value="delete" checked={mode === 'delete'} onChange={() => setMode('delete')} />
              <span><strong><Trash2 size={16} />Supprimer toutes les fiches</strong><span>Supprimer définitivement la colonne et ses {count} fiche{count > 1 ? 's' : ''}, descriptions et checklists comprises.</span></span>
            </label>
          </fieldset>
        </> : <p className="muted">Cette colonne est vide. Elle sera définitivement supprimée.</p>}
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
      <footer className="modal-footer column-delete-footer"><button type="button" className="button secondary" disabled={busy} onClick={close}>Annuler</button><button type="submit" className={`button ${count && mode === 'move' ? 'primary' : 'danger'}`} disabled={busy || !valid}>{busy && <Spinner />}{!count ? 'Supprimer la colonne' : mode === 'move' ? 'Déplacer et supprimer la colonne' : mode === 'delete' ? 'Supprimer la colonne et ses fiches' : 'Confirmer la suppression'}</button></footer>
    </form>
  </Modal>;
}
