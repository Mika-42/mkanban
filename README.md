# mkAgile

Un Kanban local, en français, inspiré des principes de Trello. **Chaque projet est un fichier JSON indépendant.** Le navigateur et les assistants IA utilisent le même stockage, sans base de données ni service externe.

## Démarrer en local

Prérequis : **Node.js 24+** et npm.

```sh
npm ci
npm run dev
```

Ouvrir **http://127.0.0.1:3000**. Un seul processus sert l’interface, l’API et MCP. Créer un premier projet ou choisir « Explorer un exemple ». Aucun exemple n’est créé automatiquement au démarrage.

Pour une utilisation courante avec l’interface compilée :

```sh
npm run build
npm start
```

Les sources TypeScript sont exécutées par `tsx`, fourni dans les dépendances de production. En développement, le serveur redémarre après les modifications du backend ; actualiser le navigateur après les modifications du frontend.

## Avec Docker

```sh
docker compose up --build -d
```

Même adresse : **http://127.0.0.1:3000**. Le volume nommé `kanban-data` conserve les fichiers JSON lors des redémarrages et des reconstructions. `docker compose down` les conserve ; `docker compose down -v` **supprime les données**.

Le conteneur s’exécute avec l’utilisateur non privilégié `node`. Le port publié reste lié à l’interface locale. Pour récupérer les fichiers :

```sh
docker compose cp mkanban:/app/data/boards ./sauvegarde-boards
```

## Utiliser les projets

- Plusieurs projets, chacun avec son nom, sa description et sa couleur. Cliquer sur « Mon espace », « Mes projets » ou le logo pour afficher tous les projets sous forme de tuiles, les rechercher et en ouvrir un. Cette vue reste ouverte après actualisation ; la suppression du projet courant y ramène également.
- Colonnes déplaçables, renommables et colorables. Compteur de cartes et somme des story points, y compris les cartes terminées. Les filtres ne changent pas les totaux.
- Cartes déplaçables au sein d’une colonne ou vers une autre. Utiliser la poignée en haut à droite ; une alternative de déplacement existe dans le détail de la carte. Les colonnes proposent aussi un menu gauche/droite. Le déplacement au clavier commence avec Espace sur une poignée, puis les flèches et Espace pour déposer, Échap pour annuler.
- Clic droit sur une fiche : **Assigner**, **Dupliquer**, **Scinder** ou **Supprimer**, directement depuis le Kanban. Le bouton « … » de la fiche ouvre le même menu sur mobile. Au clavier, utiliser ce bouton ou `Maj + F10` depuis la fiche, puis les flèches, Entrée et Échap.
- Titre, description Markdown avec aperçu GFM, checklist éditable, date d’échéance, étiquettes/flags libres, membres et points entiers de 0 à 999. Les membres sont des noms, pas des comptes utilisateurs.
- Case terminé/non terminé. Terminer une carte ne la déplace pas automatiquement.
- Découpage : nouvelle carte adjacente, répartition des points, transfert des éléments de checklist choisis. Le total des points reste inchangé ; les autres propriétés et la description sont copiées. Enregistrer les modifications avant de scinder.
- Recherche (`Ctrl/Cmd + K`) et filtres par membre, étiquette et état. Export JSON depuis la barre d’outils ou les paramètres du projet.
- Onglet **Graphiques** : burn-up et burn-down en story points, période personnalisable, exploration au survol ou au clavier, valeurs par jour et exports CSV/SVG.
- Onglet **Gantt** : dates de début et de fin, jalons, liens entre fiches, conflits, déplacement/redimensionnement des barres et planification automatique avec aperçu. Ces opérations sont aussi disponibles via MCP.
- Suppressions confirmées. Pour une colonne non vide, choisir de déplacer toutes ses fiches à la fin d’une autre colonne du même projet, ou de supprimer définitivement la colonne et ses fiches. Aucune option n’est choisie automatiquement. Le transfert conserve l’ordre, les propriétés et les points des fiches ; il est enregistré avec la suppression de la colonne en une seule écriture JSON. Pour la dernière colonne du projet, seule la suppression confirmée des fiches est proposée.

Les données sont enregistrées côté serveur à chaque action. Dans le détail d’une carte, cliquer sur **Enregistrer** pour appliquer les modifications. Les changements MCP apparaissent dans le navigateur sous environ 2,5 secondes. Si une carte a changé depuis son ouverture, l’enregistrement du brouillon est refusé : fermer et rouvrir la carte pour récupérer la version courante.

L’assignation rapide permet de sélectionner plusieurs noms déjà utilisés dans le projet, d’en ajouter un ou de retirer tous les membres, sans ouvrir l’éditeur complet. Le découpage rapide reprend la répartition des points et le transfert des éléments de checklist. Ces deux actions refusent un brouillon obsolète si la fiche a été modifiée entre-temps. La suppression demande toujours confirmation et retire les liens vers la fiche supprimée.

Dans les fenêtres d’édition, seul le contenu défile : le titre, la fermeture et les boutons d’action restent visibles. La barre de défilement interne suit le thème et ne déborde pas du cadre arrondi.

**Dupliquer** est disponible dans le menu rapide (clic droit, bouton « … » ou clavier) et dans l’éditeur d’une fiche enregistrée. La copie est placée juste après l’originale dans la même colonne, avec le suffixe « (copie) ». Description Markdown, story points, membres, étiquettes, dates, prédécesseurs et checklist sont copiés ; les cases de checklist gardent leur état, tandis que la fiche est marquée non terminée. Les identifiants et les dates de création/modification sont renouvelés. La fiche originale, ses dépendants et ses liens depuis le journal des décisions restent inchangés. La duplication ajoute les points de la copie au périmètre du projet.

L’outil MCP `duplicate_card` prend `boardId`, `cardId`, un `title` facultatif et `expectedUpdatedAt` pour refuser une source obsolète. L’équivalent HTTP est `POST /api/boards/{boardId}/cards/{cardId}/duplicate`, avec ces deux options dans le corps JSON. La copie et l’historique des points sont enregistrés ensemble dans le JSON du projet.

## Journal des décisions

L’onglet **Décisions** conserve la mémoire de chaque projet sous forme de bulles empilées avec un contour coloré, un numéro permanent (`ADR-001`, `ADR-002`…), un titre, un type et un état :

| État | Valeur API/MCP | Couleur | Portée pour l’IA |
| --- | --- | --- | --- |
| Brouillon | `draft` | Gris | Contexte |
| En réflexion | `discussing` | Bleu | Contexte |
| À valider | `proposed` | Orange | Contexte |
| Validée | `accepted` | Vert | Contrainte officielle si non supprimée |
| Rejetée | `rejected` | Rouge | Historique |
| Remplacée | `superseded` | Gris | Historique, avec lien vers la successeure |

Créer ou ouvrir une bulle pour renseigner le contexte, les alternatives, la décision retenue, la justification et les conséquences en Markdown, avec aperçu. Les types disponibles sont Technique, Fonctionnelle, Produit, Organisation et Autre. Des étiquettes libres et des liens vers les fiches du projet, d’autres décisions et des documents HTTP(S) complètent chaque entrée. Les fiches liées s’ouvrent directement depuis le journal et indiquent leur propre avancement : une décision validée ne signifie pas que son implémentation est terminée.

Cliquer sur l’en-tête d’une bulle ou **Lire la décision** pour la déplier : les cinq sections s’affichent intégralement en Markdown, sans extrait tronqué. **Replier** retrouve la vue compacte (numéro, titre, type, état, dates, étiquettes et liens). Plusieurs décisions peuvent rester dépliées et leur contenu s’actualise avec les changements MCP. Le bouton **Modifier** ouvre séparément l’éditeur ; les décisions supprimées restent consultables en lecture seule.

Le cycle nominal est `draft → discussing → proposed → accepted`. Une proposition peut être rejetée ; une décision rejetée peut être rouverte en réflexion. Des retours de « À valider » à « En réflexion » et de « En réflexion » à « Brouillon » sont possibles. Pour valider, documenter au minimum la décision retenue et sa justification. Une décision validée peut être remplacée en sélectionnant une autre décision validée et active du même projet. Les décisions remplacées conservent leur lien, même si leur successeure est ensuite remplacée ou supprimée.

Les dates de création, de modification, de changement d’état, de dernière validation ou de rejet et de suppression sont générées par le serveur en UTC. Chaque modification conserve une révision complète avec son contenu et son état. L’éditeur permet de consulter ces versions. Une modification concurrente refuse l’enregistrement ou la suppression d’un brouillon obsolète.

Filtrer par état, type, texte (numéro ADR et contenu compris), étiquette, fiche liée et période. Les bornes de dates sont des jours UTC inclusifs ; choisir de filtrer la création, la dernière modification, la dernière validation/rejet ou le dernier changement d’état. Le tri propose les créations récentes ou anciennes, les dernières modifications ou le numéro ADR.

**Supprimer une décision** la masque du journal courant et la rend historique pour l’IA, après confirmation. Son contenu et ses révisions restent accessibles en lecture seule avec le filtre « Décisions supprimées ». Son numéro n’est jamais réutilisé. Le journal, les décisions supprimées et le compteur `nextDecisionNumber` restent dans le **même JSON que le projet**, sans fichier annexe. Les anciens projets sans journal sont compatibles et commencent avec une liste vide. Supprimer le projet entier supprime aussi son journal et son historique ; exporter le JSON permet de les sauvegarder ensemble.

### MCP du journal

- `list_decisions` : récupérer toutes les décisions courantes, avec le contenu complet et l’historique. Filtres : `statuses`, `types`, `search`, `tag`, `linkedCardId`, `dateField`, `dateFrom`, `dateTo`, `sort`, `deleted` (`exclude`, `include`, `only`). Pour l’ensemble des décisions, anciennes et supprimées comprises, utiliser `deleted: "include"` sans autres filtres.
- `get_decision` : lire une décision par son UUID, y compris son historique après suppression.
- `create_decision` : créer une décision ; le serveur attribue l’UUID, le numéro et les dates. `status` vaut `draft` par défaut. Les champs sont `title`, `type`, `status`, `context`, `alternatives`, `outcome`, `rationale`, `consequences`, `tags`, `links` et `supersededBy`. Un lien utilise `{ "kind": "card" | "decision" | "url", "target": "<UUID ou URL>", "label": "<facultatif>" }`.
- `update_decision` : modifier partiellement ces champs et ajouter une révision. Les listes fournies remplacent les listes existantes. Fournir `expectedUpdatedAt` après lecture pour protéger contre les conflits. Pour remplacer une décision validée : `status: "superseded"` et `supersededBy: "<UUID de la nouvelle décision validée>"`.
- `delete_decision` : masquer une décision en conservant l’historique et le numéro ; accepte `expectedUpdatedAt`. Demander la confirmation de l’utilisateur.

Ces outils prennent tous `boardId` (UUID du projet) ; les opérations sur une décision prennent aussi `decisionId`. La ressource `kanban://boards/{boardId}/decisions` renvoie tout le journal, suppressions comprises. `get_board` et la ressource du projet incluent également les décisions. Les réponses MCP précisent leur `authority` : `binding`, `contextual` ou `historical`, et la politique d’interprétation. Seules les décisions **validées et non supprimées** guident l’implémentation. L’assistant doit obtenir l’approbation explicite de l’utilisateur avant de valider une décision.

L’application s’appelle **mkAgile** et présente des **projets** avec une vue **Kanban**. Pour conserver la compatibilité des clients existants et des données, les identifiants techniques `boardId`, les routes `/api/boards`, les outils `*_board`, les ressources `kanban://boards`, le dossier `data/boards` et le nom du service Docker restent inchangés.

## Relations et analyse d’impact

L’onglet **Relations** centralise les documents, les exigences et les éléments à réexaminer du projet. Documents et exigences possèdent un titre, un contenu Markdown avec aperçu, une adresse externe HTTP(S) facultative et des dates de création/modification. Ils peuvent être créés, modifiés, recherchés et filtrés par type. Leur suppression confirmée les masque sans effacer les relations ou les signalements historiques ; une option permet de les consulter en lecture seule.

Dans l’éditeur d’une **fiche**, d’une **décision**, d’un **document** ou d’une **exigence**, la section **Relations et traçabilité** permet de créer et retirer des liens, puis d’ouvrir les éléments associés. Chaque lien est consultable dans les deux sens. Une fiche peut ainsi être liée à plusieurs décisions, documents et exigences. Quatre types sont proposés :

- **Est associé à** (`relates_to`) : association symétrique.
- **Met en œuvre** (`implements`), **Documente** (`documents`), **Valide** (`validates`) : relations orientées ; choisir le sens lors de la création.

Les relations restent distinctes des dépendances du Gantt et ne changent ni la validation d’une décision ni l’avancement d’une fiche. Les liens déjà enregistrés dans les décisions sont présentés dans les deux sens, sans migration ni réécriture de l’historique ; ils restent modifiables dans la liste des liens de leur décision. Les liens directs vers des documents externes HTTP(S) sont aussi acceptés. Les liens vers soi-même, les doublons et les références à un autre projet ou à un élément supprimé sont refusés.

### Impact et réexamen

Choisir une décision dans **Analyse d’impact** pour retrouver les éléments directement ou indirectement concernés. Les résultats montrent le chemin et le nombre d’étapes. Les relations génériques et les liens historiques des décisions se parcourent dans les deux sens ; les dépendances du Gantt propagent l’impact uniquement vers les fiches suivantes. Les cycles de relations sont supportés. Le lien « Remplacée par » n’est pas parcouru : les seules relations explicites de la nouvelle décision ne sont pas automatiquement considérées comme affectées.

Lorsqu’une décision validée est **remplacée**, des signalements « À réexaminer » sont créés pour les fiches, documents, exigences et adresses externes atteints. Ils sont enregistrés dans la même écriture JSON que le remplacement. Les autres décisions rencontrées apparaissent dans l’analyse, sans devenir des tâches de revue. Les éléments concernés ne sont pas modifiés automatiquement.

Un signalement conserve la décision d’origine, sa remplaçante, le titre de l’élément, le chemin et la date de détection. Cliquer sur **Réexaminer** pour ajouter une note et marquer la revue terminée ; elle peut être rouverte. Cette action ne termine pas la fiche Kanban. Les notes et signalements restent disponibles après suppression d’un lien ou d’une fiche. Le bouton **Actualiser les éléments à réexaminer** d’une décision remplacée ajoute les nouveaux éléments atteints sans réinitialiser les revues déjà effectuées.

Les champs `knowledge`, `relations` et `impactReviews` sont conservés dans le même JSON que les fiches et décisions. Les projets plus anciens utilisent des listes vides par défaut. L’export JSON sauvegarde l’ensemble. Une duplication de fiche ne recopie pas ses relations de traçabilité ni ses signalements ; les liens de l’originale sont conservés.

### MCP et API des relations

- `list_knowledge`, `create_knowledge`, `update_knowledge`, `delete_knowledge` : gérer les documents/exigences. La création prend `kind: "document" | "requirement"`, `title`, `content` et `url` (ou `null`). Les mises à jour prennent `itemId` et un patch ; `expectedUpdatedAt` protège modifications et suppressions. `list_knowledge` accepte `includeDeleted`.
- `list_relations` : récupérer tous les liens ou ceux d’un `entity: { "kind": "card" | "decision" | "document" | "requirement" | "url", "id": "<UUID ou URL>" }`. Pour un élément, les résultats comprennent le sens, l’autre élément et son titre. `origin: "decision-link"` indique un lien historique à modifier via `update_decision`.
- `create_relation` : fournir `source`, `target` et `type` ; `delete_relation` retire un lien explicite par `relationId` sans supprimer les éléments liés.
- `analyze_impact` : fournir `decisionId`. Par défaut, l’analyse ne modifie rien. Pour une décision remplacée, `recordReviews: true` ajoute les signalements manquants.
- `list_impact_reviews` : consulter les signalements avec `status: "pending" | "reviewed" | "all"`.
- `review_impact` : fournir `reviewId`, `reviewed` (vrai/faux), une `note` facultative et `expectedUpdatedAt` après lecture. Une note omise conserve la note existante.

Tous ces outils prennent `boardId`. L’API propose les équivalents sous `/api/boards/{boardId}` : `GET/POST /knowledge`, `PATCH/DELETE /knowledge/{itemId}`, `GET/POST /relations`, `DELETE /relations/{relationId}`, `GET/POST /decisions/{decisionId}/impact`, `GET /impact-reviews` et `PATCH /impact-reviews/{reviewId}`. Le `GET /relations` accepte `kind` et `id` pour la consultation bidirectionnelle ; `GET /knowledge?includeDeleted=true` inclut les éléments masqués. Les ressources MCP et `get_board` incluent aussi ces collections.

## Gantt et dépendances

Ouvrir l’onglet **Gantt** dans un projet. Dans le détail d’une fiche, la section **Planning et dépendances** permet de renseigner le début planifié, l’échéance et les prédécesseurs. L’échéance existante est la date de fin : aucune deuxième date de fin n’est ajoutée. Sans date, la fiche figure dans « Fiches à planifier ». Avec une seule date, elle est affichée comme un jalon d’un jour.

Les dates sont inclusives et les durées sont des **jours calendaires**, week-ends compris. Les liens sont de type **fin → début** : un successeur commence au plus tôt le lendemain de la fin de tous ses prédécesseurs. Les liens vers soi-même, les doublons, les cycles et les références à un autre projet sont refusés côté serveur, quelle que soit l’origine de la modification.

Le Gantt affiche les liens, les fiches qui attendent des prédécesseurs non terminés et les conflits de dates. Les conflits restent visibles sans déplacer automatiquement les fiches. Une dépendance signale le blocage ; elle n’empêche pas de marquer manuellement une fiche comme terminée. Cliquer sur une ligne (ou utiliser Entrée/Espace au clavier) ouvre la fiche. Glisser une barre décale ses dates en conservant sa durée ; ses poignées ajustent le début ou la fin. Les dates restent également éditables dans le formulaire de la fiche. Des dates inversées sont refusées.

Le sélecteur d’échelle propose Jour, Semaine et Mois. Les dates de la vue et « Cadrer les fiches » permettent de naviguer dans le planning ; les échelles changent uniquement son affichage. Le diagramme défile horizontalement et verticalement, y compris sur mobile. L’export SVG utilise la période et l’échelle affichées ; le CSV contient toutes les fiches avec dates, durées, prédécesseurs, blocages et conflits.

**Planifier automatiquement** génère d’abord un aperçu. L’algorithme parcourt les dépendances dans l’ordre, conserve les durées existantes et considère les dates de début actuelles comme des bornes minimales. Une fiche sans date reçoit la durée par défaut choisie. Les fiches terminées restent fixes, sauf si l’option de les inclure est cochée. Si un prédécesseur terminé n’a aucune date, il faut le dater ou inclure les fiches terminées. Après confirmation, les changements sont appliqués en une seule écriture sous verrou ; si une fiche a changé depuis l’aperçu, celui-ci est refusé et doit être régénéré. Les points et l’état terminé ne changent pas.

Le stockage ajoute `startDate` (date ou `null`) et `dependencies` (identifiants des prédécesseurs) à chaque fiche, dans le même JSON. Les anciennes fiches restent compatibles : début vide et liste de dépendances vide par défaut. Supprimer une fiche ou une colonne avec ses fiches retire les liens devenus orphelins et actualise les versions des fiches concernées. Scinder une fiche copie ses dates et ses prédécesseurs vers la nouvelle fiche ; les successeurs existants continuent de référencer la fiche originale.

## Burn-up et burn-down

Dans chaque projet, ouvrir **Graphiques** à côté de l’onglet Kanban. Les indicateurs en haut affichent les points actuels du projet ; les courbes couvrent la période sélectionnée, indépendamment de la recherche et des filtres de cartes.

- **Burn-up** : points des cartes actuellement cochées « terminées », comparés au total des points du projet. Le total peut varier si des cartes sont ajoutées, supprimées ou réestimées.
- **Burn-down** : points restants (`total − terminés`), comparés à une ligne idéale allant du reste à faire de la première journée connue de la période jusqu’à zéro à la date de fin. Cette ligne est une référence linéaire, pas une prévision de livraison. Une période d’une journée montre seulement les valeurs de cette journée.

La case terminé/non terminé fait foi, quelle que soit la colonne. Rouvrir une carte ou changer son estimation modifie donc les courbes. Supprimer une carte retire ses points du périmètre actuel ; l’historique conserve les observations précédentes. Déplacer les cartes ou renommer une colonne ne change pas les totaux.

Le serveur enregistre une observation horodatée chaque fois que les points totaux ou terminés changent, dans le champ `pointHistory` du **même fichier JSON que le projet**. Les actions du navigateur, de l’API HTTP et de MCP utilisent le même mécanisme, sous verrou. Les observations restent disponibles après redémarrage et sont incluses dans l’export JSON, `get_board` et la ressource MCP du projet. Aucun service de collecte externe n’est nécessaire.

Les projets existants sont migrés automatiquement lors de leur première lecture : une première observation décrit leur état courant. **La progression antérieure n’est pas reconstruite**, car elle n’était pas conservée. Les courbes restent vides avant le début du suivi. Les jours sans modification reprennent la dernière valeur connue ; la journée courante représente la dernière observation disponible. Les valeurs futures restent vides, même si la ligne idéale s’étend à une échéance future.

Les dates correspondent au fuseau du navigateur, affiché sous les graphiques. Plusieurs modifications dans une journée sont regroupées en sa dernière valeur observée. Les périodes rapides couvrent 7, 30 ou 90 jours, et « Tout l’historique » revient au début du suivi. Une période personnalisée peut aller jusqu’à 10 ans. Le tableau de valeurs et l’export CSV utilisent les mêmes données ; les valeurs inconnues sont vides dans le CSV. Chaque graphique peut être téléchargé au format SVG autonome.

## Stockage JSON et sauvegardes

Par défaut, le stockage se trouve dans **`data/boards/`**, à la racine du projet :

```text
data/boards/
  6f699bb8-56fb-4f20-89b5-3284a33146b2.json
  a0f55ec1-8141-4a4a-85d2-678e3125320a.json
```

Chaque fichier contient `schemaVersion: 1`, l’identifiant, le titre, la description, la couleur, les colonnes et leurs cartes, checklists et propriétés, ainsi que `pointHistory` pour l’historique des points. Chaque observation contient `at` (date UTC ISO), `total` et `completed`. Le nom est l’UUID du projet : renommer le projet ne renomme pas son fichier. Le fichier reste lisible et portable ; aucun fichier séparé n’est nécessaire pour les cartes. Les données ne sont pas stockées dans le navigateur (seul l’identifiant du projet sélectionné y est mémorisé).

Les écritures utilisent un fichier temporaire, une synchronisation sur disque, un remplacement atomique et un verrou interprocessus commun au dossier. Cela évite les JSON partiellement écrits et les pertes lors d’écritures concurrentes par le serveur web et MCP. Utiliser un disque local ; le fonctionnement des verrous sur NFS et autres partages réseau n’est pas garanti.

Pour sauvegarder, copier `data/boards/` (serveur arrêté pour une copie cohérente de tous les projets), ou exporter chaque projet depuis l’interface. Pour restaurer, arrêter les serveurs web et MCP, puis remettre les fichiers `<id>.json` dans le dossier. L’`id` interne doit correspondre au nom du fichier, les UUID doivent rester uniques. Un JSON invalide est signalé et n’est pas ignoré silencieusement. Ne pas modifier directement les fichiers pendant que l’application ou un assistant écrit dedans.

Les projets d’exemple et les données personnelles sont ignorés par Git.

## Connecter une IA avec MCP

Le serveur implémente le protocole MCP avec le SDK officiel. Deux transports sont disponibles.

### Streamable HTTP

Lorsque l’application fonctionne : **`http://127.0.0.1:3000/mcp`**.

Ouvrir « Connecter une IA » pour copier l’adresse et un exemple de configuration. Pour un client qui accepte ce format :

```json
{
  "mcpServers": {
    "mkAgile": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

Adapter au format propre à votre client MCP. Le transport HTTP est sans session ; les requêtes MCP se font avec POST. GET et DELETE retournent 405. L’assistant doit pouvoir joindre cette machine ; une IA hébergée à distance ne peut pas joindre directement l’adresse locale de votre ordinateur.

### Stdio

Pour un client lançant un processus MCP local, remplacer les chemins ci-dessous par les chemins absolus du projet :

```json
{
  "mcpServers": {
    "mkAgile": {
      "command": "node",
      "args": [
        "/chemin/absolu/mkAgile/node_modules/tsx/dist/cli.mjs",
        "/chemin/absolu/mkAgile/server/stdio.ts"
      ],
      "env": {
        "DATA_DIR": "/chemin/absolu/mkAgile/data/boards"
      }
    }
  }
}
```

Le serveur web n’est pas nécessaire pour stdio. Quand les deux sont utilisés, configurer **le même chemin absolu `DATA_DIR`**. Le script `npm run mcp` sert à un lancement manuel ; pour un client MCP, utiliser la commande `node` ci-dessus afin de ne pas mélanger la bannière npm avec les messages JSON-RPC sur stdout.

### Outils et ressources

34 outils :

| Objet | Outils |
| --- | --- |
| Projets | `list_boards`, `get_board`, `create_board`, `update_board`, `delete_board` |
| Décisions | `list_decisions`, `get_decision`, `create_decision`, `update_decision`, `delete_decision` |
| Colonnes | `create_column`, `update_column`, `move_column`, `delete_column` |
| Cartes | `get_card`, `create_card`, `update_card`, `move_card`, `delete_card`, `split_card`, `duplicate_card` |
| Planning | `get_gantt`, `update_schedule`, `auto_schedule` |
| Documentation et exigences | `list_knowledge`, `create_knowledge`, `update_knowledge`, `delete_knowledge` |
| Relations | `list_relations`, `create_relation`, `delete_relation` |
| Impact | `analyze_impact`, `list_impact_reviews`, `review_impact` |

Ressources : `kanban://boards`, `kanban://boards/{boardId}` et `kanban://boards/{boardId}/decisions`. `get_board` expose aussi les compteurs, les points par colonne et le journal avec la portée des décisions pour l’IA.

Les mises à jour sont partielles. `update_card` remplace les listes fournies (`members`, `flags`, `checklist`) ; lire d’abord la carte pour les compléter. `expectedUpdatedAt` permet de refuser une modification obsolète. Les positions sont des index commençant à 0. Lors d’un déplacement de carte, l’index est celui de la destination après retrait de la carte. Les éléments de checklist doivent avoir un identifiant unique. Les dates utilisent `YYYY-MM-DD`.

Les actions rapides utilisent les mêmes opérations que MCP : `update_card` avec `members` pour assigner, `delete_card` pour supprimer et `split_card` pour scinder. `split_card` accepte aussi `expectedUpdatedAt` afin de refuser un découpage obsolète sans changer les fiches ni leurs points.

`delete_column` protège par défaut les colonnes non vides. Pour transférer les fiches avant suppression, fournir `options: { "mode": "move", "targetColumnId": "<id-destination>" }`. Pour confirmer leur suppression définitive, lire la colonne puis fournir `options: { "mode": "delete", "expectedCardIds": ["<id-carte>"] }` avec tous ses identifiants de cartes actuels. Si la liste de cartes a changé entre-temps, la suppression est refusée. L’API HTTP accepte les mêmes options directement dans le corps JSON du `DELETE /api/boards/{boardId}/columns/{columnId}`. Une colonne vide peut toujours être supprimée sans options.

Toutes les opérations du Gantt sont accessibles par MCP :

- `create_card` et `update_card` acceptent `startDate`, `dueDate` et `dependencies`. Envoyer `null` pour retirer une date et `[]` pour retirer tous les prédécesseurs.
- `get_gantt` retourne toutes les fiches, les liens `finish_to_start`, les durées, `blockedBy`, les conflits et les compteurs. `format: "csv"` ou `format: "svg"` retourne `{ mimeType, content }` avec le fichier complet en texte. Le SVG accepte `startDate`, `endDate` et `dayWidth` (28 pour Jour, 10 pour Semaine, 3 pour Mois ; plage 2–80). Les périodes de vue sont limitées à 10 ans.
- `update_schedule` accepte `changes: [{ cardId, startDate?, dueDate?, dependencies?, expectedUpdatedAt? }]` pour modifier jusqu’à 1 000 fiches en une opération atomique. Le graphe final est validé, ce qui permet de remplacer plusieurs liens simultanément sans cycle intermédiaire. Un conflit de version annule toute la mise à jour.
- `auto_schedule` accepte `projectStart`, `defaultDurationDays` (1 par défaut), `includeCompleted` (faux par défaut) et `dryRun` (vrai par défaut). Lire d’abord l’aperçu et sa `revision`, puis confirmer avec `dryRun: false` et `expectedRevision` égal à cette révision. L’application et MCP utilisent exactement le même algorithme et les mêmes règles de validation.

L’API HTTP fournit les équivalents : `GET /api/boards/{boardId}/gantt` (paramètres d’export dans la query), `PATCH /api/boards/{boardId}/schedule` et `POST /api/boards/{boardId}/auto-schedule`. Par exemple, un assistant peut créer deux fiches, déclarer la seconde dépendante de la première, prévisualiser leur planification, la confirmer puis obtenir le SVG, sans passer par le navigateur.

Exemple de requête à votre assistant : « Lis le projet Lancement produit. Scinde la carte Dessiner les premiers écrans en deux cartes, transfère la tâche Version mobile et 2 points à la nouvelle, puis place-la dans À faire. »

Les suppressions portent une annotation MCP destructive et la consigne de demander confirmation. L’autorisation effective des appels dépend du client IA ; un outil MCP n’affiche pas de dialogue de confirmation dans le navigateur.

## Configuration

| Variable | Valeur par défaut | Rôle |
| --- | --- | --- |
| `PORT` | `3000` | Port du serveur |
| `HOST` | `127.0.0.1` | Interface d’écoute, `0.0.0.0` dans Docker |
| `DATA_DIR` | `<projet>/data/boards` | Dossier des fichiers JSON ; chemin absolu recommandé |
| `ALLOWED_HOSTS` | vide | Noms d’hôtes supplémentaires autorisés, séparés par des virgules |
| `NODE_ENV` | développement | `production` pour servir `dist/` |

L’application vise un usage personnel ou par des processus de confiance sur une machine locale. Il n’y a pas de comptes ni d’authentification. Le serveur refuse les hôtes inconnus et les requêtes d’origine différente. Ne pas l’exposer directement sur Internet ; un accès distant demande un proxy HTTPS avec authentification et une adaptation de la politique d’origine. Aucun service tiers ni clé d’API n’est nécessaire.

## Développement et validation

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium  # uniquement si aucun Chromium compatible n’est installé
npm run test:e2e
```

Les tests de service vérifient les fichiers JSON, la persistance, les écritures concurrentes, les déplacements, le découpage, les entrées invalides, les conflits, le transfert ou la suppression des fiches d’une colonne et le protocole réel MCP HTTP et stdio. Ils couvrent aussi l’historique des points, la migration des anciens projets, les changements de fuseau, l’absence d’historique et les périodes futures ou invalides. Les tests Chromium vérifient les propriétés, le rendu Markdown, les checklists, les déplacements des cartes et colonnes, l’export, les modifications IA, la vue d’ensemble des projets, les confirmations de suppression, les graphiques et le mobile. Ils utilisent le port 3100 et des données isolées sous `test-results/boards`. `CHROMIUM_PATH` permet de choisir un exécutable ; `/usr/bin/chromium` est utilisé s’il est présent.

Le journal est couvert par des tests de numérotation concurrente, de persistance et de migration, de transitions d’état, de remplacement, d’historique complet, de suppression conservant les numéros, de liens, de conflits et de filtres UTC. Les parcours navigateur vérifient le contenu Markdown, les liens vers les fiches, les filtres combinés, les échanges MCP en direct, l’historique supprimé en lecture seule et l’éditeur sur mobile.

Structure : `client/src` (React), `shared/planning.ts` (graphe, calculs et exports Gantt communs au navigateur et au serveur), `server/store.ts` (JSON et règles métier), `server/app.ts` (API HTTP), `server/mcp.ts` (outils MCP), `server/stdio.ts` (transport stdio).
