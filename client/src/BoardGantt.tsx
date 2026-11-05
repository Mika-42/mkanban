import { useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, CalendarRange, Focus, GitBranch, Info, Sparkles } from 'lucide-react';
import type { Board, Card } from '../../server/schema';
import { buildGantt, ganttCsv, ganttRange, ganttSvg, shiftDate, type GanttTask } from '../../shared/planning';
import { localDay } from './chartData';
import { api } from './api';
import { AutoScheduleDialog } from './AutoScheduleDialog';

function download(value: string, mime: string, name: string) {
  const url = URL.createObjectURL(new Blob([value], { type: mime }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
export function BoardGantt({ board, onCard, refresh }: { board: Board; onCard: (card: Card) => void; refresh: () => Promise<void> }) {
  const today = localDay(new Date());
  const plan = useMemo(() => buildGantt(board), [board]);
  const defaultRange = () => {
    const start = plan.startDate ?? today;
    try { return ganttRange(plan, today, start); } catch { return ganttRange(plan, today, start, shiftDate(start, 89)); }
  };
  const [dates, setDates] = useState(defaultRange);
  const [dayWidth, setDayWidth] = useState(28);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragText, setDragText] = useState('');
  const drag = useRef<{ task: GanttTask; x: number; delta: number; mode: string; original: { element: Element; x: string | null; width: string | null }[] } | null>(null);
  const suppressClick = useRef(false);
  const { svg, rangeError } = useMemo(() => {
    try { return { svg: ganttSvg(plan, ganttRange(plan, today, dates.start, dates.end), dayWidth, today), rangeError: '' }; }
    catch (e) { return { svg: '', rangeError: (e as Error).message }; }
  }, [plan, today, dates, dayWidth]);
  const open = (id: string) => { const card = board.columns.flatMap(c => c.cards).find(c => c.id === id); if (card) onCard(card); };
  const clearDrag = () => {
    drag.current?.original.forEach(({ element, x, width }) => { element.removeAttribute('transform'); if (x !== null) element.setAttribute('x', x); if (width !== null) element.setAttribute('width', width); });
    drag.current = null; setDragText('');
  };
  const outside = plan.tasks.filter(t => t.start && t.end && (t.end < dates.start || t.start > dates.end)).length;
  return <section className="board-gantt" role="tabpanel" id="gantt-panel" aria-labelledby="gantt-tab">
    <div className="gantt-heading"><div><h2>Donnez une place à chaque étape.</h2><p>Planifiez vos fiches et visualisez ce qui doit avancer en premier.</p></div><button className="button primary" onClick={() => setAuto(true)}><Sparkles size={16} />Planifier automatiquement</button></div>
    <div className="gantt-summary"><span><CalendarRange size={16} /><strong>{plan.summary.scheduled}</strong> planifiée{plan.summary.scheduled > 1 ? 's' : ''}</span><span><strong>{plan.summary.unscheduled}</strong> à planifier</span><span><GitBranch size={15} /><strong>{plan.summary.blocked}</strong> bloquée{plan.summary.blocked > 1 ? 's' : ''}</span><span className={plan.summary.conflicts ? 'has-conflicts' : ''}><strong>{plan.summary.conflicts}</strong> conflit{plan.summary.conflicts > 1 ? 's' : ''} de dates</span></div>
    <div className="gantt-controls"><div className="gantt-control-dates"><label htmlFor="gantt-from">Du<input id="gantt-from" type="date" value={dates.start} onChange={e => setDates(d => ({ ...d, start: e.target.value }))} /></label><label htmlFor="gantt-to">Au<input id="gantt-to" type="date" value={dates.end} onChange={e => setDates(d => ({ ...d, end: e.target.value }))} /></label></div><div className="gantt-zoom"><label htmlFor="gantt-scale">Échelle</label><select id="gantt-scale" value={dayWidth} onChange={e => setDayWidth(Number(e.target.value))}><option value={28}>Jour</option><option value={10}>Semaine</option><option value={3}>Mois</option></select></div><button className="button secondary" onClick={() => setDates(defaultRange())}><Focus size={16} />Cadrer les fiches</button><div className="gantt-export"><button className="button secondary" onClick={() => download(ganttCsv(plan), 'text/csv;charset=utf-8', 'gantt.csv')}><ArrowDownToLine size={15} />CSV</button><button className="button secondary" disabled={!svg} onClick={() => download(svg, 'image/svg+xml;charset=utf-8', 'gantt.svg')}><ArrowDownToLine size={15} />SVG</button></div></div>
    {(rangeError || error) && <div role="alert" className="form-error">{rangeError || error}</div>}
    {outside > 0 && !rangeError && <p className="hint gantt-outside">{outside} fiche{outside > 1 ? 's' : ''} hors de la période affichée. Utilisez « Cadrer les fiches » pour ajuster la vue.</p>}
    <div className="gantt-legend"><span><i className="planned" />Planifiée</span><span><i className="done" />Terminée</span><span><i className="conflict" />Conflit</span><span>→ Dépendance fin vers début</span><span className="gantt-drag-status" aria-live="polite">{busy ? 'Enregistrement…' : dragText}</span></div>
    {!plan.tasks.length ? <div className="gantt-empty"><CalendarRange size={32} /><h3>Votre planning commence par une fiche.</h3><p>Créez vos fiches dans l’onglet Tableau, puis ajoutez leurs dates et leurs dépendances.</p></div> : svg && <div className={`gantt-canvas ${busy ? 'is-saving' : ''}`} aria-label="Planning interactif" onClick={e => {
      if (suppressClick.current) { suppressClick.current = false; return; }
      const group = (e.target as Element).closest('[data-card-id]'); if (group && !busy) open(group.getAttribute('data-card-id')!);
    }} onKeyDown={e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const group = (e.target as Element).closest('[data-card-id]'); if (group && !busy) { e.preventDefault(); open(group.getAttribute('data-card-id')!); }
    }} onPointerDown={e => {
      if (busy || e.button !== 0) return;
      const mode = (e.target as Element).getAttribute('data-gantt-bar'), group = (e.target as Element).closest('[data-card-id]');
      if (!mode || !group) return;
      const task = plan.tasks.find(t => t.id === group.getAttribute('data-card-id'))!;
      const original = [...group.querySelectorAll('[data-gantt-bar],[data-bar-label]')].map(element => ({ element, x: element.getAttribute('x'), width: element.getAttribute('width') }));
      drag.current = { task, x: e.clientX, delta: 0, mode, original }; e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e => {
      if (!drag.current) return;
      const d = drag.current; let delta = Math.round((e.clientX - d.x) / dayWidth);
      if (d.mode === 'start') delta = Math.min(delta, d.task.duration! - 1);
      if (d.mode === 'end') delta = Math.max(delta, 1 - d.task.duration!);
      d.delta = delta; setDragText(`${d.mode === 'move' ? 'Décalage' : 'Ajustement'} : ${delta > 0 ? '+' : ''}${delta} jour(s)`);
      d.original.forEach(({ element, x, width }) => {
        const handle = element.getAttribute('data-gantt-bar');
        if (d.mode === 'move') element.setAttribute('transform', `translate(${delta * dayWidth},0)`);
        else if (handle === 'move') {
          element.setAttribute('width', String(Math.max(3, Number(width) + delta * dayWidth * (d.mode === 'end' ? 1 : -1))));
          if (d.mode === 'start') element.setAttribute('x', String(Number(x) + delta * dayWidth));
        } else if (handle === d.mode || (d.mode === 'start' && element.hasAttribute('data-bar-label'))) element.setAttribute('transform', `translate(${delta * dayWidth},0)`);
      });
    }} onPointerCancel={clearDrag} onPointerUp={async e => {
      const d = drag.current; if (!d) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      clearDrag();
      suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0);
      if (!d.delta) { open(d.task.id); return; }
      setBusy(true); setError('');
      try {
        const startDate = d.mode === 'end' ? d.task.start! : shiftDate(d.task.start!, d.delta);
        const dueDate = d.mode === 'start' ? d.task.end! : shiftDate(d.task.end!, d.delta);
        await api(`/boards/${board.id}/schedule`, 'PATCH', { changes: [{ cardId: d.task.id, startDate, dueDate, expectedUpdatedAt: d.task.updatedAt }] });
        await refresh();
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }} dangerouslySetInnerHTML={{ __html: svg }} />}
    <div className="gantt-help"><Info size={17} /><p>Ouvrez une fiche en cliquant sur sa ligne. Glissez une barre pour la décaler, ou ses poignées pour ajuster les dates. Les jours sont calendaires et les dates inclusives. Les conflits restent visibles jusqu’à correction ; la planification automatique propose un aperçu avant application. Le CSV contient toutes les fiches, le SVG la période affichée.</p></div>
    {!!plan.summary.unscheduled && <div className="gantt-unscheduled"><h3>Fiches à planifier</h3><div>{plan.tasks.filter(t => !t.start).map(t => <button className="button secondary" key={t.id} onClick={() => open(t.id)}>{t.title}</button>)}</div></div>}
    {!!plan.summary.conflicts && <div className="gantt-conflicts"><h3>Conflits à résoudre</h3>{plan.tasks.filter(t => t.conflicts.length).map(t => <div key={t.id}><button className="text-button" onClick={() => open(t.id)}>{t.title}</button><ul>{t.conflicts.map(message => <li key={message}>{message}</li>)}</ul></div>)}</div>}
    {auto && <AutoScheduleDialog boardId={board.id} onClose={() => setAuto(false)} onSaved={refresh} />}
  </section>;
}
