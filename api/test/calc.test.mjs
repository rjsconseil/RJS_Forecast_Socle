// Moteur de calcul : langage de formule (analyse, évaluation, valeur inconnue) et métriques
// administrées (paramètre `metric.<clé>`, révision, aperçu, explication, objets sources).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parseFormula, referencesOf } from '../src/socle/calc/formula.mjs';
import { camille, key, makeSocle, operation, plain, rejects, throwsCode } from './helpers.mjs';

const calc = (src, vars = {}) =>
  evaluate(parseFormula(src), (name) => {
    if (!(name in vars)) throw new Error(`référence non attendue : ${name}`);
    return vars[name];
  });

// ---------- langage de formule ----------

test('formule : priorités, associativité à gauche, parenthèses', () => {
  assert.equal(calc('1 + 2 * 3'), 7);
  assert.equal(calc('(1 + 2) * 3'), 9);
  assert.equal(calc('10 - 4 - 3'), 3);
  assert.equal(calc('8 / 4 / 2'), 1);
  assert.equal(calc('2 + 3 > 4'), 1, 'la comparaison lie moins fort que l’addition');
  assert.equal(calc('1.5 * 2'), 3);
  assert.equal(calc('a.b + c', { 'a.b': 2, c: 5 }), 7);
});

test('formule : moins unaire', () => {
  assert.equal(calc('-3 + 5'), 2);
  assert.equal(calc('--2'), 2);
  assert.equal(calc('2 * -3'), -6);
  assert.equal(calc('-(1 + 2) * 2'), -6);
  assert.equal(calc('-x', { x: null }), null);
});

test('formule : fonctions', () => {
  assert.equal(calc('min(3, 1, 2)'), 1);
  assert.equal(calc('max(3, 1, 2)'), 3);
  assert.equal(calc('abs(-4)'), 4);
  assert.equal(calc('arrondi(3.14159, 2)'), 3.14);
  assert.equal(calc('arrondi(2.5)'), 3);
  assert.equal(calc('pourcentage(25, 200)'), 12.5);
  assert.equal(calc('pourcentage(1, 0)'), null, 'pourcentage d’un total nul : inconnu');
  assert.equal(calc('pourcentage(-50, 200)'), -25);
});

test('formule : si est paresseux, une condition inconnue rend inconnu', () => {
  const seen = [];
  const resolve = (n) => (seen.push(n), { a: 1, b: 10, c: 20 }[n]);
  assert.equal(evaluate(parseFormula('si(a > 0, b, c)'), resolve), 10);
  assert.deepEqual(seen, ['a', 'b'], 'la branche non retenue n’est pas évaluée');
  assert.equal(calc('si(a > 0, 1, x)', { a: -1, x: 7 }), 7);
  assert.equal(calc('si(a, 1, 2)', { a: null }), null);
  assert.equal(calc('si(a == 0, 5, x)', { a: 0 }), 5);
});

test('formule : siInconnu remplace explicitement une valeur inconnue', () => {
  assert.equal(calc('siInconnu(x, 0)', { x: null }), 0);
  assert.equal(calc('siInconnu(x, 0)', { x: 5 }), 5);
  assert.equal(calc('siInconnu(x, 0) + 1', { x: null }), 1);
  const seen = [];
  evaluate(parseFormula('siInconnu(x, y)'), (n) => (seen.push(n), 3));
  assert.deepEqual(seen, ['x'], 'la valeur de repli n’est évaluée que si nécessaire');
});

test('formule : une valeur inconnue se propage, jamais remplacée par 0', () => {
  assert.equal(calc('a + 1', { a: null }), null);
  assert.equal(calc('a * 0', { a: null }), null);
  assert.equal(calc('min(a, 2)', { a: null }), null);
  assert.equal(calc('a > 1', { a: null }), null);
  assert.equal(calc('abs(a)', { a: null }), null);
  assert.equal(calc('pourcentage(a, 10)', { a: null }), null);
});

test('formule : division par zéro → inconnu', () => {
  assert.equal(calc('1 / 0'), null);
  assert.equal(calc('a / (b - b)', { a: 3, b: 2 }), null);
  assert.equal(calc('0 / 5'), 0);
});

test('formule invalide : syntaxe, fonction inconnue, arité → FORMULA_INVALID', () => {
  for (const src of ['', '   ', '1 +', '(1 + 2', '1 2', '1 $ 2', 'a..b', ')', 'min(1,', '* 3', 'foo(1)', 'abs(1, 2)', 'si(1, 2)', 'pourcentage(1)', 'min()', 'siInconnu(1)']) {
    throwsCode(() => parseFormula(src), 'FORMULA_INVALID');
  }
  throwsCode(() => parseFormula(null), 'FORMULA_INVALID');
});

test('formule : referencesOf liste les références, sans les fonctions', () => {
  const refs = referencesOf(parseFormula('a.b + min(c, -d) * si(e > 1, f, 2) - siInconnu(a.b, 0)'));
  assert.deepEqual([...refs].sort(), ['a.b', 'c', 'd', 'e', 'f']);
  assert.deepEqual([...referencesOf(parseFormula('1 + 2'))], []);
});

// ---------- métriques administrées ----------

async function scenario() {
  const made = await makeSocle();
  const { socle } = made;
  const { ctx, bundle } = await camille(socle);
  const salaire = await operation(socle, ctx, { direction: 'income', label: 'Salaire', amount: 3000, date: '2026-11-01' });
  const loyer = await operation(socle, ctx, { direction: 'charge', label: 'Loyer', amount: 1000, date: '2026-11-02', costCenterRef: 'std:logement' });
  const courses = await operation(socle, ctx, { direction: 'charge', label: 'Courses', amount: 250, date: '2026-11-03', costCenterRef: 'std:alimentation' });
  await operation(socle, ctx, { direction: 'charge', label: 'Assurance', amount: 80, date: '2026-11-20', status: 'planned' });
  return { ...made, ctx, bundle, ids: { salaire: salaire.operation.id, loyer: loyer.operation.id, courses: courses.operation.id } };
}

const fig = (socle, ctx, k) => socle.modules.bpm.dashboard(ctx).figures[k];

test('métrique : explication substituée et objets sources des entrées', async () => {
  const { socle, ctx, ids } = await scenario();
  const r = fig(socle, ctx, 'bpm.resultatPeriode');
  assert.equal(r.value, 1750);
  assert.equal(r.status, 'ok');
  assert.equal(r.formula, 'bpm.revenus - bpm.charges');
  assert.equal(plain(r.explanation), '3 000 − 1 250 = 1 750');
  assert.deepEqual(r.parameter, { key: 'metric.bpm.resultatPeriode', revision: 0, origin: 'défaut du code', updatedAt: null, isDefault: true });
  assert.equal(r.period.key, '2026-11');
  const [rev, chg] = r.inputs;
  assert.equal(rev.type, 'metric');
  assert.equal(rev.name, 'bpm.revenus');
  assert.equal(rev.inputs[0].name, 'budget.revenusRealises');
  assert.deepEqual(rev.inputs[0].sources.map((s) => s.id), [ids.salaire]);
  assert.deepEqual(chg.inputs[0].sources.map((s) => s.id).sort(), [ids.loyer, ids.courses].sort());
  assert.ok(chg.inputs[0].sources.every((s) => s.kind === 'operation' && s.status === 'realized' && typeof s.amount === 'number' && s.date));
  const direct = socle.modules.bpm.figure(ctx, 'bpm.charges');
  assert.equal(direct.inputs[0].type, 'variable');
  assert.deepEqual(direct.inputs[0].sources.map((s) => s.amount).sort((a, b) => a - b), [250, 1000]);
  await rejects(async () => socle.modules.bpm.figure(ctx, 'bpm.inconnu'), 'NOT_FOUND');
});

test('métrique administrée : la nouvelle formule change la valeur, la révision et l’origine', async () => {
  const { socle, ctx } = await scenario();
  const admin = socle.modules.administration;
  const k = 'metric.bpm.resultatPeriode';
  const w = await admin.setParameter(k, { value: 'bpm.revenus - bpm.charges - 100', expectedRevision: 0, note: 'essai' });
  assert.equal(w.parameter.revision, 1);
  assert.equal(w.parameter.origin, 'administration');
  const r = fig(socle, ctx, 'bpm.resultatPeriode');
  assert.equal(r.value, 1650);
  assert.equal(r.formula, 'bpm.revenus - bpm.charges - 100');
  assert.equal(r.parameter.revision, 1);
  assert.equal(r.parameter.origin, 'administration');
  assert.equal(r.parameter.isDefault, false);
  // Les métriques dépendantes suivent.
  assert.equal(fig(socle, ctx, 'bpm.patrimoineFinPeriode').value, 12000 + 1650);
  assert.equal(admin.metric('bpm.resultatPeriode').parameter.history.length, 1);
  assert.deepEqual(admin.metric('bpm.resultatPeriode').references.sort(), ['bpm.charges', 'bpm.revenus']);
  const j = admin.journal(1)[0];
  assert.equal(j.command, 'setParameter');
  assert.deepEqual(j.updated, [k]);
});

test('métrique : version attendue 0 au premier enregistrement, puis STALE_VERSION', async () => {
  const { socle } = await scenario();
  const admin = socle.modules.administration;
  const k = 'metric.bpm.tauxEpargne';
  await rejects(admin.setParameter(k, { value: 'arrondi(pourcentage(bpm.resultatPeriode, bpm.revenus), 0)' }), 'VALIDATION');
  await rejects(admin.setParameter(k, { value: 'bpm.revenus', expectedRevision: 1 }), 'STALE_VERSION');
  await admin.setParameter(k, { value: 'arrondi(pourcentage(bpm.resultatPeriode, bpm.revenus), 0)', expectedRevision: 0 });
  const err = await rejects(admin.setParameter(k, { value: 'bpm.revenus', expectedRevision: 0 }), 'STALE_VERSION');
  assert.equal(err.details.currentRevision, 1);
  await admin.setParameter(k, { value: 'bpm.revenus', expectedRevision: 1 });
  assert.equal(admin.parameter(k).revision, 2);
  await rejects(() => admin.setParameter('metric.inconnue', { value: '1', expectedRevision: 0 }), 'NOT_FOUND');
});

test('métrique : référence inconnue et dépendance circulaire refusées sans écriture', async () => {
  const { socle } = await scenario();
  const admin = socle.modules.administration;
  const before = socle.state.revision;
  const unknown = await rejects(admin.setParameter('metric.bpm.resultatPeriode', { value: 'bpm.revenus - foo.bar', expectedRevision: 0 }), 'FORMULA_INVALID');
  assert.equal(unknown.details.reference, 'foo.bar');
  await rejects(admin.setParameter('metric.bpm.revenus', { value: 'bpm.resultatPeriode + 1', expectedRevision: 0 }), 'FORMULA_INVALID');
  await rejects(admin.setParameter('metric.bpm.revenus', { value: 'bpm.revenus * 2', expectedRevision: 0 }), 'FORMULA_INVALID');
  await rejects(admin.setParameter('metric.bpm.revenus', { value: 'budget.revenusRealises +', expectedRevision: 0 }), 'FORMULA_INVALID');
  await rejects(admin.setParameter('metric.bpm.revenus', { value: 42, expectedRevision: 0 }), 'VALIDATION');
  assert.equal(socle.state.revision, before);
  assert.equal(admin.parameter('metric.bpm.revenus').revision, 0);
});

test('métrique : retour au défaut du code', async () => {
  const { socle, ctx } = await scenario();
  const admin = socle.modules.administration;
  const k = 'metric.bpm.resultatPeriode';
  await admin.setParameter(k, { value: 'bpm.revenus', expectedRevision: 0 });
  assert.equal(fig(socle, ctx, 'bpm.resultatPeriode').value, 3000);
  await rejects(admin.resetParameter(k, { expectedRevision: 0 }), 'STALE_VERSION');
  const r = await admin.resetParameter(k, { expectedRevision: 1 });
  assert.equal(r.parameter.origin, 'défaut du code');
  assert.equal(r.parameter.revision, 2, 'la révision continue de croître');
  assert.equal(r.parameter.value, 'bpm.revenus - bpm.charges');
  const f = fig(socle, ctx, 'bpm.resultatPeriode');
  assert.equal(f.value, 1750);
  assert.equal(f.parameter.isDefault, true);
  assert.equal(f.parameter.revision, 2);
  const again = await admin.resetParameter(k, { expectedRevision: 2 });
  assert.equal(again.written, false, 'déjà au défaut : aucune écriture');
});

test('aperçu de formule : évalué sur les données du user, rien n’est enregistré', async () => {
  const { socle, ctx } = await scenario();
  const admin = socle.modules.administration;
  const before = JSON.stringify(socle.state);
  const p = admin.previewMetric(ctx, 'bpm.resultatPeriode', { formula: 'bpm.revenus - bpm.charges * 2' });
  assert.equal(p.current.value, 1750);
  assert.equal(p.preview.value, 500);
  assert.equal(p.preview.parameter.origin, 'aperçu non enregistré');
  assert.equal(p.preview.formula, 'bpm.revenus - bpm.charges * 2');
  assert.equal(JSON.stringify(socle.state), before);
  assert.equal(fig(socle, ctx, 'bpm.resultatPeriode').value, 1750);
  const past = admin.previewMetric(ctx, 'bpm.revenus', { formula: 'budget.revenusPrevus', periodKey: '2026-08' });
  assert.equal(past.preview.period.key, '2026-08');
  assert.equal(past.preview.value, 0);
  throwsCode(() => admin.previewMetric(ctx, 'bpm.revenus', { formula: 'bpm.resultatPeriode' }), 'FORMULA_INVALID');
  throwsCode(() => admin.previewMetric({ userId: null }, 'bpm.revenus', { formula: '1' }), 'CONTEXT_REQUIRED');
});

test('catalogue : métriques, variables et fonctions disponibles pour l’éditeur', async () => {
  const { socle } = await makeSocle();
  const cat = socle.modules.administration.metricCatalog();
  assert.ok(cat.metrics.some((m) => m.key === 'bpm.resultatPeriode' && m.defaultFormula === 'bpm.revenus - bpm.charges'));
  assert.ok(cat.references.some((r) => r.name === 'budget.revenusRealises' && r.type === 'variable'));
  assert.ok(cat.references.some((r) => r.name === 'patrimoine.stockOuverture' && r.type === 'variable'));
  assert.ok(cat.functions.includes('siInconnu'));
  // Les formules ne sont pas listées parmi les paramètres ordinaires.
  assert.ok(socle.modules.administration.parameters().every((p) => p.type !== 'formula'));
});

test('validation des paramètres : centres standards et tableau de bord', async () => {
  const { socle } = await makeSocle();
  const admin = socle.modules.administration;
  await rejects(admin.setParameter('budget.centresStandards', { value: [{ key: 'x', label: 'X', direction: 'sortie' }], expectedRevision: 0 }), 'VALIDATION');
  await rejects(admin.setParameter('budget.centresStandards', { value: [{ key: 'x', label: 'X', direction: 'income' }, { key: 'x', label: 'Y', direction: 'charge' }], expectedRevision: 0 }), 'VALIDATION');
  await rejects(admin.setParameter('budget.centresStandards', { value: 'salaires', expectedRevision: 0 }), 'VALIDATION');
  await rejects(admin.setParameter('bpm.tableauDeBord', { value: [{ id: 's', title: 'S', metrics: ['bpm.inexistant'] }], expectedRevision: 0 }), 'VALIDATION');
  await rejects(admin.setParameter('bpm.tableauDeBord', { value: [{ id: 's', title: 'S', metrics: [] }], expectedRevision: 0 }), 'VALIDATION');
  await rejects(admin.setParameter('users.types', { value: [{ key: 'Avec espace', label: 'x' }], expectedRevision: 0 }), 'VALIDATION');
  assert.equal(admin.parameter('budget.centresStandards').revision, 0);
  const ok = await admin.setParameter('budget.centresStandards', { value: [{ key: 'salaires', label: 'Salaires', direction: 'income' }, { key: 'divers', label: 'Divers', direction: 'charge' }], expectedRevision: 0 });
  assert.equal(ok.parameter.value.length, 2);
});

test('valeur inconnue : null avec la raison, jamais 0', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle, { openingStock: undefined });
  const f = socle.modules.bpm.dashboard(ctx).figures;
  assert.equal(f['bpm.patrimoineConstitue'].value, null);
  assert.equal(f['bpm.patrimoineConstitue'].status, 'unavailable');
  assert.match(f['bpm.patrimoineConstitue'].unavailableReason, /Stock d'ouverture non renseigné/);
  assert.match(f['bpm.patrimoineConstitue'].explanation, /inconnu/);
  // La raison remonte jusqu'à la donnée manquante à travers les métriques imbriquées.
  assert.match(f['bpm.patrimoineFinPeriode'].unavailableReason, /Stock d'ouverture/);
  assert.match(f['bpm.progressionObjectif'].unavailableReason, /Stock d'ouverture/);
  // Le résultat de la période reste connu (0, aucune opération) ; le taux est inconnu (division par 0).
  assert.equal(f['bpm.resultatPeriode'].value, 0);
  assert.equal(f['bpm.tauxEpargne'].value, null);
  assert.ok(f['bpm.tauxEpargne'].unavailableReason);
  // Remplacement explicite par la formule administrée.
  await socle.modules.administration.setParameter('metric.bpm.patrimoineConstitue', { value: 'siInconnu(patrimoine.stockOuverture, 0) + patrimoine.resultatsCapitalises', expectedRevision: 0 });
  assert.equal(socle.modules.bpm.dashboard(ctx).figures['bpm.patrimoineConstitue'].value, 0);
});
