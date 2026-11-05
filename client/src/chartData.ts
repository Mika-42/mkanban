import type { PointSnapshot } from '../../server/schema';

export type ChartDay = { date: string; total: number | null; completed: number | null; remaining: number | null; ideal: number | null };
export const localDay = (value: Date | string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) => new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
export function formatDay(date: string, long = false) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: long ? 'long' : 'short', ...(long ? { year: 'numeric' } : {}) });
}
export function buildChartDays(history: PointSnapshot[], start: string, end: string, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): ChartDay[] {
  const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!validDate(start) || !validDate(end) || end < start) throw new Error('Choisissez une date de fin égale ou postérieure à la date de début.');
  const length = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  if (length > 3660) throw new Error('Choisissez une période de 10 ans maximum.');
  const today = localDay(now, timeZone);
  const observations = history.filter(h => Date.parse(h.at) <= now.valueOf()).map(h => ({ ...h, date: localDay(h.at, timeZone) }));
  let cursor = 0;
  let latest: PointSnapshot | undefined;
  const days: ChartDay[] = Array.from({ length }, (_, index) => {
    const date = addDays(start, index);
    while (cursor < observations.length && observations[cursor].date <= date) latest = observations[cursor++];
    const observed = latest && date <= today;
    return { date, total: observed ? latest!.total : null, completed: observed ? latest!.completed : null, remaining: observed ? latest!.total - latest!.completed : null, ideal: null };
  });
  // The ideal line starts at the first known closing balance in the period.
  const baseline = days.findIndex(d => d.remaining !== null);
  if (baseline >= 0) for (let i = baseline; i < days.length; i++) days[i].ideal = days.length - 1 === baseline ? days[baseline].remaining : days[baseline].remaining! * (days.length - 1 - i) / (days.length - 1 - baseline);
  return days;
}
export function chartCsv(days: ChartDay[]) {
  return '\uFEFFDate;Points totaux;Points terminés;Points restants;Restants idéaux\n' + days.map(d => [d.date, d.total, d.completed, d.remaining, d.ideal === null ? null : Math.round(d.ideal * 100) / 100].join(';')).join('\n') + '\n';
}
