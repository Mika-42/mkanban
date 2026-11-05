import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Copy, GitFork, Trash2, UserRoundPlus } from 'lucide-react';
import type { Card } from '../../server/schema';

export type CardMenuAnchor = { x: number; y: number; focusTarget: HTMLElement };
export type CardQuickAction = 'assign' | 'delete' | 'split' | 'duplicate';
export function CardContextMenu({ card, anchor, onClose, onAction, duplicating = false }: { card: Card; anchor: CardMenuAnchor; onClose: (restoreFocus: boolean) => void; onAction: (action: CardQuickAction) => void; duplicating?: boolean }) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => {
    const element = menu.current!, bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(anchor.x, innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(anchor.y, innerHeight - bounds.height - 8))}px`;
    element.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close.current(false); };
    const resize = () => close.current(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    window.addEventListener('scroll', outside, true);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside); window.removeEventListener('scroll', outside, true); window.removeEventListener('resize', resize); };
  }, []);
  return createPortal(<div ref={menu} className="card-context-menu" role="menu" aria-label={`Actions pour ${card.title}`} style={{ left: anchor.x, top: anchor.y }} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); return; }
    if (e.key === 'Tab') { onClose(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[next].focus();
  }}>
    <div className="card-context-title" role="presentation" title={card.title}>{card.title}</div>
    <button role="menuitem" onClick={() => onAction('assign')}><UserRoundPlus size={16} />Assigner…</button>
    <button role="menuitem" disabled={duplicating} onClick={() => onAction('duplicate')}><Copy size={16} />{duplicating ? 'Duplication…' : 'Dupliquer'}</button>
    <button role="menuitem" onClick={() => onAction('split')}><GitFork size={16} />Scinder…</button>
    <div className="card-context-separator" role="separator" />
    <button role="menuitem" className="danger-text" onClick={() => onAction('delete')}><Trash2 size={16} />Supprimer…</button>
  </div>, document.body);
}
