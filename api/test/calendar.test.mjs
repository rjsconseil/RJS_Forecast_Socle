// Module Calendrier : un seul moteur piloté par sa configuration (paramètre `calendrier.<id>` ou paramètres
// fournis à l'appel), lisant les seules données du user du contexte, sans écriture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSocle, camille, makeUser, operation, key, rejects, throwsCode } from './helpers.mjs';
import { alignToDay, nthDate, repeatDates } from '../src/modules/calendar/engine.mjs';

const WINDOW = { from: '2026-08-01', to: '2026-12-06' };
const recurrence = (socle, ctx, input) => socle.modules.budget.createRecurrence(ctx, { requestKey: key('rec'), costCenterRef: input.direction === 'income' ? 'std:salaires' : 'std:logement', label: 'Récurrence', ...input });

async function setup() {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const core = socle.modules.core;
  const project = (await core.createCoreProject(ctx, { requestKey: key('p'), title: 'Projet A', startDate: '2026-11-02', dueDate: '2026-11-20', priority: 'high' })).project;
  const task = (await core.createTask(ctx, { requestKey: key('t'), title: 'Tâche 1', projectId: project.id, startDate: '2026-11-05', dueDate: '2026-11-10', plannedHours: 3 })).task;
  return { socle, ctx, project, task, cal: socle.modules.calendar };
}

const setCalendar = (socle, id, value, expectedRevision = socle.modules.administration.parameter(`calendrier.${id}`).revision) =>
  socle.modules.administration.setParameter(`calendrier.${id}`, { value, expectedRevision });

test('calendrier : trois calendriers livrés, chacun réglé par son paramètre `calendrier.<id>`', async () => {
  const { socle, cal } = await setup();
  assert.deepEqual(cal.list().map((c) => [c.id, c.parameter, c.origin]), [
    ['noyau', 'calendrier.noyau', 'défaut du code'],
    ['budgetPatrimoine', 'calendrier.budgetPatrimoine', 'défaut du code'],
    ['patrimoine', 'calendrier.patrimoine', 'défaut du code'],
  ]);
  // Les valeurs livrées passent le contrôle des paramètres (natures connues, vocabulaire, entrées de survol).
  for (const c of cal.list()) assert.doesNotThrow(() => socle.parameters.validate(socle.state, c.parameter, socle.parameters.value(socle.state, c.parameter)));
  const catalog = cal.catalog();
  assert.ok(catalog.natures.some((n) => n.nature === 'task') && catalog.natures.some((n) => n.nature === 'capitalization'));
  assert.deepEqual(catalog.views, ['semaine', 'mois', 'annee']);
  await socle.close();
});

test('calendrier noyau : projets et tâches du user, entrées de survol, urgence et replanification décrites', async () => {
  const { socle, ctx, project, task, cal } = await setup();
  const r = cal.read(ctx, 'noyau', WINDOW);
  assert.deepEqual(r.display, { view: 'month', perCell: 2, perPeek: 4, peekCloseDelayMs: 260 });
  assert.deepEqual(r.indicators.map((i) => i.key), ['elements', 'dates', 'suivi']);
  assert.deepEqual(r.events.map((e) => [e.date, e.element, e.title]), [
    ['2026-11-02', 'projet-debut', 'Projet A'],
    ['2026-11-05', 'tache-prevue', 'Tâche 1'],
    ['2026-11-10', 'tache-echeance', 'Tâche 1'],
    ['2026-11-20', 'projet-echeance', 'Projet A'],
  ]);
  const due = r.events.find((e) => e.element === 'tache-echeance');
  assert.equal(due.urgent, 'soon');
  assert.equal(due.groupLabel, 'Projet A');
  assert.deepEqual(due.details, [
    { label: 'Statut', value: 'À faire' },
    { label: 'Projet', value: 'Projet A' },
    { label: 'Temps consommé', value: '0 h' },
  ]);
  assert.deepEqual(due.reschedule, { method: 'PUT', url: `/api/tasks/${task.id}`, field: 'dueDate' });
  assert.equal(due.revision, task.revision);
  const start = r.events.find((e) => e.element === 'projet-debut');
  assert.equal(start.statusLabel, '0/1 terminées · 0 %');
  assert.equal(start.link, `/projects/${project.id}`);
  assert.deepEqual(start.details.map((d) => d.value), ['20 nov. 2026', '0/1 terminées · 0 %', 'Haute']);
  await socle.close();
});

test('calendrier : seules les données du user du contexte sont lues, et la lecture n’écrit rien', async () => {
  const { socle, ctx, cal } = await setup();
  const other = await makeUser(socle, { label: 'Autre' });
  await socle.modules.core.createTask(other.ctx, { requestKey: key('t'), title: 'Tâche d’un autre', startDate: '2026-11-05' });
  const revision = socle.state.revision;
  assert.ok(!cal.read(ctx, 'noyau', WINDOW).events.some((e) => e.title === 'Tâche d’un autre'));
  assert.deepEqual(cal.read(other.ctx, 'noyau', WINDOW).events.map((e) => e.title), ['Tâche d’un autre']);
  cal.read(ctx, 'budgetPatrimoine', WINDOW);
  assert.equal(socle.state.revision, revision);
  await socle.close();
});

test('calendrier : le paramètre change les entrées de survol, les couleurs et l’affichage sans changer le code', async () => {
  const { socle, ctx, cal } = await setup();
  const config = structuredClone(socle.parameters.value(socle.state, 'calendrier.noyau'));
  const el = config.elements.find((e) => e.id === 'tache-prevue');
  el.couleur = 'violet';
  el.affiche = false;
  el.survol = [{ libelle: 'Description', champ: 'description', vide: 'Aucune description' }, { libelle: 'Échéance', champ: 'dueDate', format: 'date' }];
  config.elements = config.elements.filter((e) => e.id !== 'projet-echeance');
  config.vue = 'semaine';
  config.indicateurs = ['suivi'];
  await setCalendar(socle, 'noyau', config);
  const r = cal.read(ctx, 'noyau', WINDOW);
  assert.equal(r.display.view, 'week');
  assert.deepEqual(r.indicators.map((i) => i.key), ['suivi']);
  const element = r.elements.find((e) => e.id === 'tache-prevue');
  assert.deepEqual([element.tone, element.visible, element.hover], ['violet', false, ['Description', 'Échéance']]);
  assert.deepEqual(r.events.find((e) => e.element === 'tache-prevue').details, [
    { label: 'Description', value: 'Aucune description' },
    { label: 'Échéance', value: '10 nov. 2026' },
  ]);
  assert.ok(!r.events.some((e) => e.element === 'projet-echeance'));
  assert.equal(cal.list()[0].origin, 'administration');
  await socle.close();
});

test('calendrier : une configuration invalide est refusée avec son emplacement', async () => {
  const { socle } = await setup();
  const base = () => structuredClone(socle.parameters.value(socle.state, 'calendrier.noyau'));
  const cases = [
    [(c) => (c.elements[0].nature = 'inconnue'), /nature d'objet inconnue/],
    [(c) => (c.elements[0].couleur = 'fuchsia'), /couleur inconnue/],
    [(c) => (c.elements[1].id = c.elements[0].id), /figure deux fois/],
    [(c) => (c.elements[0].survol = [{ champ: 'title' }]), /a un libellé/],
    [(c) => (c.elements[0].survol = [{ libelle: 'X', champ: 'title', format: 'couleur' }]), /format inconnu/],
    [(c) => (c.elements[0].replanifier = { methode: 'DELETE', route: '/api/projects/{id}', champ: 'startDate' }), /replanifier/],
    [(c) => (c.elements[0].replanifier = { methode: 'PUT', route: 'http://ailleurs/{id}', champ: 'startDate' }), /replanifier/],
    [(c) => (c.indicateurs = ['meteo']), /Indicateur inconnu/],
    [(c) => (c.vue = 'jour'), /Vue attendue/],
    [(c) => (c.elements = []), /Au moins un élément/],
  ];
  for (const [change, message] of cases) {
    const c = base();
    change(c);
    const err = await rejects(() => setCalendar(socle, 'noyau', c), 'VALIDATION');
    assert.match(err.message, message);
  }
  await rejects(() => setCalendar(socle, 'noyau', ['pas', 'un', 'objet']), 'VALIDATION');
  assert.equal(socle.modules.administration.parameter('calendrier.noyau').origin, 'défaut du code');
  await socle.close();
});

test('calendrier Budget/Patrimoine : revenus réglés à leur date réelle, récurrences déroulées, période close remplacée par son versement', async () => {
  const { socle, ctx, cal } = await setup();
  await operation(socle, ctx, { direction: 'income', amount: 2500, date: '2026-11-01', realizedDate: '2026-11-02', label: 'Salaire' });
  await operation(socle, ctx, { direction: 'charge', amount: 80, date: '2026-11-15', status: 'planned', label: 'Électricité' });
  const rec = (await recurrence(socle, ctx, { direction: 'charge', label: 'Loyer', amount: 900, cadence: 'monthly', firstDate: '2026-09-05' })).recurrence;
  await socle.modules.budget.settleOccurrence(ctx, rec.id, { requestKey: key('s'), occurrenceDate: '2026-10-05', realizedDate: '2026-10-06', realizedAmount: 910 });
  await socle.modules.bpm.closePeriod(ctx, { requestKey: key('c'), periodKey: '2026-08' });
  const r = cal.read(ctx, 'budgetPatrimoine', WINDOW);
  const pick = (el) => r.events.filter((e) => e.element === el).map((e) => [e.date, e.title, e.amountCents, e.done]);
  assert.deepEqual(pick('revenu'), [['2026-11-02', 'Salaire', 250000, true]]);
  // L'occurrence d'octobre réglée devient une opération (à sa date réelle) ; les autres restent attendues.
  assert.deepEqual(pick('depense-recurrente').map((x) => x[0]), ['2026-09-05', '2026-11-05', '2026-12-05']);
  assert.deepEqual(pick('depense'), [['2026-10-06', 'Loyer', 91000, true], ['2026-11-15', 'Électricité', 8000, false]]);
  assert.deepEqual(pick('fin-periode').map((x) => x[0]), ['2026-09-30', '2026-10-31', '2026-11-30']);
  assert.deepEqual(pick('versement-patrimoine').map((x) => [x[0], x[1]]), [['2026-08-31', 'Résultat Août 2026']]);
  const planned = r.events.find((e) => e.title === 'Électricité');
  assert.equal(planned.direction, 'sortie');
  assert.ok(planned.reschedule?.url.startsWith('/api/bpm/operations/'));
  assert.equal(r.events.find((e) => e.title === 'Loyer' && e.element === 'depense').reschedule, null);
  assert.equal(r.events.find((e) => e.element === 'depense-recurrente').reschedule, null);
  assert.equal(r.events.find((e) => e.element === 'depense-recurrente').link, `/tableau-de-bord?ligne=${encodeURIComponent(rec.id + '@2026-09-05')}`);
  assert.deepEqual(planned.details.map((d) => d.label), ['Montant', 'Statut', 'Centre de coût', 'Budget']);
  // Les montants suivent le format français (espaces insécables) : comparés après normalisation des espaces.
  assert.deepEqual(planned.details.map((d) => d.value.replace(/[\u00a0\u202f]/g, ' ')).slice(0, 3), ['−80,00 €', 'À payer', 'Divers']);
  await socle.close();
});

test('calendrier : un appel peut fournir sa propre configuration (aperçu, autre module), contrôlée et sans écriture', async () => {
  const { socle, ctx, cal } = await setup();
  const configuration = {
    libelle: 'Mes échéances',
    vue: 'annee',
    indicateurs: ['dates'],
    elements: [{ id: 'echeances', libelle: 'Échéance', nature: 'task', date: 'dueDate', titre: '⚑ {title}', repere: 'echeance', couleur: 'rose', survol: [{ libelle: 'Heures', champ: 'plannedHours', format: 'heures' }] }],
  };
  const r = cal.preview(ctx, { configuration, ...WINDOW });
  assert.equal(r.display.view, 'year');
  assert.deepEqual(r.events.map((e) => [e.date, e.title, e.details[0].value]), [['2026-11-10', '⚑ Tâche 1', '3 h']]);
  throwsCode(() => cal.preview(ctx, { configuration: { ...configuration, elements: [{ ...configuration.elements[0], nature: 'secret' }] }, ...WINDOW }), 'VALIDATION');
  await socle.close();
});

test('calendrier : fenêtre et calendrier contrôlés, user requis', async () => {
  const { socle, ctx, cal } = await setup();
  throwsCode(() => cal.read(ctx, 'noyau', { from: '2026-11-01' }), 'VALIDATION');
  throwsCode(() => cal.read(ctx, 'noyau', { from: '2026-11-30', to: '2026-11-01' }), 'VALIDATION');
  throwsCode(() => cal.read(ctx, 'noyau', { from: '2026-01-01', to: '2027-12-31' }), 'VALIDATION');
  throwsCode(() => cal.read(ctx, 'agenda', WINDOW), 'NOT_FOUND');
  throwsCode(() => cal.read({}, 'noyau', WINDOW), 'CONTEXT_REQUIRED');
  await socle.close();
});

test('calendrier : répétitions — jour conservé et ramené à la fin du mois, ancrage et veille de l’occurrence suivante', () => {
  assert.equal(nthDate('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.equal(nthDate('2024-02-29', 'yearly', 1), '2025-02-28');
  assert.deepEqual(repeatDates({ first: '2026-09-05', cadence: 'monthly' }, '2026-10-01', '2026-12-31'), ['2026-10-05', '2026-11-05', '2026-12-05']);
  assert.deepEqual(repeatDates({ first: '2026-09-05', last: '2026-10-05', cadence: 'monthly' }, '2026-09-01', '2026-12-31'), ['2026-09-05', '2026-10-05']);
  assert.deepEqual(repeatDates({ first: '2026-11-02', cadence: 'weekly' }, '2026-11-01', '2026-11-20'), ['2026-11-02', '2026-11-09', '2026-11-16']);
  assert.equal(alignToDay('2026-08-15', 5), '2026-08-05');
  assert.equal(alignToDay('2026-01-03', 5), '2025-12-05');
  assert.deepEqual(repeatDates({ first: '2026-08-05', cadence: 'monthly', position: 'veilleSuivante' }, '2026-08-01', '2026-10-31'), ['2026-09-04', '2026-10-04']);
});
