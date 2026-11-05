import type { Board, Card } from '../server/schema';

export class PlanningError extends Error {}
export const dayDistance = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  const result = value.toISOString();
  if (!/^\d{4}-/.test(result)) throw new PlanningError('Le planning dépasse les années 0000 à 9999');
  return result.slice(0, 10);
}
export function cardWindow(card: Card) {
  const start = card.startDate ?? card.dueDate, end = card.dueDate ?? card.startDate;
  return { start, end, duration: start && end ? dayDistance(start, end) + 1 : null };
}
/** Validates the entire graph so batches can replace edges atomically. */
export function orderedCards(board: Board): Card[] {
  const cards = board.columns.flatMap(c => c.cards), byId = new Map(cards.map(c => [c.id, c]));
  const degree = new Map<string, number>(), successors = new Map<string, string[]>();
  for (const card of cards) {
    if (card.startDate && card.dueDate && card.startDate > card.dueDate) throw new PlanningError(`« ${card.title} » : la date de fin précède la date de début`);
    if (new Set(card.dependencies).size !== card.dependencies.length) throw new PlanningError('Dépendances dupliquées');
    degree.set(card.id, card.dependencies.length);
    for (const id of card.dependencies) {
      if (id === card.id) throw new PlanningError('Une fiche ne peut pas dépendre d’elle-même');
      if (!byId.has(id)) throw new PlanningError('Une dépendance ne correspond à aucune fiche de ce tableau');
      successors.set(id, [...(successors.get(id) ?? []), card.id]);
    }
  }
  const queue = cards.filter(c => !c.dependencies.length), result: Card[] = [];
  for (let i = 0; i < queue.length; i++) {
    const card = queue[i]; result.push(card);
    for (const id of successors.get(card.id) ?? []) { degree.set(id, degree.get(id)! - 1); if (degree.get(id) === 0) queue.push(byId.get(id)!); }
  }
  if (result.length !== cards.length) throw new PlanningError('Les dépendances forment un cycle. Retirez un lien pour continuer.');
  return result;
}
export type GanttTask = { id: string; title: string; columnId: string; columnTitle: string; startDate: string | null; dueDate: string | null; start: string | null; end: string | null; duration: number | null; points: number; completed: boolean; dependencies: string[]; blockedBy: string[]; conflicts: string[]; milestone: boolean; updatedAt: string };
export type GanttPlan = { boardId: string; title: string; tasks: GanttTask[]; links: { from: string; to: string; type: 'finish_to_start' }[]; summary: { total: number; scheduled: number; unscheduled: number; blocked: number; conflicts: number }; startDate: string | null; endDate: string | null };
export function buildGantt(board: Board): GanttPlan {
  orderedCards(board);
  const cards = board.columns.flatMap(c => c.cards), byId = new Map(cards.map(c => [c.id, c]));
  const tasks = board.columns.flatMap(column => column.cards.map(card => {
    const window = cardWindow(card), conflicts: string[] = [];
    for (const id of card.dependencies) {
      const dependency = byId.get(id)!, prior = cardWindow(dependency);
      if (!prior.end) conflicts.push(`Prédécesseur non planifié : ${dependency.title}`);
      else if (window.start && window.start <= prior.end) conflicts.push(`Doit commencer après le ${prior.end} : ${dependency.title}`);
    }
    return { id: card.id, title: card.title, columnId: column.id, columnTitle: column.title, startDate: card.startDate, dueDate: card.dueDate, ...window, points: card.points, completed: card.completed, dependencies: [...card.dependencies], blockedBy: card.completed ? [] : card.dependencies.filter(id => !byId.get(id)!.completed), conflicts, milestone: Boolean(window.start && (!card.startDate || !card.dueDate)), updatedAt: card.updatedAt };
  }));
  const starts = tasks.flatMap(t => t.start ? [t.start] : []).sort(), ends = tasks.flatMap(t => t.end ? [t.end] : []).sort();
  return { boardId: board.id, title: board.title, tasks, links: tasks.flatMap(t => t.dependencies.map(from => ({ from, to: t.id, type: 'finish_to_start' as const }))), summary: { total: tasks.length, scheduled: starts.length, unscheduled: tasks.length - starts.length, blocked: tasks.filter(t => t.blockedBy.length).length, conflicts: tasks.filter(t => t.conflicts.length).length }, startDate: starts[0] ?? null, endDate: ends.at(-1) ?? null };
}
export type AutoPlanChange = { cardId: string; title: string; previousStart: string | null; previousEnd: string | null; startDate: string; dueDate: string; expectedUpdatedAt: string };
export function planAutomatically(board: Board, options: { projectStart: string; defaultDurationDays: number; includeCompleted: boolean }): AutoPlanChange[] {
  const ordered = orderedCards(board), dates = new Map<string, ReturnType<typeof cardWindow>>(), changes: AutoPlanChange[] = [];
  for (const card of ordered) {
    const current = cardWindow(card);
    if (card.completed && !options.includeCompleted) { dates.set(card.id, current); continue; }
    let start = current.start && current.start > options.projectStart ? current.start : options.projectStart;
    for (const id of card.dependencies) {
      const prior = dates.get(id)!;
      if (!prior.end) throw new PlanningError('Un prédécesseur terminé n’a pas de date. Planifiez-le ou incluez les fiches terminées.');
      const earliest = shiftDate(prior.end, 1); if (earliest > start) start = earliest;
    }
    const end = shiftDate(start, (current.duration ?? options.defaultDurationDays) - 1);
    dates.set(card.id, { start, end, duration: dayDistance(start, end) + 1 });
    if (card.startDate !== start || card.dueDate !== end) changes.push({ cardId: card.id, title: card.title, previousStart: card.startDate, previousEnd: card.dueDate, startDate: start, dueDate: end, expectedUpdatedAt: card.updatedAt });
  }
  return changes;
}
export function ganttRange(plan: GanttPlan, today: string, start?: string, end?: string) {
  const first = start ?? plan.startDate ?? today;
  const last = end ?? (plan.endDate && plan.endDate > first ? plan.endDate : shiftDate(first, 27));
  const length = dayDistance(first, last) + 1;
  if (length < 1 || !Number.isFinite(length)) throw new PlanningError('La date de fin doit suivre la date de début');
  if (length > 3660) throw new PlanningError('Affichez une période de 10 ans maximum');
  return { start: first, end: last, length };
}
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
export function ganttCsv(plan: GanttPlan) {
  const cell = (value: string | number | null) => { let text = String(value ?? ''); if (/^[=+@-]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
  return '\uFEFF' + [['ID', 'Fiche', 'Colonne', 'Début', 'Fin', 'Durée (jours)', 'Points', 'Terminée', 'Prédécesseurs', 'Bloquée par', 'Conflits'], ...plan.tasks.map(t => [t.id, t.title, t.columnTitle, t.startDate, t.dueDate, t.duration, t.points, t.completed ? 'oui' : 'non', t.dependencies.join(', '), t.blockedBy.join(', '), t.conflicts.join(' | ')])].map(row => row.map(cell).join(';')).join('\n') + '\n';
}
/** The same escaped standalone SVG is used by the browser and the MCP export. */
export function ganttSvg(plan: GanttPlan, range: ReturnType<typeof ganttRange>, dayWidth: number, today: string) {
  const labelWidth = 245, rowHeight = 48, top = 90, width = labelWidth + range.length * dayWidth + 20, height = top + plan.tasks.length * rowHeight + 35;
  const x = (date: string) => labelWidth + dayDistance(range.start, date) * dayWidth;
  const byId = new Map(plan.tasks.map((t, i) => [t.id, { ...t, row: i }]));
  const visible = (t: GanttTask) => t.start && t.end && t.end >= range.start && t.start <= range.end;
  const step = dayWidth >= 45 ? 1 : dayWidth >= 20 ? 2 : dayWidth >= 8 ? 7 : 30;
  const fragments = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="Diagramme de Gantt" font-family="Inter,system-ui,sans-serif"><title>${escape(plan.title)} — Gantt</title><desc>Dépendances fin vers début. Les dates sont inclusives et les durées en jours calendaires.</desc><defs><marker id="gantt-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#a890bf"/></marker></defs><rect width="100%" height="100%" fill="#fff"/><text x="18" y="24" font-size="14" fill="#80648f">${escape(plan.title)} · ${range.start} → ${range.end}</text><text x="18" y="64" font-size="12" fill="#a18bb0">Fiches et dépendances</text>`];
  for (let day = 0; day < range.length; day += step) {
    const date = shiftDate(range.start, day), pos = x(date);
    fragments.push(`<line x1="${pos}" x2="${pos}" y1="40" y2="${height - 15}" stroke="#efeaf5"/><text x="${pos + 5}" y="64" font-size="11" fill="#ac98ba">${escape(new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }))}</text>`);
  }
  if (today >= range.start && today <= range.end) fragments.push(`<line x1="${x(today) + dayWidth / 2}" x2="${x(today) + dayWidth / 2}" y1="70" y2="${height - 15}" stroke="#b4a0d5" stroke-dasharray="4 4"/>`);
  plan.tasks.forEach((task, i) => {
    const y = top + i * rowHeight, color = task.completed ? '#83b39b' : task.conflicts.length ? '#d99a71' : '#a68acc';
    fragments.push(`<line x1="0" x2="${width}" y1="${y + 34}" y2="${y + 34}" stroke="#f4eff8"/><g role="button" tabindex="0" data-card-id="${escape(task.id)}" aria-label="Modifier ${escape(task.title)}"><title>${escape(task.title)} · ${task.start ?? 'Non planifiée'} → ${task.end ?? 'Non planifiée'}${task.blockedBy.length ? ' · Bloquée' : ''}</title><rect x="0" y="${y - 16}" width="${width}" height="48" fill="transparent"/><text x="18" y="${y + 5}" fill="#816c8f" font-size="12">${escape(task.title.length > 29 ? task.title.slice(0, 27) + '…' : task.title)}</text><text x="18" y="${y + 22}" fill="#b09bbd" font-size="10">${task.points} points · ${escape(task.columnTitle.length > 18 ? task.columnTitle.slice(0, 17) + '…' : task.columnTitle)}${task.blockedBy.length ? ' · Bloquée' : ''}</text>`);
    if (visible(task)) {
      const from = Math.max(labelWidth, x(task.start!)), to = Math.min(width - 20, x(task.end!) + dayWidth);
      fragments.push(`<rect data-gantt-bar="move" x="${from + 2}" y="${y - 10}" width="${Math.max(3, to - from - 4)}" height="24" rx="5" fill="${color}"/>`);
      if (to - from > 54) fragments.push(`<text data-bar-label="true" x="${from + 9}" y="${y + 6}" font-size="10" fill="white" pointer-events="none">${task.milestone ? 'Jalon' : `${task.duration} j`}</text>`);
      fragments.push(`<rect data-gantt-bar="start" x="${from + 2}" y="${y - 10}" width="5" height="24" rx="2" fill="#fff" opacity="0.25"/><rect data-gantt-bar="end" x="${Math.max(from + 3, to - 7)}" y="${y - 10}" width="5" height="24" rx="2" fill="#fff" opacity="0.25"/>`);
    } else fragments.push(`<text x="${labelWidth + 12}" y="${y + 6}" fill="#bcadc7" font-size="11">${task.start ? 'Hors période' : 'À planifier'}</text>`);
    fragments.push('</g>');
  });
  for (const link of plan.links) {
    const a = byId.get(link.from)!, b = byId.get(link.to)!;
    if (!visible(a) || !visible(b)) continue;
    const ax = Math.min(width - 20, x(a.end!) + dayWidth), bx = Math.max(labelWidth, x(b.start!)), ay = top + a.row * rowHeight + 2, by = top + b.row * rowHeight + 2;
    const bend = Math.max(ax + 9, bx - 9);
    fragments.push(`<path d="M${ax},${ay} H${bend} V${by - 17} H${bx - 5} V${by}" fill="none" stroke="#a890bf" stroke-width="1.3" marker-end="url(#gantt-arrow)" pointer-events="none"><title>${escape(a.title)} → ${escape(b.title)}</title></path>`);
  }
  fragments.push(`<line x1="${labelWidth - 1}" x2="${labelWidth - 1}" y1="40" y2="${height - 15}" stroke="#e7deef"/></svg>`);
  return fragments.join('');
}
