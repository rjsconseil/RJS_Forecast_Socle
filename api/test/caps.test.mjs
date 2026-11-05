// Plafonds de dépenses : deux niveaux indépendants (centre de coût, catégorie personnalisée), jamais bloquants.
// Les catégories sont posées à la racine du middleware Budget (niveau 2) ; BPM (niveau 3) les lit et alerte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { camille, key, makeSocle, operation, rejects, TODAY } from './helpers.mjs';

const B = (socle) => socle.modules.budget;
const caps = (socle, ctx, period) => socle.modules.bpm.reads.spendingCaps(ctx, { period });
const category = (socle, ctx, input) => B(socle).createCategory(ctx, { requestKey: key('cat'), ...input }).then((r) => r.category);
/** Appel d'une route BPM comme le serveur HTTP (mêmes handlers). */
function route(socle, method, path) {
  const bpm = SOCLE_MODULES.find((m) => m.id === 'bpm');
  const r = bpm.routes(socle).find(([m, p]) => m === method && p === path);
  assert.ok(r, `${method} ${path}`);
  return r[2];
}
async function setCenterCaps(socle, ctx, capsInput) {
  const life = caps(socle, ctx).lifeBudget;
  await route(socle, 'PUT', '/api/bpm/caps')({ ctx, body: { requestKey: key('caps'), expectedRevision: life.revision, caps: capsInput } });
}

test('catégories : rangées dans un centre de charges, uniques par centre, retirables sans toucher aux dépenses', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const k = await category(socle, ctx, { label: 'Cinéma', costCenterRef: 'std:loisirs', cap: 40 });
  assert.deepEqual([k.label, k.costCenterRef, k.capCents, k.costCenterLabel, k.archived], ['Cinéma', 'std:loisirs', 4000, 'Loisirs', false]);
  await rejects(category(socle, ctx, { label: 'cinéma', costCenterRef: 'std:loisirs' }), 'UNIQUENESS_VIOLATION');
  await rejects(category(socle, ctx, { label: 'Prime', costCenterRef: 'std:salaires' }), 'INCOMPATIBLE_REFERENCE');
  await rejects(category(socle, ctx, { label: 'X', costCenterRef: 'std:inconnu' }), 'REFERENCE_NOT_FOUND');
  // Même libellé autorisé dans un autre centre ; plafond facultatif.
  const other = await category(socle, ctx, { label: 'Cinéma', costCenterRef: 'std:divers' });
  assert.equal(other.capCents, null);

  // La catégorie donne son centre à la dépense ; une catégorie d'un autre centre est refusée.
  const op = (await operation(socle, ctx, { direction: 'charge', label: 'Séance', amount: 12, date: '2026-11-02', costCenterRef: undefined, categoryId: k.id })).operation;
  assert.deepEqual([op.costCenterRef, op.categoryId, op.categoryLabel], ['std:loisirs', k.id, 'Cinéma']);
  await rejects(operation(socle, ctx, { direction: 'charge', amount: 5, date: '2026-11-02', costCenterRef: 'std:sante', categoryId: k.id }), 'INCOMPATIBLE_REFERENCE');
  await rejects(operation(socle, ctx, { direction: 'income', amount: 5, date: '2026-11-02', costCenterRef: 'std:salaires', categoryId: k.id }), 'INCOMPATIBLE_REFERENCE');

  // Changer de centre détache la catégorie devenue incohérente ; on peut la retirer explicitement.
  const moved = await B(socle).updateOperation(ctx, op.id, { requestKey: key('upd'), expectedRevision: op.revision, costCenterRef: 'std:divers' });
  assert.equal(moved.operation.categoryId, null);
  const back = await B(socle).updateOperation(ctx, op.id, { requestKey: key('upd'), expectedRevision: moved.operation.revision, costCenterRef: 'std:loisirs', categoryId: k.id });
  assert.equal(back.operation.categoryId, k.id);

  // Retirer : la catégorie quitte les choix, les dépenses gardent leur rangement ; on ne range plus rien dedans.
  const archived = (await B(socle).updateCategory(ctx, k.id, { requestKey: key('arch'), expectedRevision: k.revision, archived: true })).category;
  assert.equal(archived.archived, true);
  assert.ok(!B(socle).categories(ctx).some((x) => x.id === k.id));
  assert.equal(socle.state.operations[op.id].categoryId, k.id);
  await rejects(operation(socle, ctx, { direction: 'charge', amount: 5, date: '2026-11-02', costCenterRef: 'std:loisirs', categoryId: k.id }), 'FORBIDDEN_BY_RULE');

  // Contrôles Object Management du middleware : catégories et dépenses catégorisées cohérentes.
  const checks = socle.inspector.checks(socle.state);
  for (const rule of ['BUD-CAT-01', 'BUD-CAT-02']) assert.equal(checks.find((c) => c.rule === rule)?.result, 'passed', rule);
  // Une incohérence posée hors des commandes est détectée par le contrôle d'intégrité.
  socle.state.operations[op.id].standardCostCenter = 'sante';
  assert.equal(socle.inspector.checks(socle.state).find((c) => c.rule === 'BUD-CAT-02').result, 'failed');
  socle.state.operations[op.id].standardCostCenter = 'loisirs';
});

test('récurrence catégorisée : ses occurrences et leurs règlements restent dans la catégorie', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const k = await category(socle, ctx, { label: 'Streaming', costCenterRef: 'std:loisirs', cap: 20 });
  const rec = (await B(socle).createRecurrence(ctx, { requestKey: key('rec'), direction: 'charge', label: 'Abonnement vidéo', amount: 15, cadence: 'monthly', firstDate: '2026-11-05', categoryId: k.id })).recurrence;
  assert.deepEqual([rec.costCenterRef, rec.categoryId, rec.categoryLabel], ['std:loisirs', k.id, 'Streaming']);
  const settled = await B(socle).settleOccurrence(ctx, rec.id, { requestKey: key('settle'), occurrenceDate: '2026-11-05', realizedDate: '2026-11-03', realizedAmount: 15 });
  assert.equal(socle.state.operations[settled.operation.id].categoryId, k.id);
  const row = caps(socle, ctx).categories.find((x) => x.id === k.id);
  assert.deepEqual([row.paidCents, row.toPayCents, row.over], [1500, 0, false]);
});

test('plafonds : centre et catégorie lus indépendamment, dépassement signalé sans jamais bloquer', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await setCenterCaps(socle, ctx, { 'std:loisirs': 100 });
  const ciné = await category(socle, ctx, { label: 'Cinéma', costCenterRef: 'std:loisirs', cap: 30 });
  const sport = await category(socle, ctx, { label: 'Sport', costCenterRef: 'std:loisirs', cap: 200 });

  // 25 € de cinéma : rien n'est dépassé.
  let r = await route(socle, 'POST', '/api/bpm/operations')({ ctx, body: { requestKey: key('op'), direction: 'charge', label: 'Séance', amount: 25, date: '2026-11-02', status: 'realized', categoryId: ciné.id } });
  assert.deepEqual(r.capAlerts, []);

  // +10 € de cinéma : la catégorie dépasse (35 > 30), le centre non (35 ≤ 100) — la dépense est enregistrée.
  r = await route(socle, 'POST', '/api/bpm/operations')({ ctx, body: { requestKey: key('op'), direction: 'charge', label: 'Séance 2', amount: 10, date: '2026-11-03', status: 'realized', categoryId: ciné.id } });
  assert.ok(socle.state.operations[r.operation.id]);
  assert.deepEqual(r.capAlerts.map((a) => [a.level, a.label, a.overCents]), [['category', 'Cinéma', 500]]);

  // 80 € de sport prévus : le centre dépasse (115 > 100), la catégorie Sport non (80 ≤ 200).
  r = await route(socle, 'POST', '/api/bpm/operations')({ ctx, body: { requestKey: key('op'), direction: 'charge', label: 'Club', amount: 80, date: '2026-11-20', categoryId: sport.id } });
  assert.deepEqual(r.capAlerts.map((a) => [a.level, a.label, a.overCents]), [['center', 'Loisirs', 1500]]);

  const c = caps(socle, ctx);
  const loisirs = c.centers.find((x) => x.ref === 'std:loisirs');
  assert.deepEqual([loisirs.paidCents, loisirs.toPayCents, loisirs.engagedCents, loisirs.capCents, loisirs.marginCents, loisirs.over], [3500, 8000, 11500, 10000, -1500, true]);
  const byId = Object.fromEntries(c.categories.map((x) => [x.id, x]));
  assert.deepEqual([byId[ciné.id].engagedCents, byId[ciné.id].over, byId[sport.id].engagedCents, byId[sport.id].over], [3500, true, 8000, false]);
  assert.equal(c.overCount, 2);
  assert.deepEqual(c.alerts.map((a) => a.level).sort(), ['category', 'center']);

  // Sans plafond : jamais en dépassement ; un plafond relevé efface l'alerte.
  assert.equal(c.centers.find((x) => x.ref === 'std:sante').over, false);
  await B(socle).updateCategory(ctx, ciné.id, { requestKey: key('cap'), expectedRevision: ciné.revision, cap: 50 });
  assert.equal(caps(socle, ctx).categories.find((x) => x.id === ciné.id).over, false);

  // Une autre période ne voit que ses propres dépenses.
  const oct = caps(socle, ctx, '2026-10');
  assert.equal(oct.centers.find((x) => x.ref === 'std:loisirs').engagedCents, 0);

  // Les revenus ne déclenchent jamais d'alerte de plafond.
  r = await route(socle, 'POST', '/api/bpm/operations')({ ctx, body: { requestKey: key('op'), direction: 'income', label: 'Prime', amount: 500, date: '2026-11-02', costCenterRef: 'std:salaires' } });
  assert.deepEqual(r.capAlerts, []);
});

test('plafonds : les charges validées des projets comptent dans leur centre et leur catégorie', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const k = await category(socle, ctx, { label: 'Billets', costCenterRef: 'std:loisirs', cap: 100 });
  const p = await socle.modules.core.createCoreProject(ctx, { requestKey: key('prj'), title: 'Voyage' });
  const P = socle.modules.bpm.projects;
  const adopted = await P.adoptProject(ctx, { requestKey: key('adopt'), coreProjectId: p.project.id });
  await P.allocate(ctx, adopted.budgetId, { amount: 1000, expectedRevision: adopted.detail.budget.revision });
  await B(socle).createOperation(ctx, { requestKey: key('op'), budgetId: adopted.budgetId, direction: 'charge', label: 'Vols', categoryId: k.id, status: 'realized', date: TODAY, amount: 150 });
  const c = caps(socle, ctx);
  assert.equal(c.categories.find((x) => x.id === k.id).paidCents, 15000);
  assert.equal(c.categories.find((x) => x.id === k.id).over, true);
  assert.equal(c.centers.find((x) => x.ref === 'std:loisirs').paidCents, 15000);
});

test('registre et poste : filtre et regroupement par catégorie, état des plafonds de la période', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const R = socle.modules.bpm.reads;
  await setCenterCaps(socle, ctx, { 'std:loisirs': 50 });
  const ciné = await category(socle, ctx, { label: 'Cinéma', costCenterRef: 'std:loisirs', cap: 20 });
  await operation(socle, ctx, { direction: 'charge', label: 'Séance', amount: 25, date: '2026-11-02', costCenterRef: undefined, categoryId: ciné.id });
  await operation(socle, ctx, { direction: 'charge', label: 'Livre', amount: 10, date: '2026-11-03', costCenterRef: 'std:loisirs' });

  // Filtre : une catégorie, ou les dépenses sans catégorie ; la recherche lit aussi le nom de la catégorie.
  assert.deepEqual(R.register(ctx, { category: ciné.id }).lines.map((l) => l.label), ['Séance']);
  assert.ok(!R.register(ctx, { category: '__none__', direction: 'charge' }).lines.some((l) => l.categoryId));
  assert.deepEqual(R.register(ctx, { q: 'ciném' }).lines.map((l) => l.label), ['Séance']);

  // Regroupement par catégorie : « Sans catégorie » en dernier.
  const byCat = R.register(ctx, { direction: 'charge', groupBy: 'category' });
  assert.equal(byCat.groups[0].label, 'Cinéma');
  assert.equal(byCat.groups.at(-1).key, '__none__');

  // État des plafonds joint au registre de la période (budget du projet de vie) ; absent d'une fenêtre libre.
  assert.deepEqual([byCat.caps.categories[ciné.id].over, byCat.caps.centers['std:loisirs'].engagedCents, byCat.caps.centers['std:loisirs'].over], [true, 3500, false]);
  assert.equal(R.register(ctx, { from: '2026-11-01', to: '2026-11-30' }).caps, null);

  // Poste : plafond du centre et catégories du centre.
  const poste = R.centerDetail(ctx, 'loisirs', {});
  assert.deepEqual([poste.cap.capCents, poste.cap.engagedCents, poste.categories.map((k) => k.label)], [5000, 3500, ['Cinéma']]);
  assert.equal(R.centerDetail(ctx, 'salaires', {}).cap, null);

  // Plafond d'un seul centre (merge) : les autres plafonds restent.
  await setCenterCaps(socle, ctx, { 'std:loisirs': 50, 'std:sante': 80 });
  const life = caps(socle, ctx).lifeBudget;
  await route(socle, 'PUT', '/api/bpm/caps')({ ctx, body: { requestKey: key('caps'), expectedRevision: life.revision, merge: true, caps: { 'std:loisirs': null } } });
  assert.deepEqual(caps(socle, ctx).lifeBudget.capsCents, { 'std:sante': 8000 });
});

test('dépense rangée dans une catégorie retirée : elle se modifie sans perdre sa catégorie', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const k = await category(socle, ctx, { label: 'Presse', costCenterRef: 'std:loisirs' });
  const op = (await operation(socle, ctx, { direction: 'charge', label: 'Journal', amount: 3, date: '2026-11-02', costCenterRef: undefined, categoryId: k.id })).operation;
  await B(socle).updateCategory(ctx, k.id, { requestKey: key('arch'), expectedRevision: k.revision, archived: true });
  // L'éditeur renvoie la catégorie inchangée : acceptée ; une nouvelle affectation à une catégorie retirée reste refusée.
  const r = await B(socle).updateOperation(ctx, op.id, { requestKey: key('upd'), expectedRevision: op.revision, label: 'Journal du dimanche', categoryId: k.id });
  assert.deepEqual([r.operation.label, r.operation.categoryId], ['Journal du dimanche', k.id]);
  const other = (await operation(socle, ctx, { direction: 'charge', label: 'Magazine', amount: 4, date: '2026-11-02', costCenterRef: 'std:loisirs' })).operation;
  await rejects(B(socle).updateOperation(ctx, other.id, { requestKey: key('upd'), expectedRevision: other.revision, categoryId: k.id }), 'FORBIDDEN_BY_RULE');
});

test('catégories : libellé unique parmi les actives du centre, au renommage comme au rétablissement', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const ciné = await category(socle, ctx, { label: 'Cinéma', costCenterRef: 'std:loisirs', cap: 30 });
  const sport = await category(socle, ctx, { label: 'Sport', costCenterRef: 'std:loisirs' });
  await rejects(B(socle).updateCategory(ctx, sport.id, { requestKey: key('upd'), expectedRevision: sport.revision, label: 'cinéma' }), 'UNIQUENESS_VIOLATION');
  // Une catégorie retirée garde son plafond, modifiable ; son nom se réutilise, mais pas en double au rétablissement.
  const archived = (await B(socle).updateCategory(ctx, ciné.id, { requestKey: key('arch'), expectedRevision: ciné.revision, archived: true })).category;
  const uncapped = (await B(socle).updateCategory(ctx, ciné.id, { requestKey: key('cap'), expectedRevision: archived.revision, cap: null })).category;
  assert.deepEqual([uncapped.archived, uncapped.capCents], [true, null]);
  await category(socle, ctx, { label: 'Cinéma', costCenterRef: 'std:loisirs' });
  await rejects(B(socle).updateCategory(ctx, ciné.id, { requestKey: key('back'), expectedRevision: uncapped.revision, archived: false }), 'UNIQUENESS_VIOLATION');
});

test('revue des plafonds : les charges en cause, leur récurrence et leur antériorité, et le montant à compenser', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await setCenterCaps(socle, ctx, { 'std:alimentation': 100 });
  const k = await category(socle, ctx, { label: 'Cinéma', costCenterRef: 'std:loisirs', cap: 20 });
  const rec = (await B(socle).createRecurrence(ctx, { requestKey: key('rec'), direction: 'charge', label: 'Paniers bio', amount: 30, cadence: 'monthly', firstDate: '2026-09-04', costCenterRef: 'std:alimentation' })).recurrence;
  await operation(socle, ctx, { direction: 'charge', label: 'Courses', amount: 90, date: '2026-11-02', costCenterRef: 'std:alimentation' });
  await operation(socle, ctx, { direction: 'charge', label: 'Séance', amount: 35, date: '2026-11-02', costCenterRef: 'std:loisirs', categoryId: k.id });

  const review = await route(socle, 'GET', '/api/bpm/caps-review')({ ctx, query: new URLSearchParams() });
  const food = review.centers.find((c) => c.ref === 'std:alimentation');
  assert.equal(food.over, true);
  // La somme des charges listées est exactement l'engagé du poste ; les plus lourdes d'abord.
  assert.equal(food.chargeIds.reduce((t, id) => t + review.charges[id].engagedCents, 0), food.engagedCents);
  assert.equal(review.charges[food.chargeIds[0]].label, 'Courses');
  const panier = food.chargeIds.map((id) => review.charges[id]).find((c) => c.recurrenceId === rec.id);
  assert.deepEqual([panier.cadence, panier.rank, panier.sinceMonths, panier.perYearCents, panier.newThisPeriod], ['monthly', 3, 1, 36000, false]);
  const seance = review.charges[review.categories.find((x) => x.id === k.id).chargeIds[0]];
  assert.deepEqual([seance.cadence, seance.rank, seance.newThisPeriod], ['once', null, true]);
  // Poste plafonné : son dépassement ; poste sans plafond : celui de sa catégorie (Loisirs n'a pas de plafond).
  assert.equal(review.totals.toCompensateCents, (food.engagedCents - 10000) + 1500);
  assert.equal(review.totals.overCount, 2);
  assert.equal(typeof review.totals.expectedCents, 'number');
});
