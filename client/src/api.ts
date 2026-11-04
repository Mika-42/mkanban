import type { Board, BoardSummary } from '../../server/schema';

export async function api<T>(url: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/api${url}`, { method, headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Erreur ${response.status}`);
  return value as T;
}
export async function createBoard(title: string, example = false) {
  const board = await api<Board>('/boards', 'POST', { title, description: example ? 'De la première idée au lancement. Une carte à la fois.' : '' });
  const columns: { id: string }[] = [];
  for (const [i, title] of ['À explorer', 'À faire', 'En cours', 'Terminé'].entries()) columns.push(await api<{ id: string }>(`/boards/${board.id}/columns`, 'POST', { title, color: ['gray', 'blue', 'violet', 'green'][i] }));
  // Explicitly requested sample data; no example is created on application startup.
  if (example) {
    const examples = [
      { column: 0, title: 'Et si on simplifiait le quotidien ?', description: '## Le point de départ\n\nUn espace pour garder nos idées au même endroit.\n\n> Moins de friction, plus de clarté.\n\n- Écouter les retours\n- Identifier les petits irritants\n- Imaginer une solution simple', flags: ['Idée'], points: 3, members: ['Camille'] },
      { column: 0, title: 'Recueillir les inspirations', description: 'Rassembler les références et les partager avec toute l’équipe.', flags: ['Design'], points: 2, members: ['Alex'] },
      { column: 1, title: 'Dessiner les premiers écrans', description: '### Objectif\nTrouver le bon équilibre entre simplicité et personnalité.\n\n**Livrable :** une première proposition des écrans clés.', flags: ['Design', 'Priorité haute'], points: 5, members: ['Alex', 'Camille'], checklist: [{ id: crypto.randomUUID(), text: 'Vue du tableau', done: true }, { id: crypto.randomUUID(), text: 'Détail d’une carte', done: false }, { id: crypto.randomUUID(), text: 'Version mobile', done: false }] },
      { column: 1, title: 'Préparer le guide de démarrage', description: 'Un guide court pour se sentir chez soi dès la première minute.', flags: ['Contenu'], points: 2, members: ['Sam'] },
      { column: 1, title: 'Connecter notre assistant IA', description: 'Configurer le serveur **MCP** pour laisser notre assistant organiser les tâches avec nous.', flags: ['Technique'], points: 3, members: ['Camille'] },
      { column: 2, title: 'Donner vie au tableau', description: 'Les cartes prennent leur place. Déplacement, édition et petites attentions au programme.', flags: ['Technique'], points: 8, members: ['Camille', 'Sam'], checklist: [{ id: crypto.randomUUID(), text: 'Créer les colonnes', done: true }, { id: crypto.randomUUID(), text: 'Déplacer les cartes', done: true }, { id: crypto.randomUUID(), text: 'Peaufiner les interactions', done: false }] },
      { column: 2, title: 'Trouver les bons mots', description: 'Des textes simples, utiles et un brin chaleureux.', flags: ['Contenu'], points: 3, members: ['Sam'] },
      { column: 3, title: 'Poser les premières idées', description: 'Une vision partagée et un premier cap pour l’équipe. C’est parti !', flags: ['Produit'], points: 2, members: ['Alex'], completed: true },
    ];
    for (const { column, ...card } of examples) await api(`/boards/${board.id}/columns/${columns[column].id}/cards`, 'POST', card);
  }
  return board;
}
export type { Board, BoardSummary };
