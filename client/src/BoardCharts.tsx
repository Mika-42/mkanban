import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, CheckCheck, Diamond, Info, Table2, TrendingDown, TrendingUp } from 'lucide-react';
import type { Board } from '../../server/schema';
import { addDays, buildChartDays, chartCsv, formatDay, localDay, type ChartDay } from './chartData';

const number = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value);
function download(value: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

export function BoardCharts({ board }: { board: Board }) {
  const today = localDay(new Date());
  const [start, setStart] = useState(() => addDays(today, -29));
  const [end, setEnd] = useState(today);
  const [table, setTable] = useState(false);
  const firstDay = localDay(board.pointHistory[0].at);
  const metrics = board.pointHistory.at(-1)!;
  const { days, error } = useMemo(() => {
    try { return { days: buildChartDays(board.pointHistory, start, end), error: '' }; }
    catch (e) { return { days: [], error: (e as Error).message }; }
  }, [board.pointHistory, start, end]);
  const completion = metrics.total ? Math.round(metrics.completed / metrics.total * 100) : 0;
  return <section className="board-charts" role="tabpanel" id="charts-panel" aria-labelledby="charts-tab">
    <div className="charts-heading"><div><h2>Chaque point raconte une avancée.</h2><p>Suivez la progression de votre projet en story points.</p></div><button className="button secondary" disabled={!days.length} onClick={() => download(chartCsv(days), 'text/csv;charset=utf-8', `mkAgile-${board.id}-story-points.csv`)}><ArrowDownToLine size={16} />Exporter les données CSV</button></div>
    <div className="chart-metrics" aria-label="Story points actuels">
      <div><span><Diamond size={15} />Total actuel</span><strong>{number(metrics.total)}<small>points</small></strong></div>
      <div><span><CheckCheck size={16} />Terminés</span><strong>{number(metrics.completed)}<small>points</small></strong></div>
      <div><span><TrendingDown size={16} />Restants</span><strong>{number(metrics.total - metrics.completed)}<small>points</small></strong></div>
      <div><span><TrendingUp size={16} />Progression</span><strong>{completion}<small>%</small></strong><div className="chart-completion"><span style={{ width: `${completion}%` }} /></div></div>
    </div>
    <div className="chart-period"><div className="chart-presets" aria-label="Périodes rapides">{[7, 30, 90].map(n => <button key={n} className={start === addDays(today, 1 - n) && end === today ? 'selected' : ''} aria-pressed={start === addDays(today, 1 - n) && end === today} onClick={() => { setStart(addDays(today, 1 - n)); setEnd(today); }}>{n} jours</button>)}<button onClick={() => { setStart(firstDay); setEnd(today); }}>Tout l’historique</button></div><div className="chart-dates"><label htmlFor="chart-start">Du<input id="chart-start" type="date" value={start} onChange={e => setStart(e.target.value)} /></label><label htmlFor="chart-end">Au<input id="chart-end" type="date" value={end} onChange={e => setEnd(e.target.value)} /></label></div></div>
    {error ? <div className="form-error" role="alert">{error}</div> : <>
      <div className="charts-grid"><PointsChart days={days} kind="up" /><PointsChart days={days} kind="down" /></div>
      <div className="chart-data-toolbar"><p>Valeurs en fin de journée · {Intl.DateTimeFormat().resolvedOptions().timeZone} · Ensemble du projet</p><button className="text-button" aria-expanded={table} onClick={() => setTable(!table)}><Table2 size={15} />{table ? 'Masquer les valeurs' : 'Voir les valeurs'}</button></div>
      {table && <div className="chart-table-wrap"><table className="chart-table"><caption>Story points par jour sur la période sélectionnée</caption><thead><tr><th scope="col">Date</th><th scope="col">Total</th><th scope="col">Terminés</th><th scope="col">Restants</th><th scope="col">Restants idéaux</th></tr></thead><tbody>{days.map(day => <tr key={day.date}><th scope="row">{formatDay(day.date, true)}</th><td>{number(day.total)}</td><td>{number(day.completed)}</td><td>{number(day.remaining)}</td><td>{number(day.ideal)}</td></tr>)}</tbody></table></div>}
    </>}
    <div className="chart-explanation"><Info size={18} /><div><p>Suivi disponible depuis le <strong>{formatDay(firstDay, true)}</strong>. Les valeurs antérieures restent inconnues. Les observations futures ne sont pas projetées.</p><p>Une fiche compte comme terminée lorsqu’elle est cochée, quelle que soit sa colonne. Ajouter, supprimer, réestimer ou rouvrir des fiches fait varier les courbes. La ligne idéale relie les points restants de la première journée connue à zéro en fin de période ; c’est une référence, pas une prévision.</p></div></div>
  </section>;
}

type Series = { key: 'total' | 'completed' | 'remaining' | 'ideal'; label: string; color: string; dashed?: boolean };
function PointsChart({ days, kind }: { days: ChartDay[]; kind: 'up' | 'down' }) {
  const container = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const titleId = useId();
  const [width, setWidth] = useState(540);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(260, entries[0].contentRect.width)));
    observer.observe(container.current!); return () => observer.disconnect();
  }, []);
  const title = kind === 'up' ? 'Burn-up' : 'Burn-down';
  const series: Series[] = kind === 'up' ? [{ key: 'completed', label: 'Terminés', color: '#8060cd' }, { key: 'total', label: 'Total', color: '#9a9eae', dashed: true }] : [{ key: 'remaining', label: 'Restants', color: '#52a28a' }, { key: 'ideal', label: 'Idéal', color: '#b9a1d3', dashed: true }];
  const height = 300, left = 43, right = width - 19, top = 39, bottom = 238;
  const max = Math.max(1, ...days.flatMap(day => series.map(s => day[s.key] || 0)));
  const rough = max / 4, magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].find(n => n * magnitude >= rough)! * magnitude;
  const limit = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(limit / step) + 1 }, (_, i) => i * step);
  const x = (index: number) => days.length <= 1 ? (left + right) / 2 : left + index / (days.length - 1) * (right - left);
  const y = (value: number) => bottom - value / limit * (bottom - top);
  const path = (key: Series['key']) => {
    let drawing = false;
    return days.map((day, index) => {
      const value = day[key];
      if (value === null) { drawing = false; return ''; }
      const command = drawing ? 'L' : 'M'; drawing = true;
      return `${command}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
    }).join(' ');
  };
  const tickCount = Math.min(days.length, width < 420 ? 3 : 5);
  const dates = [...new Set(Array.from({ length: tickCount }, (_, i) => Math.round(i * (days.length - 1) / Math.max(1, tickCount - 1))))];
  const selectedIndex = Math.min(active ?? days.length - 1, days.length - 1);
  const selected = days[selectedIndex];
  const observed = days.some(day => day.total !== null);
  const exportSvg = () => {
    const clone = svg.current!.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.querySelectorAll('[data-chart-interaction]').forEach(el => el.remove());
    download(new XMLSerializer().serializeToString(clone), 'image/svg+xml;charset=utf-8', `${kind === 'up' ? 'burn-up' : 'burn-down'}.svg`);
  };
  return <article className="points-chart" aria-labelledby={titleId}>
    <header><div><span className={`chart-icon ${kind}`}>{kind === 'up' ? <TrendingUp size={19} /> : <TrendingDown size={19} />}</span><div><h3 id={titleId}>{title}</h3><p>{kind === 'up' ? 'Le travail terminé face au périmètre total.' : 'Les points restants face à une trajectoire idéale.'}</p></div></div><button className="icon-button" aria-label={`Télécharger le ${title} en SVG`} title="Télécharger le graphique SVG" onClick={exportSvg}><ArrowDownToLine size={17} /></button></header>
    <div ref={container} className="chart-plot"><svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Graphique ${title}`} fontFamily="Inter, system-ui, sans-serif" onPointerMove={e => {
      const bounds = e.currentTarget.getBoundingClientRect();
      const pos = (e.clientX - bounds.left) / bounds.width * width;
      setActive(Math.max(0, Math.min(days.length - 1, Math.round((pos - left) / (right - left) * (days.length - 1)))));
    }} onPointerLeave={() => setActive(null)}>
      <title>{title} — Story points du {formatDay(days[0].date, true)} au {formatDay(days.at(-1)!.date, true)}</title>
      <desc>{kind === 'up' ? 'Points terminés et total de points du projet.' : 'Points restants et ligne idéale décroissante.'} Les valeurs inconnues ne sont pas tracées.</desc>
      <rect width={width} height={height} fill="white" />
      <text x={left} y={17} fill="#9a8ba8" fontSize={11}>{title} · Story points</text>
      {ticks.map(value => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#eeebf4" strokeDasharray="3 4" /><text x={left - 9} y={y(value) + 4} textAnchor="end" fontSize={11} fill="#ac9bb9">{number(value)}</text></g>)}
      {dates.map((index, i) => <text key={index} x={x(index)} y={bottom + 24} textAnchor={dates.length === 1 ? 'middle' : i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'} fill="#ac9bb9" fontSize={11}>{formatDay(days[index].date)}</text>)}
      {series.map(s => {
        const last = days.findLastIndex(d => d[s.key] !== null);
        return <g key={s.key}><path d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dashed ? '6 5' : undefined} strokeLinejoin="round" />{last >= 0 && <circle cx={x(last)} cy={y(days[last][s.key]!)} r={4} fill={s.color} stroke="white" strokeWidth={2} />}</g>;
      })}
      {!observed && <text x={(left + right) / 2} y={(top + bottom) / 2} textAnchor="middle" fill="#ac9bb9" fontSize={12}>Aucune observation sur cette période</text>}
      {series.map((s, i) => <g key={s.key}><line x1={left + i * 110} x2={left + 19 + i * 110} y1={286} y2={286} stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dashed ? '5 3' : undefined} /><text x={left + 25 + i * 110} y={290} fill="#94819f" fontSize={12}>{s.label}</text></g>)}
      {active !== null && selected && <g data-chart-interaction="true"><line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={top} y2={bottom} stroke="#d6cae6" />{series.filter(s => selected[s.key] !== null).map(s => <circle key={s.key} cx={x(selectedIndex)} cy={y(selected[s.key]!)} r={5} fill={s.color} stroke="white" strokeWidth={2} />)}</g>}
      <rect data-chart-interaction="true" x={left} y={top} width={right - left} height={bottom - top} fill="transparent" tabIndex={0} role="slider" aria-label={`Explorer le ${title}`} aria-valuemin={0} aria-valuemax={days.length - 1} aria-valuenow={selectedIndex} aria-valuetext={`${formatDay(selected.date, true)}, ${series.map(s => `${s.label} : ${number(selected[s.key])}`).join(', ')}`} onFocus={() => setActive(days.length - 1)} onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault(); setActive(e.key === 'Home' ? 0 : e.key === 'End' ? days.length - 1 : Math.max(0, Math.min(days.length - 1, selectedIndex + (e.key === 'ArrowLeft' ? -1 : 1))));
      }} />
    </svg></div>
    <div className="chart-readout" aria-live="polite"><strong>{formatDay(selected.date, true)}</strong>{series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}<b>{number(selected[s.key])}</b></span>)}</div>
  </article>;
}
