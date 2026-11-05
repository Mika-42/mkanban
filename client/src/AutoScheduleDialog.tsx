import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from './api';
import { localDay } from './chartData';
import { Modal, Spinner } from './components';
import type { AutoPlanChange } from '../../shared/planning';

type Preview = { revision: string; changes: AutoPlanChange[]; applied: boolean };
export function AutoScheduleDialog({ boardId, onClose, onSaved }: { boardId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [start, setStart] = useState(localDay(new Date())), [duration, setDuration] = useState(1), [include, setInclude] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const close = () => { if (!busy) onClose(); };
  const execute = async (apply: boolean) => {
    setBusy(true); setError('');
    try {
      const result = await api<Preview>(`/boards/${boardId}/auto-schedule`, 'POST', { projectStart: start, defaultDurationDays: duration, includeCompleted: include, dryRun: !apply, expectedRevision: apply ? preview?.revision : undefined });
      if (apply) { await onSaved(); onClose(); } else setPreview(result);
    } catch (e) { setError((e as Error).message); setPreview(null); } finally { setBusy(false); }
  };
  return <Modal title="Planifier selon les dépendances" onClose={close} wide><form onSubmit={e => { e.preventDefault(); void execute(false); }}><div className="modal-body form-stack"><p className="muted">Les successeurs commenceront après la fin de tous leurs prédécesseurs. Les durées et les dates minimales existantes sont conservées. Les fiches sans date reçoivent la durée indiquée ci-dessous.</p><div className="planning-dates"><label htmlFor="auto-start">Début du projet<input id="auto-start" type="date" required disabled={busy} value={start} onChange={e => { setStart(e.target.value); setPreview(null); }} /></label><label htmlFor="auto-duration">Durée des fiches sans date (jours)<input id="auto-duration" type="number" required min={1} max={365} disabled={busy} value={duration} onChange={e => { setDuration(Number(e.target.value)); setPreview(null); }} /></label></div><label className="auto-include"><input type="checkbox" checked={include} disabled={busy} onChange={e => { setInclude(e.target.checked); setPreview(null); }} />Replanifier aussi les fiches terminées</label><p className="hint">Les week-ends sont inclus. Cette opération ne modifie ni les story points ni l’état terminé des fiches.</p>{preview && <div className="auto-preview" aria-live="polite"><h3>{preview.changes.length ? `${preview.changes.length} fiche(s) à mettre à jour` : 'Le planning respecte déjà ces contraintes.'}</h3>{!!preview.changes.length && <div className="auto-preview-table"><table><caption>Aperçu des changements de dates</caption><thead><tr><th>Fiche</th><th>Dates actuelles</th><th>Dates proposées</th></tr></thead><tbody>{preview.changes.map(c => <tr key={c.cardId}><th>{c.title}</th><td>{c.previousStart ?? '—'} → {c.previousEnd ?? '—'}</td><td>{c.startDate} → {c.dueDate}</td></tr>)}</tbody></table></div>}</div>}{error && <div role="alert" className="form-error">{error}</div>}</div><footer className="modal-footer auto-schedule-footer"><button type="button" className="button secondary" disabled={busy} onClick={close}>Annuler</button><button className="button secondary" type="submit" disabled={busy || !start}>{busy && <Spinner />}Générer l’aperçu</button><button className="button primary" type="button" disabled={busy || !preview?.changes.length} onClick={() => void execute(true)}><Sparkles size={16} />Appliquer le planning</button></footer></form></Modal>;
}
