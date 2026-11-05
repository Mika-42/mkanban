import { useState, type CSSProperties } from 'react';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCorners, pointerWithin, type DragEndEvent, type CollisionDetection } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, MoreHorizontal, GripVertical, Check, CalendarDays, AlignLeft, CheckSquare2, Diamond, Pencil, Trash2, ArrowLeft, ArrowRight } from 'lucide-react';
import type { Board, Card, Column } from '../../server/schema';
import { api } from './api';
import { Avatar, Modal, Spinner } from './components';
import { flagColor } from './CardEditor';
import { DeleteColumnDialog } from './DeleteColumnDialog';
import { CardContextMenu, type CardMenuAnchor, type CardQuickAction } from './CardContextMenu';
import { AssignCardDialog, DeleteCardDialog } from './CardQuickDialogs';
import { SplitCardDialog } from './SplitCardDialog';

type CardMenuHandler = (card: Card, anchor: CardMenuAnchor) => void;

export function BoardView({ board, search, member, status, flag, onCard, refresh, run }: { board: Board; search: string; member: string; status: string; flag: string; onCard: (card: Card) => void; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [dragged, setDragged] = useState<{ type: string; id: string } | null>(null);
  const [columnForm, setColumnForm] = useState<Column | 'new' | null>(null);
  const [newCardColumn, setNewCardColumn] = useState<Column | null>(null);
  const [deleteColumnId, setDeleteColumnId] = useState<string | null>(null);
  const deleteColumn = board.columns.find(c => c.id === deleteColumnId);
  const [contextMenu, setContextMenu] = useState<(CardMenuAnchor & { cardId: string }) | null>(null);
  const contextCard = board.columns.flatMap(c => c.cards).find(c => c.id === contextMenu?.cardId);
  const [action, setAction] = useState<{ type: CardQuickAction; card: Card; focusTarget: HTMLElement } | null>(null);
  const showMenu: CardMenuHandler = (card, anchor) => setContextMenu({ ...anchor, cardId: card.id });
  const closeAction = () => {
    const trigger = action?.focusTarget, column = trigger?.closest('.kanban-column');
    setAction(null);
    requestAnimationFrame(() => { const next = trigger?.isConnected ? trigger : column?.querySelector<HTMLButtonElement>('.add-card') ?? document.getElementById('board-tab'); next?.focus(); });
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const collision: CollisionDetection = args => {
    const filtered = { ...args, droppableContainers: args.droppableContainers.filter(c => args.active.data.current?.type !== 'column' || c.data.current?.type === 'column') };
    const pointer = pointerWithin(filtered);
    return pointer.length ? pointer : closestCorners(filtered);
  };
  const visible = (card: Card) => (!search || [card.title, card.description, ...card.flags, ...card.members].join(' ').toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))) && (!member || card.members.includes(member)) && (!flag || card.flags.includes(flag)) && (status === 'all' || (status === 'completed' ? card.completed : !card.completed));
  const filtered = Boolean(search || member || flag || status !== 'all');
  const onDragEnd = (event: DragEndEvent) => {
    setDragged(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (active.data.current?.type === 'column') {
      const index = board.columns.findIndex(c => c.id === over.id);
      if (index >= 0) void run(() => api(`/boards/${board.id}/columns/${active.id}/move`, 'POST', { index }));
    } else {
      const target = board.columns.find(c => c.id === over.data.current?.columnId || c.id === over.id);
      if (!target) return;
      const index = target.cards.findIndex(c => c.id === over.id);
      void run(() => api(`/boards/${board.id}/cards/${active.id}/move`, 'POST', { columnId: target.id, index: index < 0 ? target.cards.length : index }));
    }
  };
  const activeCard = board.columns.flatMap(c => c.cards).find(c => c.id === dragged?.id);
  return <>
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={({ active }) => { setContextMenu(null); setDragged({ id: String(active.id), type: active.data.current?.type || 'card' }); }} onDragEnd={onDragEnd} onDragCancel={() => setDragged(null)} accessibility={{ screenReaderInstructions: { draggable: 'Pour déplacer, appuyez sur Espace, utilisez les flèches puis Espace pour déposer. Échap pour annuler.' } }}>
      <div className="board-scroll"><div className="columns"><SortableContext items={board.columns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
        {board.columns.map((column, index) => <BoardColumn key={column.id} column={column} index={index} count={board.columns.length} cards={column.cards.filter(visible)} filtered={filtered} onMenu={showMenu} openMenuId={contextMenu?.cardId ?? null} onCard={onCard} onAdd={() => setNewCardColumn(column)} onEdit={() => setColumnForm(column)} onDelete={() => setDeleteColumnId(column.id)} onMove={index => void run(() => api(`/boards/${board.id}/columns/${column.id}/move`, 'POST', { index }))} onComplete={card => void run(() => api(`/boards/${board.id}/cards/${card.id}`, 'PATCH', { completed: !card.completed, expectedUpdatedAt: card.updatedAt }))} />)}
      </SortableContext><button className="add-column" onClick={() => setColumnForm('new')}><Plus size={18} />Ajouter une colonne</button></div></div>
      <DragOverlay>{activeCard ? <CardContent card={activeCard} overlay /> : dragged?.type === 'column' ? <div className="column-overlay">{board.columns.find(c => c.id === dragged.id)?.title}</div> : null}</DragOverlay>
    </DndContext>
    {columnForm && <ColumnForm column={columnForm === 'new' ? null : columnForm} boardId={board.id} onClose={() => setColumnForm(null)} onSaved={refresh} />}
    {newCardColumn && <NewCard column={newCardColumn} boardId={board.id} onClose={() => setNewCardColumn(null)} onSaved={async card => { await refresh(); setNewCardColumn(null); onCard(card); }} />}
    {deleteColumn && <DeleteColumnDialog column={deleteColumn} board={board} onClose={() => setDeleteColumnId(null)} onDeleted={refresh} />}
    {contextMenu && contextCard && <CardContextMenu key={contextCard.id} card={contextCard} anchor={contextMenu} onClose={restore => { if (restore && contextMenu.focusTarget.isConnected) contextMenu.focusTarget.focus(); setContextMenu(null); }} onAction={type => { setAction({ type, card: structuredClone(contextCard), focusTarget: contextMenu.focusTarget }); setContextMenu(null); }} />}
    {action?.type === 'assign' && <AssignCardDialog card={action.card} board={board} onClose={closeAction} onSaved={refresh} />}
    {action?.type === 'delete' && <DeleteCardDialog card={action.card} boardId={board.id} onClose={closeAction} onSaved={refresh} />}
    {action?.type === 'split' && <SplitCardDialog card={action.card} boardId={board.id} onClose={closeAction} onSaved={async () => { await refresh(); closeAction(); }} />}
  </>;
}

function BoardColumn({ column, index, count, cards, filtered, onCard, onAdd, onEdit, onDelete, onMove, onComplete, onMenu, openMenuId }: { column: Column; index: number; count: number; cards: Card[]; filtered: boolean; onCard: (card: Card) => void; onAdd: () => void; onEdit: () => void; onDelete: () => void; onMove: (index: number) => void; onComplete: (card: Card) => void; onMenu: CardMenuHandler; openMenuId: string | null }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: column.id, data: { type: 'column', columnId: column.id } });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? .35 : 1 };
  const [menu, setMenu] = useState(false);
  const points = column.cards.reduce((sum, c) => sum + c.points, 0);
  return <section ref={setNodeRef} style={style} className={`kanban-column ${isOver ? 'drop-target' : ''}`} aria-label={`Colonne ${column.title}`}>
    <header className="column-header"><button className="column-grip" aria-label={`Déplacer la colonne ${column.title}`} {...attributes} {...listeners}><GripVertical size={15} /></button><span className={`column-dot ${column.color}`} /><h2 title="Renommer la colonne" onDoubleClick={onEdit}>{column.title}</h2><span className="column-count" title="Nombre total de cartes">{column.cards.length}</span><span className="column-points" title="Total des story points"><Diamond size={12} />{points}</span><div className="column-menu-wrap"><button className={`icon-button ${menu ? 'selected' : ''}`} aria-label={`Options de ${column.title}`} aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={18} /></button>{menu && <><button className="menu-dismiss" aria-label="Fermer le menu" onClick={() => setMenu(false)} /><div className="dropdown"><button onClick={() => { setMenu(false); onEdit(); }}><Pencil size={15} />Renommer / couleur</button><button disabled={index === 0} onClick={() => { setMenu(false); onMove(index - 1); }}><ArrowLeft size={15} />Déplacer à gauche</button><button disabled={index === count - 1} onClick={() => { setMenu(false); onMove(index + 1); }}><ArrowRight size={15} />Déplacer à droite</button><button className="danger-text" onClick={() => { setMenu(false); onDelete(); }}><Trash2 size={15} />Supprimer la colonne</button></div></>}</div></header>
    <div className="column-cards"><SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>{cards.map(card => <SortableCard key={card.id} card={card} onMenu={anchor => onMenu(card, anchor)} menuOpen={openMenuId === card.id} onOpen={() => onCard(card)} onComplete={() => onComplete(card)} />)}</SortableContext>{!cards.length && <div className="empty-column">{filtered ? 'Aucune carte ne correspond' : 'Un espace pour la prochaine idée.'}</div>}</div>
    <button className="add-card" onClick={onAdd}><Plus size={17} />Ajouter une carte</button>
  </section>;
}
function SortableCard({ card, onOpen, onComplete, onMenu, menuOpen }: { card: Card; onOpen: () => void; onComplete: () => void; onMenu: (anchor: CardMenuAnchor) => void; menuOpen: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, data: { type: 'card', columnId: card.columnId } });
  return <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? .25 : 1 }}><CardContent card={card} onOpen={onOpen} onComplete={onComplete} onMenu={onMenu} menuOpen={menuOpen} handle={<button className="card-grip" aria-label={`Déplacer ${card.title}`} {...attributes} {...listeners}><GripVertical size={15} /></button>} /></div>;
}
function CardContent({ card, onOpen, onComplete, handle, overlay, onMenu, menuOpen }: { card: Card; onOpen?: () => void; onComplete?: () => void; handle?: React.ReactNode; overlay?: boolean; onMenu?: (anchor: CardMenuAnchor) => void; menuOpen?: boolean }) {
  const completedItems = card.checklist.filter(i => i.done).length;
  const overdue = card.dueDate && !card.completed && card.dueDate < new Date().toLocaleDateString('sv-SE');
  return <article className={`kanban-card ${card.completed ? 'is-completed' : ''} ${overlay ? 'card-overlay' : ''}`} onContextMenu={e => {
    if (!onMenu) return; e.preventDefault(); e.stopPropagation();
    onMenu({ x: e.clientX, y: e.clientY, focusTarget: e.currentTarget.querySelector<HTMLButtonElement>('.card-open')! });
  }} onKeyDown={e => {
    if (!onMenu || !(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
    e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect();
    onMenu({ x: rect.left + 15, y: rect.top + 35, focusTarget: e.currentTarget.querySelector<HTMLButtonElement>('.card-open')! });
  }}>
    {onMenu && <button className="card-actions-trigger" aria-label={`Actions de ${card.title}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={e => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); onMenu({ x: rect.right - 210, y: rect.bottom + 4, focusTarget: e.currentTarget }); }}><MoreHorizontal size={16} /></button>}
    <div className="card-top"><div className="card-flags">{card.flags.slice(0, 3).map(f => <span key={f} className={`flag-tag ${flagColor(f)}`}>{f}</span>)}{card.flags.length > 3 && <span className="more-flags">+{card.flags.length - 3}</span>}</div>{handle}</div>
    <div className="card-title-row"><button className={`completion ${card.completed ? 'checked' : ''}`} aria-label={card.completed ? `Marquer non terminée : ${card.title}` : `Terminer : ${card.title}`} onClick={onComplete}>{card.completed && <Check size={12} />}</button><button className="card-open" onClick={onOpen}>{card.title}</button></div>
    <button tabIndex={-1} className="card-description" onClick={onOpen}>{card.description ? card.description.replace(/[#*>`\[\]_]/g, '').replace(/\n+/g, ' ').slice(0, 110) : 'Ajouter une description…'}</button>
    <div className="card-bottom"><div className="card-meta">{card.dueDate && <span className={`date-meta ${overdue ? 'overdue' : ''}`}><CalendarDays size={12} />{new Date(`${card.dueDate}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>}{!!card.checklist.length && <span className={completedItems === card.checklist.length ? 'done-meta' : ''} title="Checklist"><CheckSquare2 size={13} />{completedItems}/{card.checklist.length}</span>}{card.description && !card.checklist.length && !card.dueDate && <span title="Description"><AlignLeft size={14} /></span>}<span className="story-points" title={`${card.points} story points`}><Diamond size={11} />{card.points}</span></div><div className="avatar-group">{card.members.slice(0, 3).map(m => <Avatar key={m} name={m} small />)}{card.members.length > 3 && <span className="avatar avatar-small extra">+{card.members.length - 3}</span>}</div></div>
  </article>;
}
function NewCard({ column, boardId, onClose, onSaved }: { column: Column; boardId: string; onClose: () => void; onSaved: (card: Card) => Promise<void> }) {
  const [title, setTitle] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Modal title={`Nouvelle carte · ${column.title}`} onClose={onClose}><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { const card = await api<Card>(`/boards/${boardId}/columns/${column.id}/cards`, 'POST', { title }); await onSaved(card); } catch (e) { setError((e as Error).message); setBusy(false); } }}><div className="modal-body form-stack"><label htmlFor="new-card-title">Qu’avez-vous en tête ?</label><input id="new-card-title" autoFocus required maxLength={200} placeholder="Donnez un titre à votre idée…" value={title} onChange={e => setTitle(e.target.value)} /><p className="hint">Vous pourrez ajouter une description, des points et une checklist juste après.</p>{error && <div className="form-error" role="alert">{error}</div>}</div><footer className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Annuler</button><button className="button primary" disabled={busy || !title.trim()}>{busy ? <Spinner /> : <Plus size={16} />}Créer la carte</button></footer></form></Modal>;
}
function ColumnForm({ column, boardId, onClose, onSaved }: { column: Column | null; boardId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(column?.title || ''); const [color, setColor] = useState(column?.color || 'gray'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Modal title={column ? 'Modifier la colonne' : 'Une nouvelle étape'} onClose={onClose}><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await api(`/boards/${boardId}/columns${column ? `/${column.id}` : ''}`, column ? 'PATCH' : 'POST', { title, color }); await onSaved(); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><div className="modal-body form-stack"><label htmlFor="column-title">Nom de la colonne</label><input id="column-title" autoFocus required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex. En revue" /><label>Couleur</label><div className="color-options">{(['gray', 'blue', 'violet', 'green', 'orange', 'rose'] as const).map(c => <button key={c} type="button" aria-label={`Couleur ${c}`} aria-pressed={color === c} className={`color-option ${c} ${color === c ? 'active' : ''}`} onClick={() => setColor(c)}>{color === c && <Check size={15} />}</button>)}</div>{error && <div className="form-error" role="alert">{error}</div>}</div><footer className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Annuler</button><button className="button primary" disabled={busy || !title.trim()}>{busy && <Spinner />}{column ? 'Enregistrer' : 'Créer la colonne'}</button></footer></form></Modal>;
}
