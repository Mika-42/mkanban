import { useState } from 'react';
import { ArrowUpRight, FileJson, LayoutGrid, Plus, Search, X } from 'lucide-react';
import type { BoardSummary } from '../../server/schema';

export function BoardsOverview({ boards, onOpen, onCreate }: { boards: BoardSummary[]; onOpen: (id: string) => void; onCreate: () => void }) {
  const [search, setSearch] = useState('');
  const visible = boards.filter(b => `${b.title} ${b.description}`.toLocaleLowerCase('fr').includes(search.trim().toLocaleLowerCase('fr')));
  return <section className="boards-overview" aria-label="Vue d’ensemble des projets">
    <div className="overview-heading"><div><div className="board-eyebrow"><LayoutGrid size={13} />MON ESPACE</div><h1>Mes projets</h1><p>Tous vos projets, au même endroit. Choisissez où faire avancer vos idées.</p></div><button className="button primary" onClick={onCreate}><Plus size={17} />Nouveau projet</button></div>
    <div className="overview-toolbar"><span>{boards.length} projet{boards.length > 1 ? 's' : ''}</span><div className="search-field"><Search size={16} /><input aria-label="Rechercher un projet" placeholder="Rechercher un projet…" value={search} onChange={e => setSearch(e.target.value)} />{search && <button aria-label="Effacer la recherche de projets" onClick={() => setSearch('')}><X size={14} /></button>}</div></div>
    <div className="boards-grid">{visible.map(board => <button className={`board-tile ${board.color}`} key={board.id} aria-label={`Ouvrir le projet ${board.title}`} onClick={() => onOpen(board.id)}>
      <div className="board-tile-cover" aria-hidden="true"><div className="board-tile-preview"><span><i /><i /></span><span><i /></span><span><i /><i /></span></div><span className="board-tile-open"><ArrowUpRight size={19} /></span></div>
      <div className="board-tile-content"><h2>{board.title}</h2><p>{board.description || 'Un espace pour vos prochaines idées.'}</p><span><FileJson size={13} />Créé le {new Date(board.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
    </button>)}{!search.trim() && <button className="new-board-tile" aria-label="Créer un autre projet" onClick={onCreate}><span><Plus size={25} /></span><strong>Un nouveau projet ?</strong><span>Créer un projet</span></button>}</div>
    {!visible.length && <div className="overview-no-results"><Search size={25} /><h2>Aucun projet trouvé</h2><p>Essayez un autre nom ou une autre description.</p><button className="text-button" onClick={() => setSearch('')}>Afficher tous les projets</button></div>}
  </section>;
}
