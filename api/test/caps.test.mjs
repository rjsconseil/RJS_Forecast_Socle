// Plafonds de dépenses : un plafond par poste (centre de coût), jamais bloquant.
// Les catégories restent une possibilité du middleware Budget (niveau 2) ; BPM (niveau 3) ne les utilise plus
// depuis le 22 nov. 2026 : aucun plafond, alerte, filtre ni regroupement par catégorie dans ses lectures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { camille, key, makeSocle, operation, rejects, TODAY, firstTaskOf } from './helpers.mjs';
import { capLevelOf } from '../src/modules/budget/api.mjs';

const B = (socle) => socle.modules.budget;
const caps = (socle, ctx, period) => socle.modules.bpm.reads.spendingCaps(ctx, { period });
const category = (socle, ctx, input) => B(socle).createCategory(ctx, { requestKey: key('cat'), ...input }).then((r) => r.category);
/** Appel d'une route BPM comme le serveur HTTP (mêmes handlers). */
function route(socle, method, path) {
  const bpm = SOCLE_MODULES.find((m) => m.id === 'bpm');
  const r = socle.routesOf(bpm).find(([m, p]) => m === method && p === path);
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
  // L'état publié est gelé (P2) : l'incohérence est posée sur une copie.
  const tampered = structuredClone(socle.state);
  tampered.operations[op.id].standardCostCenter = 'sante';
  assert.equal(socle.inspector.checks(tampered).find((c) => c.rule === 'BUD-CAT-02').result, 'failed');
});

test('récurrence rangée dans une catégorie du middleware : BPM la compte dans son poste, sans lecture de catégorie', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const k = await category(socle, ctx, { label: 'Streaming', costCenterRef: 'std:loisirs', cap: 20 });
  const rec = (await B(socle).createRecurrence(ctx, { requestKey: key('rec'), direction: 'charge', label: 'Abonnement vidéo', amount: 15, cadence: 'monthly', firstDate: '2026-11-05', categoryId: k.id })).recurrence;
  assert.deepEqual([rec.costCenterRef, rec.categoryId], ['std:loisirs', k.id]);
  await B(socle).settleOccurrence(ctx, rec.id, { requestKey: key('settle'), occurrenceDate: '2026-11-05', realizedDate: '2026-11-03', realizedAmount: 15 });
  const c = caps(socle, ctx);
  assert.equal('categories' in c, false);
  const row = c.centers.find((x) => x.ref === 'std:loisirs');
  assert.deepEqual([row.paidCents, row.toPayCents, row.capCents], [1500, 0, null]);
});

test('plafonds : un plafond par poste, dépassement signalé sans jamais bloquer ; une catégorie plafonnée ne déclenche rien', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await setCenterCaps(socle, ctx, { 'std:loisirs': 100 });
  const ciné = await category(socle, ctx, { label: 'Cinéma', costCenterRef: 'std:loisirs', cap: 30 });

  // 35 € de cinéma : la catégorie du middleware dépasserait (35 > 30), mais BPM ne lit que le poste (35 ≤ 100).
  let r = await route(socle, 'POST', '/api/bpm/operations')({ ctx, body: { requestKey: key('op'), direction: 'charge', label: 'Séances', amount: 35, date: '2026-11-02', status: 'realized', categoryId: ciné.id } });
  assert.deepEqual(r.capAlerts, []);

  // 80 € prévus : le poste dépasse (115 > 100) — la dépense est enregistrée, l'alerte la signale.
  r = await route(socle, 'POST', '/api/bpm/operations')({ ctx, body: { requestKey: key('op'), direction: 'charge', label: 'Club', amount: 80, date: '2026-11-20', costCenterRef: 'std:loisirs' } });
  assert.ok(socle.state.operations[r.operation.id]);
  assert.deepEqual(r.capAlerts.map((a) => [a.level, a.label, a.overCents]), [['center', 'Loisirs', 1500]]);

  const c = caps(socle, ctx);
  const loisirs = c.centers.find((x) => x.ref === 'std:loisirs');
  assert.deepEqual([loisirs.paidCents, loisirs.toPayCents, loisirs.engagedCents, loisirs.capCents, loisirs.marginCents, loisirs.over], [3500, 8000, 11500, 10000, -1500, true]);
  assert.equal(c.overCount, 1);
  assert.deepEqual(c.alerts.map((a) => a.level), ['center']);
  // Tous les postes de dépense sont listés, avec ou sans plafond ; aucun poste de revenu.
  assert.ok(c.centers.length > 5);
  assert.ok(c.centers.every((x) => !x.ref.startsWith('std:salaires')));

  // Sans plafond : jamais en dépassement ; un plafond relevé efface l'alerte.
  assert.equal(c.centers.find((x) => x.ref === 'std:sante').over, false);
  await setCenterCaps(socle, ctx, { 'std:loisirs': 200 });
  assert.equal(caps(socle, ctx).centers.find((x) => x.ref === 'std:loisirs').over, false);

  // Une autre période ne voit que ses propres dépenses.
  const oct = caps(socle, ctx, '2026-10');
  assert.equal(oct.centers.find((x) => x.ref === 'std:loisirs').engagedCents, 0);

  // Les revenus ne déclenchent jamais d'alerte de plafond.
  r = await route(socle, 'POST', '/api/bpm/operations')({ ctx, body: { requestKey: key('op'), direction: 'income', label: 'Prime', amount: 500, date: '2026-11-02', costCenterRef: 'std:salaires' } });
  assert.deepEqual(r.capAlerts, []);

  // Les routes de catégories de BPM n'existent plus.
  const bpm = SOCLE_MODULES.find((m) => m.id === 'bpm');
  assert.ok(!socle.routesOf(bpm).some(([, p]) => p.startsWith('/api/bpm/categories')));
});

test('niveaux de consommation : Budget, seule source des seuils (50, 75, 90 %) ; « proche du plafond » à partir de 90 %', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const refs = ['std:loisirs', 'std:sante', 'std:transport', 'std:alimentation', 'std:logement', 'std:divers'];
  await setCenterCaps(socle, ctx, Object.fromEntries(refs.map((ref) => [ref, 100])));
  // 49 %, 50 %, 89 %, 90 %, 100 %, 101 % consommés.
  const amounts = [49, 50, 89, 90, 100, 101];
  for (const [i, ref] of refs.entries()) await operation(socle, ctx, { direction: 'charge', label: 'Dépense', amount: amounts[i], date: '2026-11-02', costCenterRef: ref });
  const c = caps(socle, ctx);
  const row = (ref) => c.centers.find((x) => x.ref === ref);
  assert.deepEqual(c.levels, { mid: 50, high: 75, near: 90 });
  assert.deepEqual(refs.map((ref) => row(ref).level), ['low', 'mid', 'high', 'near', 'near', 'over']);
  assert.deepEqual(refs.map((ref) => row(ref).near), [false, false, false, true, true, false]);
  assert.equal(capLevelOf(null, 5000), 'none');
  // Le registre et le détail du poste portent le même niveau et les mêmes seuils.
  const R = socle.modules.bpm.reads;
  const brief = R.register(ctx, { direction: 'charge' }).caps;
  assert.deepEqual([brief.centers['std:transport'].level, brief.levels], ['high', c.levels]);
  const poste = R.centerDetail(ctx, 'alimentation', {});
  assert.deepEqual([poste.cap.level, poste.levels], ['near', c.levels]);
});

test('plafonds : les charges validées des projets comptent dans leur poste', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await setCenterCaps(socle, ctx, { 'std:loisirs': 100 });
  const p = await socle.modules.core.createCoreProject(ctx, { requestKey: key('prj'), title: 'Voyage' });
  await socle.modules.core.createTask(ctx, { requestKey: key('tsk'), title: 'Vols', projectId: p.project.id });
  const P = socle.modules.bpm.projects;
  const adopted = await P.adoptProject(ctx, { requestKey: key('adopt'), coreProjectId: p.project.id });
  await P.allocate(ctx, adopted.budgetId, { amount: 1000, expectedRevision: adopted.detail.budget.revision });
  await B(socle).createOperation(ctx, { requestKey: key('op'), budgetId: adopted.budgetId, taskId: firstTaskOf(socle, adopted.budgetId), direction: 'charge', label: 'Vols', costCenterRef: 'std:loisirs', status: 'realized', date: TODAY, amount: 150 });
  const loisirs = caps(socle, ctx).centers.find((x) => x.ref === 'std:loisirs');
  assert.deepEqual([loisirs.paidCents, loisirs.over], [15000, true]);
});

test('registre et poste : regroupement par poste, état des plafonds de la période, aucun filtre par catégorie', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const R = socle.modules.bpm.reads;
  await setCenterCaps(socle, ctx, { 'std:loisirs': 50 });
  const ciné = await category(socle, ctx, { label: 'Cinéma', costCenterRef: 'std:loisirs', cap: 20 });
  await operation(socle, ctx, { direction: 'charge', label: 'Séance', amount: 25, date: '2026-11-02', costCenterRef: undefined, categoryId: ciné.id });
  await operation(socle, ctx, { direction: 'charge', label: 'Livre', amount: 10, date: '2026-11-03', costCenterRef: 'std:loisirs' });

  // Le registre ne filtre ni ne regroupe par catégorie, et sa recherche ne lit pas leur nom.
  assert.equal(R.register(ctx, { category: ciné.id, direction: 'charge' }).lines.length, 2);
  assert.equal(R.register(ctx, { q: 'ciném' }).lines.length, 0);
  assert.throws(() => R.register(ctx, { groupBy: 'category' }), /groupBy/);
  const byCenter = R.register(ctx, { direction: 'charge' });
  assert.equal('category' in byCenter.filters, false);

  // État des plafonds joint au registre de la période (budget du projet de vie), poste par poste ; absent d'une fenêtre libre.
  assert.deepEqual(Object.keys(byCenter.caps).sort(), ['centers', 'levels', 'overCount']);
  assert.deepEqual([byCenter.caps.centers['std:loisirs'].engagedCents, byCenter.caps.centers['std:loisirs'].over], [3500, false]);
  assert.equal(R.register(ctx, { from: '2026-11-01', to: '2026-11-30' }).caps, null);

  // Poste : son plafond, sans catégories.
  const poste = R.centerDetail(ctx, 'loisirs', {});
  assert.deepEqual([poste.cap.capCents, poste.cap.engagedCents, 'categories' in poste], [5000, 3500, false]);
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
  await setCenterCaps(socle, ctx, { 'std:alimentation': 100, 'std:loisirs': 20 });
  const rec = (await B(socle).createRecurrence(ctx, { requestKey: key('rec'), direction: 'charge', label: 'Paniers bio', amount: 30, cadence: 'monthly', firstDate: '2026-09-04', costCenterRef: 'std:alimentation' })).recurrence;
  await operation(socle, ctx, { direction: 'charge', label: 'Courses', amount: 90, date: '2026-11-02', costCenterRef: 'std:alimentation' });
  await operation(socle, ctx, { direction: 'charge', label: 'Séance', amount: 35, date: '2026-11-02', costCenterRef: 'std:loisirs' });

  const review = await route(socle, 'GET', '/api/bpm/caps-review')({ ctx, query: new URLSearchParams() });
  const food = review.centers.find((c) => c.ref === 'std:alimentation');
  assert.equal(food.over, true);
  // La somme des charges listées est exactement l'engagé du poste ; les plus lourdes d'abord.
  assert.equal(food.chargeIds.reduce((t, id) => t + review.charges[id].engagedCents, 0), food.engagedCents);
  assert.equal(review.charges[food.chargeIds[0]].label, 'Courses');
  const panier = food.chargeIds.map((id) => review.charges[id]).find((c) => c.recurrenceId === rec.id);
  assert.deepEqual([panier.cadence, panier.rank, panier.sinceMonths, panier.perYearCents, panier.newThisPeriod], ['monthly', 3, 1, 36000, false]);
  const seance = review.charges[review.centers.find((x) => x.ref === 'std:loisirs').chargeIds[0]];
  assert.deepEqual([seance.cadence, seance.rank, seance.newThisPeriod], ['once', null, true]);
  // À compenser : la somme des dépassements des postes plafonnés.
  assert.equal('categories' in review, false);
  assert.equal(review.totals.toCompensateCents, (food.engagedCents - 10000) + 1500);
  assert.equal(review.totals.overCount, 2);
  assert.equal(typeof review.totals.expectedCents, 'number');
});

test('aperçu plafonds : alerte du poste avant écriture et aucune mutation', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await setCenterCaps(socle, ctx, { 'std:loisirs': 30 });
  await operation(socle, ctx, { direction: 'charge', amount: 25, date: TODAY, costCenterRef: 'std:loisirs' });
  const input = { direction: 'charge', amount: 10, date: TODAY, costCenterRef: 'std:loisirs' };
  const snapshot = JSON.stringify(socle.state);
  const p = socle.modules.bpm.reads.previewCaps(ctx, input);
  assert.deepEqual(Object.keys(p.after), ['center']);
  assert.equal(p.before.center.engagedCents, 2500);
  assert.equal(p.after.center.engagedCents, 3500);
  assert.equal(p.after.center.marginCents, -500);
  assert.deepEqual(p.alerts.map(a => [a.level, a.overCents]), [['center', 500]]);
  assert.equal(JSON.stringify(socle.state), snapshot);
  const saved = await route(socle, 'POST', '/api/bpm/operations')({ ctx, body: { ...input, label: 'Séance', requestKey: key('op') } });
  assert.deepEqual(saved.capAlerts, p.alerts);
});

test('aperçu plafonds : remplacement sans double comptage et récurrence sans modifier les règlements', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await setCenterCaps(socle, ctx, { 'std:loisirs': 100 });
  const op = (await operation(socle, ctx, { direction: 'charge', amount: 80, date: '2026-11-20', status: 'planned', costCenterRef: 'std:loisirs' })).operation;
  const p = socle.modules.bpm.reads.previewCaps(ctx, { replaceId: op.id, direction: 'charge', amount: 90, date: '2026-11-20', costCenterRef: 'std:loisirs' });
  assert.equal(p.after.center.engagedCents, 9000);
  assert.equal(p.alerts.length, 0);
  const rec = (await B(socle).createRecurrence(ctx, { requestKey: key('rec'), direction: 'charge', label: 'Hebdomadaire', amount: 10, cadence: 'weekly', firstDate: '2026-11-02', costCenterRef: 'std:loisirs' })).recurrence;
  await B(socle).settleOccurrence(ctx, rec.id, { requestKey: key('settle'), occurrenceDate: '2026-11-02', realizedDate: TODAY, realizedAmount: 10 });
  const input = { replaceId: rec.id, direction: 'charge', amount: 20, cadence: 'weekly', firstDate: '2026-11-02', costCenterRef: 'std:loisirs' };
  const rp = socle.modules.bpm.reads.previewCaps(ctx, input);
  assert.equal(rp.after.center.paidCents, 1000);
  assert.equal(rp.after.center.toPayCents, 16000); // 80 ponctuels + quatre échéances de 20
  await B(socle).updateRecurrence(ctx, rec.id, { requestKey: key('edit'), expectedRevision: rec.revision, amount: 20 });
  assert.equal(caps(socle, ctx).centers.find(c => c.ref === 'std:loisirs').engagedCents, rp.after.center.engagedCents);
});

test('aperçu plafonds : période de la dépense, futur et cycle décalé', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle, { anchorDay: 15 });
  await setCenterCaps(socle, ctx, { 'std:loisirs': 50 });
  await operation(socle, ctx, { direction: 'charge', amount: 40, date: '2026-10-20', costCenterRef: 'std:loisirs' });
  const preview = amount => socle.modules.bpm.reads.previewCaps(ctx, { direction: 'charge', amount, date: '2026-11-10', costCenterRef: 'std:loisirs' });
  assert.equal(preview(20).period.key, '2026-10');
  assert.equal(preview(20).alerts[0].overCents, 1000);
  assert.equal(preview(10).alerts.length, 0); // égalité autorisée
  const future = socle.modules.bpm.reads.previewCaps(ctx, { direction: 'charge', amount: 60, date: '2027-01-16', costCenterRef: 'std:loisirs' });
  assert.equal(future.period.key, '2027-01');
  assert.equal(future.after.center.engagedCents, 6000);
  const income = socle.modules.bpm.reads.previewCaps(ctx, { direction: 'income', amount: 60, date: '2026-11-10', costCenterRef: 'std:salaires' });
  assert.equal(income.alerts.length, 0);
});

test('revue plafonds : chaque charge contribue une seule fois à son poste', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await setCenterCaps(socle, ctx, { 'std:loisirs': 100, 'std:sante': 50 });
  const k = await category(socle, ctx, { label: 'Cinéma', costCenterRef: 'std:loisirs', cap: 30 });
  await operation(socle, ctx, { direction: 'charge', amount: 120, date: TODAY, categoryId: k.id, costCenterRef: 'std:loisirs' });
  const review = socle.modules.bpm.reads.capsReview(ctx);
  assert.equal(review.totals.overCount, 1);
  assert.equal(review.totals.toCompensateCents, 2000);
  assert.equal(review.totals.headroomCents, 5000);
  for (const row of review.centers) {
    assert.equal(new Set(row.chargeIds).size, row.chargeIds.length);
    assert.equal(row.chargeIds.reduce((s, id) => s + review.charges[id].engagedCents, 0), row.engagedCents);
  }
});

test('aperçu paiement : remplace le prévu par le réel, occurrence comprise, sans doubler la charge', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await setCenterCaps(socle, ctx, { 'std:loisirs': 30 });
  const rec = (await B(socle).createRecurrence(ctx, { requestKey: key('rec'), direction: 'charge', label: 'Cinéma', amount: 20, cadence: 'monthly', firstDate: '2026-11-02', costCenterRef: 'std:loisirs' })).recurrence;
  const input = { direction: 'charge', amount: 20, date: '2026-11-02', costCenterRef: 'std:loisirs', settle: true, recurrenceId: rec.id, occurrenceDate: '2026-11-02', realizedDate: TODAY, realizedAmount: 35 };
  const snapshot = JSON.stringify(socle.state);
  const p = socle.modules.bpm.reads.previewCaps(ctx, input);
  assert.equal(p.after.center.paidCents, 3500);
  assert.equal(p.after.center.toPayCents, 0);
  assert.equal(p.alerts[0].overCents, 500);
  assert.equal(JSON.stringify(socle.state), snapshot);
  const saved = await B(socle).settleOccurrence(ctx, rec.id, { requestKey: key('settle'), occurrenceDate: input.occurrenceDate, realizedDate: TODAY, realizedAmount: 35 });
  assert.equal(caps(socle, ctx).centers.find(c => c.ref === 'std:loisirs').engagedCents, p.after.center.engagedCents);
  assert.ok(saved.operation.id);
});

test('aperçu : refuse de lire un budget ou une opération appartenant à un autre user', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const other = await camille(socle, { label: 'Autre' });
  const op = (await operation(socle, other.ctx, { direction: 'charge', amount: 20, date: TODAY })).operation;
  assert.throws(() => socle.modules.bpm.reads.previewCaps(ctx, { direction: 'charge', amount: 20, date: TODAY, replaceId: op.id }));
  assert.throws(() => socle.modules.bpm.reads.previewCaps(ctx, { direction: 'charge', amount: 20, date: TODAY, budgetId: op.budgetId }));
});
