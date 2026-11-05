import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFile } from 'node:fs/promises';

async function fixture(page: Page, request: APIRequestContext) {
  const project = await (await request.post('/api/boards', { data: { title: `Projet ADR ${crypto.randomUUID().slice(0, 8)}` } })).json();
  const column = await (await request.post(`/api/boards/${project.id}/columns`, { data: { title: 'À faire' } })).json();
  const card = await (await request.post(`/api/boards/${project.id}/columns/${column.id}/cards`, { data: { title: 'Mettre en œuvre le choix', points: 5 } })).json();
  await page.addInitScript(id => localStorage.setItem('mkanban.board', id), project.id);
  const read = async () => (await request.get(`/api/boards/${project.id}`)).json();
  const create = async (data: Record<string, unknown>) => {
    const response = await request.post(`/api/boards/${project.id}/decisions`, { data });
    expect(response.ok()).toBeTruthy(); return response.json();
  };
  return { project, card, column, read, create };
}
const accepted = { status: 'accepted', outcome: 'Un fichier JSON par projet', rationale: 'Simple à déployer et à sauvegarder.' };
async function openJournal(page: Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Décisions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Journal des décisions', exact: true })).toBeVisible();
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Enregistrer la décision', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
}

test('decision journal creates, documents, links, adopts and replaces decisions with revision history', async ({ page, request }) => {
  const { project, card, read, create } = await fixture(page, request);
  await openJournal(page);
  await expect(page).toHaveTitle('mkAgile — Faites place aux idées');
  await page.getByRole('button', { name: 'Créer une décision', exact: true }).click();
  await page.getByLabel('Titre de la décision', { exact: true }).fill('Stockage du projet');
  await page.getByLabel('Type', { exact: true }).selectOption('technical');
  await page.getByLabel('Contexte', { exact: true }).fill('## Besoin local\n\n**Sauvegarder** simplement.');
  await page.getByLabel('Alternatives', { exact: true }).fill('SQLite ou fichiers JSON.');
  await page.getByLabel('Décision retenue', { exact: true }).fill('Un fichier JSON par projet.');
  await page.getByLabel('Justification', { exact: true }).fill('Facile à déployer.');
  await page.getByLabel('Conséquences', { exact: true }).fill('Écritures atomiques et verrouillées.');
  await page.getByLabel('Étiquettes (séparées par des virgules)').fill('Architecture, MVP');
  await page.getByRole('group', { name: 'Fiches Kanban liées', exact: true }).getByRole('checkbox').check();
  await page.getByLabel('Adresse du document', { exact: true }).fill('https://example.org/specification');
  await page.getByLabel('Nom du document (facultatif)', { exact: true }).fill('Spécification');
  await page.getByRole('button', { name: 'Ajouter le document', exact: true }).click();
  await page.getByRole('button', { name: 'Aperçu', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Besoin local', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Créer la décision', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  const bubble = page.locator('.decision-bubble').first();
  await expect(bubble).toContainText('ADR-001'); await expect(bubble).toContainText('Brouillon');
  await expect(bubble).toContainText('MVP'); await expect(bubble.getByRole('link', { name: 'Spécification' })).toHaveAttribute('href', 'https://example.org/specification');
  let current = await read(); const id = current.decisions[0].id;
  expect(current.decisions[0].links[0].target).toBe(card.id);
  for (const status of ['discussing', 'proposed', 'accepted']) {
    await bubble.getByRole('button', { name: /^Ouvrir ADR-001/ }).click();
    await page.getByLabel('État', { exact: true }).selectOption(status);
    if (status === 'accepted') await expect(page.getByText('En enregistrant cet état, vous adoptez', { exact: false })).toBeVisible();
    await save(page);
  }
  await expect(bubble).toContainText('Référence officielle');
  await bubble.getByRole('button', { name: /^Mettre en œuvre le choix/ }).click();
  await expect(page.getByLabel('Titre de la carte', { exact: true })).toHaveValue('Mettre en œuvre le choix');
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  expect((await read()).columns[0].cards[0].completed).toBe(false);
  const successor = await create({ title: 'Stockage version suivante', ...accepted });
  await page.reload(); await page.getByRole('tab', { name: 'Décisions', exact: true }).click();
  await page.getByRole('button', { name: /^Ouvrir ADR-001/ }).click();
  await page.getByLabel('État', { exact: true }).selectOption('superseded');
  await page.getByLabel('Décision qui remplace celle-ci').selectOption(successor.id);
  await save(page);
  const original = page.locator('.decision-bubble').filter({ has: page.getByRole('button', { name: /^Ouvrir ADR-001/ }) });
  await expect(original).toHaveClass(/decision-gray/); await expect(original).toContainText('Historique');
  await original.getByRole('button', { name: /^Remplacée par ADR-002/ }).click();
  await expect(page.getByLabel('Titre de la décision', { exact: true })).toHaveValue('Stockage version suivante');
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await original.getByRole('button', { name: /^Ouvrir ADR-001/ }).click();
  const history = page.locator('.decision-history');
  await history.getByText('Création · v1', { exact: true }).click();
  await expect(history.locator('details[open]')).toContainText('Besoin local');
  await expect(history.locator('details[open]')).toContainText('Brouillon');
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  current = await read(); expect(current.decisions.find((d: { id: string }) => d.id === id).history).toHaveLength(5);
  const raw = JSON.parse(await readFile(`test-results/boards/${project.id}.json`, 'utf8'));
  expect(raw.decisions[0].supersededBy).toBe(successor.id); expect(raw.pointHistory.at(-1).total).toBe(5);
});

test('decision filters combine states, types, UTC dates, tags, text and linked cards', async ({ page, request }) => {
  const { card, create } = await fixture(page, request);
  await create({ title: 'Architecture JSON', type: 'technical', tags: ['MVP'], links: [{ kind: 'card', target: card.id }], ...accepted });
  await create({ title: 'Navigation par projets', type: 'functional', status: 'proposed', context: 'Vue générale' });
  await create({ title: 'Ancienne proposition', type: 'organization', status: 'rejected' });
  await openJournal(page);
  await expect(page.locator('.decision-bubble')).toHaveCount(3);
  await page.getByLabel('Type de décision', { exact: true }).selectOption('technical');
  await page.getByLabel('État de la décision', { exact: true }).selectOption('accepted');
  await page.getByRole('button', { name: 'Dates et autres filtres', exact: true }).click();
  await page.getByLabel('Étiquette de décision', { exact: true }).selectOption('MVP');
  await page.getByLabel('Fiche liée', { exact: true }).selectOption(card.id);
  await page.getByLabel('Rechercher des décisions', { exact: true }).fill('ADR-001');
  await page.getByLabel('Du (UTC)', { exact: true }).fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel('Au (UTC)', { exact: true }).fill(new Date().toISOString().slice(0, 10));
  await expect(page.locator('.decision-bubble')).toHaveCount(1);
  await expect(page.locator('.decision-bubble')).toHaveClass(/decision-green/);
  await page.getByLabel('Au (UTC)', { exact: true }).fill('2020-01-01');
  await expect(page.getByRole('alert')).toContainText('La date de début');
  await page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true }).click();
  await page.getByRole('button', { name: /^Rejetée/ }).click();
  await expect(page.locator('.decision-bubble')).toHaveCount(1); await expect(page.locator('.decision-bubble')).toHaveClass(/decision-red/);
  await page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true }).click();
  await page.getByLabel('Trier les décisions', { exact: true }).selectOption('number');
  await expect(page.locator('.decision-bubble').first()).toContainText('ADR-001');
  await page.getByLabel('Rechercher des décisions', { exact: true }).fill('Introuvable');
  await expect(page.getByRole('heading', { name: 'Aucune décision ne correspond' })).toBeVisible();
});

test('MCP decisions refresh live, stale edits and deletion are protected, deleted history remains readable', async ({ page, request }) => {
  const { project, read, create } = await fixture(page, request);
  const initial = await create({ title: 'Choix concurrent', status: 'discussing', context: 'Version initiale' });
  await openJournal(page);
  const client = new Client({ name: 'decision-browser-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3100/mcp')));
  try {
    await client.callTool({ name: 'create_decision', arguments: { boardId: project.id, title: 'Créée par IA', type: 'functional' } });
    await expect(page.locator('.decision-bubble')).toHaveCount(2, { timeout: 8000 });
    await page.getByRole('button', { name: /^Ouvrir ADR-001/ }).click();
    await page.getByLabel('Contexte', { exact: true }).fill('Brouillon local');
    await client.callTool({ name: 'update_decision', arguments: { boardId: project.id, decisionId: initial.id, context: 'Version IA' } });
    await page.getByRole('button', { name: 'Enregistrer la décision', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Cette décision a changé');
    expect((await read()).decisions[0].context).toBe('Version IA');
    await page.getByRole('button', { name: 'Supprimer la décision', exact: true }).click();
    await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Cette décision a changé');
    expect((await read()).decisions[0].deletedAt).toBeNull();
    await page.getByRole('button', { name: 'Fermer', exact: true }).click();
    // Refresh the project before opening a new draft.
    await page.getByRole('button', { name: 'Déplier le contenu ADR-001', exact: true }).click();
    await expect.poll(async () => page.locator('.decision-bubble').filter({ hasText: 'Version IA' }).count(), { timeout: 8000 }).toBe(1);
    await page.getByRole('button', { name: /^Ouvrir ADR-001/ }).click();
    await expect(page.getByLabel('Contexte', { exact: true })).toHaveValue('Version IA');
    await page.getByRole('button', { name: 'Supprimer la décision', exact: true }).click();
    await page.getByRole('button', { name: 'Annuler', exact: true }).last().click();
    await expect(page.locator('dialog')).toHaveCount(1);
    await page.getByRole('button', { name: 'Supprimer la décision', exact: true }).click();
    await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(page.locator('dialog')).toHaveCount(0);
    await expect(page.locator('.decision-bubble')).toHaveCount(1);
    await page.getByRole('button', { name: 'Dates et autres filtres', exact: true }).click();
    await page.getByLabel('Afficher', { exact: true }).selectOption('only');
    await page.getByRole('button', { name: /^Ouvrir ADR-001/ }).click();
    await expect(page.getByLabel('Titre de la décision', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Enregistrer la décision', exact: true })).toHaveCount(0);
    await expect(page.locator('.decision-history')).toContainText('Suppression du journal courant');
    await page.getByRole('button', { name: 'Fermer', exact: true }).first().click();
    await page.getByRole('button', { name: 'Nouvelle décision', exact: true }).click();
    await page.getByLabel('Titre de la décision', { exact: true }).fill('Numéro conservé');
    await page.getByRole('button', { name: 'Créer la décision', exact: true }).click();
    await expect(page.locator('dialog')).toHaveCount(0);
    expect((await read()).decisions.at(-1).number).toBe(3);
  } finally { await client.close(); }
});

test('mobile journal and long editor support keyboard navigation and keep actions inside the viewport', async ({ page, request }) => {
  const { create } = await fixture(page, request);
  await create({ title: 'Décision avec un titre suffisamment long pour passer sur plusieurs lignes', context: Array.from({ length: 80 }, (_, i) => `Paragraphe ${i + 1}\n\n`).join(''), ...accepted });
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/');
  await page.getByRole('tab', { name: /^Kanban/ }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Relations', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Décisions', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Décisions', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /^Ouvrir ADR-001/ }).click();
  await page.getByRole('button', { name: 'Aperçu', exact: true }).click();
  const body = page.locator('.decision-editor-body');
  await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const saveButton = page.getByRole('button', { name: 'Enregistrer la décision', exact: true });
  await expect(saveButton).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Fermer', exact: true })).toBeInViewport();
  expect(await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollTop === 0)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toHaveCount(0);
});

test('decision bubbles expand complete Markdown, retain live content and collapse independently on mobile', async ({ page, request }) => {
  const { project, create } = await fixture(page, request);
  const context = `## Le contexte détaillé\n\n**Texte formaté**\n\n${Array.from({ length: 35 }, (_, i) => `Paragraphe ${i + 1} : une explication complète.\n\n`).join('')}Dernière ligne du contexte.`;
  const first = await create({ title: 'Décision longue', context, alternatives: '- Option A\n- Option B', outcome: '```ts\nconst choix = "JSON";\n```', rationale: '**Justification complète**', consequences: 'Dernière conséquence à conserver.' });
  await create({ title: 'Autre décision', context: 'Un autre contexte intégral.' });
  await openJournal(page);
  const bubble = page.locator('.decision-bubble').filter({ hasText: 'Décision longue' });
  await expect(bubble).toContainText('ADR-001'); await expect(bubble).toContainText('Brouillon');
  await expect(page.getByRole('region', { name: 'Contenu complet ADR-001', exact: true })).toBeHidden();
  await bubble.getByRole('button', { name: 'Déplier le contenu ADR-001', exact: true }).click();
  const full = page.getByRole('region', { name: 'Contenu complet ADR-001', exact: true });
  await expect(full.getByRole('heading', { name: 'Le contexte détaillé', exact: true })).toBeVisible();
  await expect(full.locator('strong').first()).toHaveText('Texte formaté');
  await expect(full.getByText('Dernière ligne du contexte.', { exact: true })).toBeVisible();
  await expect(full.getByText('Dernière conséquence à conserver.', { exact: true })).toBeVisible();
  await expect(full.locator('pre code')).toContainText('const choix = "JSON";');
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Déplier le contenu ADR-002', exact: true }).click();
  await expect(full).toBeVisible();
  await request.patch(`/api/boards/${project.id}/decisions/${first.id}`, { data: { consequences: '**Conséquence actualisée**' } });
  await expect(full.locator('strong').last()).toHaveText('Conséquence actualisée', { timeout: 8000 });
  await page.setViewportSize({ width: 390, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const collapse = bubble.getByRole('button', { name: 'Replier le contenu ADR-001', exact: true });
  await collapse.focus(); await page.keyboard.press('Enter');
  await expect(full).toBeHidden(); await expect(bubble).toContainText('Décision longue');
  await expect(page.getByRole('region', { name: 'Contenu complet ADR-002', exact: true })).toBeVisible();
  await bubble.getByRole('button', { name: /^Ouvrir ADR-001/ }).click();
  await expect(page.getByLabel('Contexte', { exact: true })).toHaveValue(context);
});
