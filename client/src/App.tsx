import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Cable, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Command, Diamond, FileJson, FolderKanban, LayoutGrid, Leaf, Menu, MoreHorizontal, Plus, Search, Settings2, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import type { Board, BoardSummary, Card } from '../../server/schema';
import { api, createBoard } from './api';
import { Avatar, Confirm, McpDialog, Modal, Spinner } from './components';
import { BoardView } from './BoardView';
import { CardEditor } from './CardEditor';

export function App() {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem('mkanban.board'));
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [member, setMember] = useState('');
  const [status, setStatus] = useState('all');
  const [flag, setFlag] = useState('');
  const [filters, setFilters] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [mcp, setMcp] = useState(false);
  const [newBoard, setNewBoard] = useState(false);
  const [settings, setSettings] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const refreshing = useRef(false);
  const refresh = useCallback(async () => {
    const list = await api<BoardSummary[]>('/boards'); setBoards(list);
    const current = list.some(b => b.id === selectedRef.current) ? selectedRef.current : list[0]?.id || null;
    if (current !== selectedRef.current) { selectedRef.current = current; setSelected(current); }
    if (current) {
      const next = await api<Board>(`/boards/${current}`);
      if (current === selectedRef.current) setBoard(next);
    } else setBoard(null);
    setLoaded(true);
  }, []);
  useEffect(() => { refresh().catch(e => { setError(e.message); setLoaded(true); }); }, [refresh]);
  useEffect(() => {
    if (selected) localStorage.setItem('mkanban.board', selected); else localStorage.removeItem('mkanban.board');
    setSearch(''); setMember(''); setStatus('all'); setFlag(''); setCard(null); setSidebar(false);
    refresh().catch(e => setError(e.message));
  }, [selected, refresh]);
  // Reload JSON-backed state, including edits from separate MCP stdio processes.
  useEffect(() => {
    const interval = setInterval(async () => {
      if (document.hidden || refreshing.current) return;
      refreshing.current = true;
      try { await refresh(); } catch (e) { setError((e as Error).message); } finally { refreshing.current = false; }
    }, 2500);
    return () => clearInterval(interval);
  }, [refresh]);
  const run = async (fn: () => Promise<unknown>) => { setSaving(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } };
  const choose = (id: string) => { selectedRef.current = id; setBoard(null); setSelected(id); };
  const created = async (id: string) => { selectedRef.current = id; setSelected(id); await refresh(); setNewBoard(false); };
  const cards = board?.columns.flatMap(c => c.cards) || [];
  const members = [...new Set(cards.flatMap(c => c.members))].sort();
  const flags = [...new Set(cards.flatMap(c => c.flags))].sort();
  const completed = cards.filter(c => c.completed).length;
  const points = cards.reduce((n, c) => n + c.points, 0);
  const filtersCount = [member, flag, status !== 'all'].filter(Boolean).length;
  const download = () => {
    if (!board) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(board, null, 2) + '\n'], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${board.title.replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 80) || 'tableau'}.json`; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="app-shell">
    {sidebar && <button className="sidebar-backdrop" aria-label="Fermer la navigation" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? 'is-open' : ''}`}>
      <a className="brand" href="/" aria-label="mkanban, accueil"><span className="brand-mark"><i /><i /><i /></span>mkanban<span className="brand-period">.</span></a>
      <div className="workspace-switch"><span className="workspace-icon">M</span><div><strong>Mon espace</strong><span>Un peu d’ordre, beaucoup d’idées</span></div><ChevronDown size={14} /></div>
      <div className="nav-section-label">ESPACE DE TRAVAIL</div>
      <button className="nav-item active" onClick={() => { setSidebar(false); if (boards[0] && !board) choose(boards[0].id); }}><LayoutGrid size={18} /><span>Mes tableaux</span><span className="nav-count">{boards.length}</span></button>
      <div className="nav-section-label boards-label"><span>MES TABLEAUX</span><button className="icon-button" aria-label="Nouveau tableau" onClick={() => setNewBoard(true)}><Plus size={16} /></button></div>
      <nav className="boards-nav" aria-label="Tableaux">{boards.map(b => <button className={`board-nav ${selected === b.id ? 'current' : ''}`} key={b.id} onClick={() => choose(b.id)}><span className={`board-dot ${b.color}`} /><span>{b.title}</span>{selected === b.id && <ChevronRight size={14} />}</button>)}{!boards.length && <p className="nav-empty">Les grandes idées commencent<br />par un premier tableau.</p>}</nav>
      <button className="new-board-nav" onClick={() => setNewBoard(true)}><Plus size={16} />Nouveau tableau</button>
      <div className="sidebar-bottom"><div className="ai-callout"><span className="ai-callout-icon"><Sparkles size={19} /></span><h3>Une place pour votre IA</h3><p>Un copilote pour faire avancer<br />vos projets, à votre rythme.</p><button onClick={() => setMcp(true)}>Connecter un assistant<ArrowRight size={14} /></button></div>
        <button className="help-link" onClick={() => setMcp(true)}><CircleHelp size={16} />Comment ça marche ?</button><div className="local-status"><span className="status-dot" /><span>Vos données restent chez vous</span><ShieldIcon /></div>
      </div>
    </aside>
    <main className="main-panel">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Ouvrir la navigation" onClick={() => setSidebar(true)}><Menu size={20} /></button><FolderKanban size={17} /><span>Mes tableaux</span><ChevronRight size={14} /><strong>{board?.title || 'Bienvenue'}</strong></div><div className="topbar-right"><span className="local-badge"><span className="status-dot" />Local</span><span className="topbar-divider" /><span className="profile-avatar" title="Votre espace personnel">M</span></div></header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="text-button" onClick={() => { setError(''); void refresh().catch(e => setError(e.message)); }}>Réessayer</button><button className="icon-button" aria-label="Masquer l’erreur" onClick={() => setError('')}><X size={16} /></button></div>}
      {!loaded || (selected && !board && boards.length > 0) ? <div className="loading-state"><Spinner />Un instant, vos idées arrivent…</div> : !board ? <div className="welcome"><span className="welcome-eyebrow"><Leaf size={15} />FAITES PLACE AUX IDÉES</span><div className="welcome-illustration"><div className="mini-column"><span /><i /><i /></div><div className="mini-column"><span /><i /></div><div className="mini-column"><span /><i /><i /></div><span className="welcome-spark"><Sparkles size={24} /></span></div><h1>Un peu d’ordre.<br />De grandes possibilités.</h1><p>Vos projets, vos idées, votre façon d’avancer.<br />Créez votre premier tableau et faites de la place à l’essentiel.</p><div className="welcome-actions"><button className="button primary" onClick={() => setNewBoard(true)}><Plus size={17} />Créer mon premier tableau</button><button className="button secondary" disabled={saving} onClick={() => void run(async () => { const b = await createBoard('Lancement produit', true); await created(b.id); })}>{saving ? <Spinner /> : <Sparkles size={16} />}Explorer un exemple</button></div><div className="welcome-promises"><span><FileJson size={15} />Un fichier JSON par tableau</span><span><Cable size={15} />Prêt pour votre IA</span><span><Check size={15} />Simplement local</span></div></div> : <>
        <section className="board-intro"><div className="board-eyebrow"><span className={`board-dot ${board.color}`} />VOTRE ESPACE POUR AVANCER</div><div className="board-title-bar"><div><h1>{board.title}<button className="icon-button board-settings" aria-label="Paramètres du tableau" onClick={() => setSettings(true)}><MoreHorizontal size={22} /></button></h1><p>{board.description || 'De belles idées méritent un peu d’organisation.'}</p></div><div className="board-actions"><div className="avatar-group team-avatars">{members.slice(0, 3).map(m => <Avatar key={m} name={m} />)}{members.length > 3 && <span className="avatar extra">+{members.length - 3}</span>}</div><button className="button connect-button" onClick={() => setMcp(true)}><Sparkles size={16} />Connecter une IA</button></div></div>
          <div className="board-summary"><span>{cards.length} cartes</span><i /><span><Diamond size={13} />{points} points</span><i /><span className="summary-completed"><CheckCheck size={15} />{completed} terminée{completed > 1 ? 's' : ''}</span><div className="summary-progress"><span style={{ width: `${cards.length ? completed / cards.length * 100 : 0}%` }} /></div></div>
        </section>
        <div className="board-toolbar"><div className="view-tab"><LayoutGrid size={16} />Tableau<span>{board.columns.length}</span></div><div className="toolbar-controls"><div className="search-field"><Search size={16} /><input aria-label="Rechercher des cartes" placeholder="Rechercher une carte…" value={search} onChange={e => setSearch(e.target.value)} />{search ? <button aria-label="Effacer la recherche" onClick={() => setSearch('')}><X size={14} /></button> : <kbd><Command size={11} />K</kbd>}</div><button className={`button filter-button ${filters || filtersCount ? 'selected' : ''}`} aria-expanded={filters} onClick={() => setFilters(!filters)}><SlidersHorizontal size={16} /><span>Filtres</span>{filtersCount > 0 && <span className="filter-count">{filtersCount}</span>}</button><button className="icon-button export-button" title="Exporter le tableau JSON" aria-label="Exporter le tableau JSON" onClick={download}><ArrowDownToLine size={18} /></button></div></div>
        {filters && <div className="filter-panel"><label>Membre<select value={member} onChange={e => setMember(e.target.value)}><option value="">Tous les membres</option>{members.map(m => <option key={m}>{m}</option>)}</select></label><label>Étiquette<select value={flag} onChange={e => setFlag(e.target.value)}><option value="">Toutes les étiquettes</option>{flags.map(f => <option key={f}>{f}</option>)}</select></label><label>État<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Toutes les cartes</option><option value="active">Non terminées</option><option value="completed">Terminées</option></select></label><button className="text-button" onClick={() => { setMember(''); setFlag(''); setStatus('all'); }}>Réinitialiser</button><span className="hint">Les totaux des colonnes incluent toutes les cartes.</span></div>}
        <BoardView board={board} search={search} member={member} status={status} flag={flag} onCard={setCard} refresh={refresh} run={run} />
        <footer className="board-footer"><span><span className="status-dot" />{saving ? 'Enregistrement…' : 'Enregistré localement'}<span className="footer-file"><FileJson size={13} />1 tableau = 1 fichier JSON</span></span><span>Faites glisser vos idées. Faites avancer vos projets.<Leaf size={13} /></span></footer>
      </>}
    </main>
    {card && board && <CardEditor key={card.id} card={card} board={board} onClose={() => setCard(null)} onSaved={refresh} />}
    {mcp && <McpDialog onClose={() => setMcp(false)} />}
    {newBoard && <BoardForm onClose={() => setNewBoard(false)} onCreated={created} />}
    {settings && board && <BoardSettings board={board} onClose={() => setSettings(false)} refresh={refresh} download={download} />}
    <KeyboardSearch />
  </div>;
}
function ShieldIcon() { return <span className="privacy-mark">↗</span>; }
function KeyboardSearch() {
  useEffect(() => { const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); document.querySelector<HTMLInputElement>('[aria-label="Rechercher des cartes"]')?.focus(); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []); return null;
}
function BoardForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const [title, setTitle] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Modal title="Un nouveau départ" onClose={onClose}><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { const b = await createBoard(title); await onCreated(b.id); } catch (e) { setError((e as Error).message); setBusy(false); } }}><div className="modal-body form-stack"><div className="feature-icon"><LayoutGrid size={24} /></div><h2>Quel est votre prochain projet ?</h2><p className="muted">Un tableau, quatre colonnes pour commencer, et toutes vos idées à venir.</p><label htmlFor="board-title">Nom du tableau</label><input id="board-title" autoFocus required maxLength={200} placeholder="Ex. Refonte du site, Mon quotidien…" value={title} onChange={e => setTitle(e.target.value)} />{error && <div className="form-error" role="alert">{error}</div>}</div><footer className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Annuler</button><button className="button primary" disabled={busy || !title.trim()}>{busy ? <Spinner /> : <Plus size={16} />}Créer le tableau</button></footer></form></Modal>;
}
function BoardSettings({ board, onClose, refresh, download }: { board: Board; onClose: () => void; refresh: () => Promise<void>; download: () => void }) {
  const [title, setTitle] = useState(board.title); const [description, setDescription] = useState(board.description); const [color, setColor] = useState(board.color); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [confirm, setConfirm] = useState(false);
  return <><Modal title="Paramètres du tableau" onClose={onClose}><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await api(`/boards/${board.id}`, 'PATCH', { title, description, color }); await refresh(); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><div className="modal-body form-stack"><label htmlFor="settings-title">Nom du tableau</label><input id="settings-title" autoFocus required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /><label htmlFor="settings-description">Description</label><textarea id="settings-description" rows={3} maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} /><label>Couleur du tableau</label><div className="color-options">{(['violet', 'blue', 'green', 'rose'] as const).map(c => <button key={c} type="button" aria-label={`Couleur ${c}`} aria-pressed={color === c} className={`color-option ${c} ${color === c ? 'active' : ''}`} onClick={() => setColor(c)}>{color === c && <Check size={15} />}</button>)}</div><div className="storage-info"><FileJson size={19} /><div><strong>Un tableau, un fichier JSON</strong><p>data/boards/{board.id}.json</p></div></div><button type="button" className="button secondary" onClick={download}><ArrowDownToLine size={16} />Exporter une copie JSON</button><button type="button" className="button quiet danger-text" onClick={() => setConfirm(true)}><Trash2 size={16} />Supprimer le tableau</button>{error && <div className="form-error" role="alert">{error}</div>}</div><footer className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Annuler</button><button className="button primary" disabled={busy || !title.trim()}>{busy && <Spinner />}Enregistrer</button></footer></form></Modal>{confirm && <Confirm title="Supprimer tout le tableau ?" description={`« ${board.title} », ses colonnes et toutes ses cartes seront définitivement supprimés. Exportez une copie JSON si vous souhaitez les conserver.`} busy={busy} onClose={() => setConfirm(false)} onConfirm={async () => { setBusy(true); try { await api(`/boards/${board.id}`, 'DELETE'); await refresh(); onClose(); } catch (e) { setError((e as Error).message); setConfirm(false); } finally { setBusy(false); } }} />}</>;
}
