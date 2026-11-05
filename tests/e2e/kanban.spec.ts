import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function fixture(page: Page, request: APIRequestContext) {
  const board = await (await request.post('/api/boards', { data: { title: `Tableau de test ${crypto.randomUUID().slice(0, 8)}` } })).json();
  const a = await (await request.post(`/api/boards/${board.id}/columns`, { data: { title: 'À faire' } })).json();
  const b = await (await request.post(`/api/boards/${board.id}/columns`, { data: { title: 'En cours' } })).json();
  await page.addInitScript(id => {
    if (!sessionStorage.getItem('mkanban.test.initialized')) {
      localStorage.setItem('mkanban.board', id);
      sessionStorage.setItem('mkanban.test.initialized', 'true');
    }
  }, board.id);
  return { board, a, b, read: async () => (await request.get(`/api/boards/${board.id}`)).json() };
}

test('create, edit Markdown and properties, complete, split, move, export and delete a card', async ({ page, request }) => {
  const { board, a, b, read } = await fixture(page, request);
  await page.goto('/');
  const column = page.getByRole('region', { name: 'Colonne À faire', exact: true });
  await column.getByRole('button', { name: 'Ajouter une carte', exact: true }).click();
  await page.getByLabel('Qu’avez-vous en tête ?').fill('Livrer le projet');
  await page.getByRole('button', { name: 'Créer la carte', exact: true }).click();
  await page.getByLabel('Description Markdown').fill('## Le plan\n\n**Important** : avancer ensemble.\n\n- Une idée\n- Un livrable');
  await page.getByRole('button', { name: 'Aperçu', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Le plan' })).toBeVisible();
  await expect(page.locator('.markdown strong')).toHaveText('Important');
  await page.getByLabel('Story points', { exact: true }).fill('8');
  await page.getByLabel('Échéance', { exact: true }).fill('2026-12-20');
  await page.getByLabel('Membres', { exact: true }).fill('Mika');
  await page.getByRole('button', { name: 'Ajouter le membre', exact: true }).click();
  await page.getByLabel('Étiquettes / flags', { exact: true }).fill('Urgent');
  await page.getByRole('button', { name: 'Ajouter l’étiquette', exact: true }).click();
  await page.getByLabel('Nouvel élément de checklist').fill('Première tâche');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByLabel('Nouvel élément de checklist').fill('Deuxième tâche');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByLabel('Terminer : Première tâche', { exact: true }).check();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  let current = await read(); let card = current.columns[0].cards[0];
  expect(card.points).toBe(8); expect(card.members).toEqual(['Mika']); expect(card.flags).toEqual(['Urgent']); expect(card.checklist[0].done).toBe(true);
  await expect(column.locator('.column-points')).toHaveText('8');
  await column.getByRole('button', { name: 'Terminer : Livrer le projet', exact: true }).click();
  await expect.poll(async () => (await read()).columns[0].cards[0].completed).toBe(true);
  await column.getByRole('button', { name: 'Livrer le projet', exact: true }).click();
  await page.getByRole('button', { name: 'Scinder', exact: true }).click();
  await page.getByLabel('Titre de la nouvelle carte').fill('Petite livraison');
  await page.getByLabel('Points à transférer').fill('3');
  await page.getByLabel('Deuxième tâche', { exact: true }).check();
  await page.getByRole('button', { name: 'Scinder la carte', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  current = await read();
  expect(current.columns[0].cards.map((c: { points: number }) => c.points)).toEqual([5, 3]);
  expect(current.columns[0].cards[1].checklist[0].text).toBe('Deuxième tâche');
  await column.getByRole('button', { name: 'Petite livraison', exact: true }).click();
  await page.getByLabel('Colonne', { exact: true }).selectOption(b.id);
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  const destination = page.getByRole('region', { name: 'Colonne En cours', exact: true });
  await expect(destination.getByRole('button', { name: 'Petite livraison', exact: true })).toBeVisible();
  await page.reload();
  await expect(destination.locator('.column-points')).toHaveText('3');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter le tableau JSON', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await destination.getByRole('button', { name: 'Petite livraison', exact: true }).click();
  await page.getByRole('button', { name: 'Supprimer la carte', exact: true }).click();
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  expect((await read()).columns[1].cards).toHaveLength(0);
  await request.delete(`/api/boards/${board.id}`);
});

async function drag(page: Page, source: import('@playwright/test').Locator, target: import('@playwright/test').Locator) {
  const a = (await source.boundingBox())!; const b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  await page.mouse.up();
}
test('drag cards and columns, rename a column, and show accurate column totals', async ({ page, request }) => {
  const { board, a, b, read } = await fixture(page, request);
  const one = await (await request.post(`/api/boards/${board.id}/columns/${a.id}/cards`, { data: { title: 'Carte mobile', points: 5 } })).json();
  await request.post(`/api/boards/${board.id}/columns/${b.id}/cards`, { data: { title: 'Carte cible', points: 3 } });
  await page.goto('/');
  const source = page.getByRole('button', { name: 'Déplacer Carte mobile', exact: true });
  const target = page.getByRole('button', { name: 'Carte cible', exact: true });
  await expect(source).toBeAttached(); await expect(target).toBeVisible();
  await drag(page, source, target);
  await expect.poll(async () => (await read()).columns[1].cards.some((c: { id: string }) => c.id === one.id)).toBe(true);
  const dest = page.getByRole('region', { name: 'Colonne En cours', exact: true });
  await expect(dest.locator('.column-count')).toHaveText('2'); await expect(dest.locator('.column-points')).toHaveText('8');
  await drag(page, page.getByRole('button', { name: 'Déplacer la colonne En cours', exact: true }), page.getByRole('region', { name: 'Colonne À faire', exact: true }).locator('.column-header'));
  await expect.poll(async () => (await read()).columns[0].id).toBe(b.id);
  await page.getByRole('button', { name: 'Options de En cours', exact: true }).click();
  await page.getByRole('button', { name: 'Renommer / couleur', exact: true }).click();
  await page.getByLabel('Nom de la colonne', { exact: true }).fill('En revue');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Colonne En revue', exact: true })).toBeVisible();
  await request.delete(`/api/boards/${board.id}`);
});

test('AI edits appear in the browser and a stale editor cannot overwrite them', async ({ page, request }) => {
  const { board, a, read } = await fixture(page, request);
  const card = await (await request.post(`/api/boards/${board.id}/columns/${a.id}/cards`, { data: { title: 'Idée originale', points: 2 } })).json();
  await page.goto('/');
  await page.getByRole('button', { name: 'Idée originale', exact: true }).click();
  const client = new Client({ name: 'browser-ai-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3100/mcp')));
  await client.callTool({ name: 'update_card', arguments: { boardId: board.id, cardId: card.id, title: 'Modifiée par IA', points: 5 } });
  await expect(page.locator('.kanban-card').getByRole('button', { name: 'Modifiée par IA', exact: true })).toBeAttached({ timeout: 8000 });
  await page.getByLabel('Titre de la carte', { exact: true }).fill('Mon ancien brouillon');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cette carte a changé');
  expect((await read()).columns[0].cards[0].title).toBe('Modifiée par IA');
  await client.close();
  await request.delete(`/api/boards/${board.id}`);
});

test('mobile navigation, new boards and search work without document overflow', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ouvrir la navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Nouveau tableau', exact: true }).first().click();
  await page.getByLabel('Nom du tableau', { exact: true }).fill('Mon tableau mobile');
  await page.getByRole('button', { name: 'Créer le tableau', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Mon tableau mobile/ })).toBeVisible();
  const id = await page.evaluate(() => localStorage.getItem('mkanban.board'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('Rechercher des cartes', { exact: true }).fill('Rien');
  await expect(page.getByText('Aucune carte ne correspond')).toHaveCount(4);
  await page.screenshot({ path: '/tmp/mkanban-mobile.png', fullPage: true, animations: 'disabled' });
  await request.delete(`/api/boards/${id}`);
});

test('workspace overview lists and opens boards, remains open after refresh, and handles board deletion', async ({ page, request }) => {
  const { board } = await fixture(page, request);
  const other = await (await request.post('/api/boards', { data: { title: 'Un autre projet', description: 'Retrouver ce projet en recherche' } })).json();
  await page.goto('/');
  await page.getByRole('button', { name: 'Mon espace', exact: true }).click();
  const overview = page.getByRole('region', { name: 'Vue d’ensemble des tableaux' });
  await expect(overview.getByRole('button', { name: `Ouvrir le tableau ${board.title}`, exact: true })).toBeVisible();
  await expect(overview.getByRole('button', { name: 'Ouvrir le tableau Un autre projet', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Colonne À faire', exact: true })).toHaveCount(0);
  // Polling used to force the first board open again. Wait for one actual refresh.
  await page.waitForResponse(response => response.url().endsWith('/api/boards') && response.request().method() === 'GET');
  await expect(overview).toBeVisible();
  await page.reload();
  await expect(overview).toBeVisible();
  await page.getByLabel('Rechercher un tableau', { exact: true }).fill('en recherche');
  await expect(overview.getByRole('button', { name: 'Ouvrir le tableau Un autre projet', exact: true })).toBeVisible();
  await expect(overview.getByRole('button', { name: `Ouvrir le tableau ${board.title}`, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Effacer la recherche de tableaux', exact: true }).click();
  await overview.getByRole('button', { name: 'Ouvrir le tableau Un autre projet', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Un autre projet/ })).toBeVisible();
  await page.getByRole('button', { name: /^Mes tableaux/ }).click();
  await expect(overview).toBeVisible();
  await overview.getByRole('button', { name: `Ouvrir le tableau ${board.title}`, exact: true }).click();
  await request.delete(`/api/boards/${board.id}`);
  await expect(overview).toBeVisible({ timeout: 8000 });
  await expect(overview.getByRole('button', { name: `Ouvrir le tableau ${board.title}`, exact: true })).toHaveCount(0);
  await request.delete(`/api/boards/${other.id}`);
});

test('column deletion can be cancelled or move all cards without losing their details', async ({ page, request }) => {
  const { board, a, b, read } = await fixture(page, request);
  const card = await (await request.post(`/api/boards/${board.id}/columns/${a.id}/cards`, { data: { title: 'À conserver', points: 5, description: '**Description à garder**', checklist: [{ id: 'keep', text: 'À vérifier', done: true }], flags: ['Important'], members: ['Mika'] } })).json();
  await request.post(`/api/boards/${board.id}/columns/${b.id}/cards`, { data: { title: 'Déjà présente', points: 3 } });
  await page.goto('/');
  const openDelete = async () => { await page.getByRole('button', { name: 'Options de À faire', exact: true }).click(); await page.getByRole('button', { name: 'Supprimer la colonne', exact: true }).click(); };
  await openDelete();
  await expect(page.getByRole('button', { name: 'Confirmer la suppression', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect((await read()).columns).toHaveLength(2);
  await openDelete();
  await page.getByRole('radio', { name: /Déplacer toutes les fiches/ }).check();
  await page.getByLabel('Colonne de destination', { exact: true }).selectOption(b.id);
  await page.getByRole('button', { name: 'Déplacer et supprimer la colonne', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Colonne À faire', exact: true })).toHaveCount(0);
  const target = page.getByRole('region', { name: 'Colonne En cours', exact: true });
  await expect(target.locator('.column-count')).toHaveText('2'); await expect(target.locator('.column-points')).toHaveText('8');
  const loaded = await read();
  expect(loaded.columns).toHaveLength(1);
  expect(loaded.columns[0].cards.map((c: { title: string }) => c.title)).toEqual(['Déjà présente', 'À conserver']);
  expect(loaded.columns[0].cards[1]).toMatchObject({ id: card.id, description: card.description, checklist: card.checklist, flags: card.flags, members: card.members, columnId: b.id });
  await request.delete(`/api/boards/${board.id}`);
});

test('mobile workspace navigation and confirmed deletion of the last populated column', async ({ page, request }) => {
  const { board, a, b, read } = await fixture(page, request);
  await request.delete(`/api/boards/${board.id}/columns/${b.id}`);
  await request.post(`/api/boards/${board.id}/columns/${a.id}/cards`, { data: { title: 'Fiche à supprimer', points: 5 } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ouvrir la navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Mon espace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mes tableaux', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: `Ouvrir le tableau ${board.title}`, exact: true }).click();
  await page.getByRole('button', { name: 'Options de À faire', exact: true }).click();
  await page.getByRole('button', { name: 'Supprimer la colonne', exact: true }).click();
  await expect(page.getByRole('radio', { name: /Déplacer toutes les fiches/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Confirmer la suppression', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: /Supprimer toutes les fiches/ }).check();
  const dialog = page.locator('dialog');
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Supprimer la colonne et ses fiches', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await read()).columns).toHaveLength(0);
  await request.delete(`/api/boards/${board.id}`);
});
