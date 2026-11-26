// Calendrier comme module branchable : natures fournies par un module (BPM), sources d'autres calendriers
// branchées par la personne, formats d'affichage livrés et ajoutés, et Météo lue dans le calendrier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, camille, key, makeSocle, operation } from './helpers.mjs';

const WINDOW = { from: '2026-10-26', to: '2026-12-06' };
const P = (s) => s.modules.bpm.projects;
const setCalendar = (socle, id, value) =>
  socle.modules.administration.setParameter(`calendrier.${id}`, { value, expectedRevision: socle.modules.administration.parameter(`calendrier.${id}`).revision });

async function setup() {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await at('2026-11-02', () => operation(socle, ctx, { direction: 'income', label: 'Salaire', amount: 2000, date: '2026-11-02' }));
  const p = await P(socle).createProject(ctx, { requestKey: key(), title: 'Cuisine', amount: 800 });
  const t = await P(socle).createTask(ctx, { requestKey: key(), title: 'Pose', projectId: p.coreProjectId, startDate: '2026-11-12', dueDate: '2026-11-20' });
  return { socle, ctx, cal: socle.modules.calendar, project: p, task: t.task };
}

test('natures fournies : BPM donne ses règlements, ses tâches et ses rendez-vous au calendrier, qui ne dépend pas de lui', async () => {
  const { socle, ctx, cal, task } = await setup();
  const provided = cal.catalog().natures.filter((n) => n.provided).map((n) => [n.nature, n.module]);
  assert.deepEqual(provided, [['bpmReglement', 'bpm'], ['bpmTache', 'bpm'], ['bpmRendezVous', 'bpm']]);
  assert.ok(!socle.registry.modules.get('calendar').dependsOn.includes('bpm'), 'sens unique : le calendrier ignore BPM');
  const r = cal.read(ctx, 'budgetPatrimoine', WINDOW);
  const due = r.events.find((e) => e.element === 'tache-echeance');
  assert.deepEqual([due.date, due.title, due.groupLabel, due.link], ['2026-11-20', 'Pose', 'Cuisine', `/bpm-astra/projets/${task.projectId}?task=${task.id}`]);
  assert.deepEqual(due.reschedule, { method: 'PUT', url: `/api/tasks/${task.id}`, field: 'dueDate' });
  assert.ok(r.events.some((e) => e.element === 'revenu' && e.title === 'Salaire' && e.link.startsWith('/bpm-astra/mouvements?ligne=')));
  // Une source proposée (`branche: false`) n'est pas lue : elle attend dans la bibliothèque.
  assert.ok(!r.events.some((e) => e.element === 'tache-prevue'));
  assert.ok(r.library.some((s) => s.id === 'tache-prevue' && s.origin === null));
  await socle.close();
});

test('branchement : la page hôte décide des calendriers proposés, la personne choisit ses sources', async () => {
  const { socle, ctx, cal } = await setup();
  assert.ok(!cal.read(ctx, 'budgetPatrimoine', WINDOW).library.some((s) => s.origin), 'sans offre de la page : aucune source d’un autre calendrier');
  assert.throws(() => cal.read(ctx, 'budgetPatrimoine', { ...WINDOW, offre: 'inconnu' }), /Calendrier proposé inconnu/);
  const base = cal.read(ctx, 'budgetPatrimoine', { ...WINDOW, offre: 'noyau,patrimoine' });
  assert.equal(base.plugged, null, 'sans choix : la configuration décide');
  const foreign = base.library.find((s) => s.id === 'noyau.tache-prevue');
  assert.deepEqual(foreign.origin, { calendar: 'noyau', label: 'Calendrier du noyau' });
  const ids = [...base.elements.map((e) => e.id).filter((id) => id !== 'revenu'), 'tache-prevue', 'noyau.tache-prevue'];
  const r = cal.read(ctx, 'budgetPatrimoine', { ...WINDOW, offre: 'noyau', sources: ids.join(',') });
  assert.ok(!r.elements.some((e) => e.id === 'revenu'), 'une source débranchée n’est plus lue');
  assert.ok(r.library.some((s) => s.id === 'revenu'), '… et revient dans la bibliothèque');
  assert.deepEqual(r.events.filter((e) => e.element === 'tache-prevue').map((e) => e.date), ['2026-11-12']);
  assert.deepEqual(r.events.filter((e) => e.element === 'noyau.tache-prevue').map((e) => [e.date, e.title]), [['2026-11-12', 'Pose']]);
  assert.deepEqual(r.elements.find((e) => e.id === 'noyau.tache-prevue').origin, foreign.origin);
  assert.ok(!r.plugged.includes('inconnue'));
  assert.deepEqual(cal.read(ctx, 'budgetPatrimoine', { ...WINDOW, sources: 'inconnue' }).elements, []);
  await socle.close();
});

test('formats d’affichage : trois livrés, ceux de la configuration appelés de la même façon, vocabulaire contrôlé', async () => {
  const { socle, ctx, cal } = await setup();
  const r = cal.read(ctx, 'budgetPatrimoine', WINDOW);
  assert.deepEqual(r.formats.map((f) => [f.id, f.layout, f.builtIn]), [['standard', 'ligne', true], ['compact', 'pastille', true], ['detaille', 'deux-lignes', true], ['montants', 'ligne', false]]);
  assert.equal(r.display.format, 'standard');
  const config = structuredClone(socle.parameters.value(socle.state, 'calendrier.noyau'));
  await setCalendar(socle, 'noyau', { ...config, formats: [{ id: 'echeances', libelle: 'Échéances', disposition: 'pastille', champs: ['status'] }], format: 'echeances' });
  const noyau = cal.read(ctx, 'noyau', WINDOW);
  assert.equal(noyau.display.format, 'echeances');
  assert.deepEqual(noyau.formats.at(-1), { id: 'echeances', label: 'Échéances', layout: 'pastille', fields: ['status'], perCell: null, builtIn: false });
  for (const [change, message] of [
    [{ formats: [{ id: 'standard', libelle: 'X', disposition: 'ligne', champs: [] }] }, /existe déjà/],
    [{ formats: [{ id: 'x', libelle: 'X', disposition: 'grille', champs: [] }] }, /disposition/],
    [{ formats: [{ id: 'x', libelle: 'X', disposition: 'ligne', champs: ['amount', 'amount'] }] }, /champs/],
    [{ format: 'inconnu' }, /format inconnu/],
  ]) assert.throws(() => socle.parameters.validate(socle.state, 'calendrier.noyau', { ...config, ...change }), message);
  await socle.close();
});

test('Météo : ses prévisions sont les événements du calendrier, une source retirée du calendrier quitte la Météo', async () => {
  const { socle, ctx, cal } = await setup();
  const meteo = () => socle.modules.bpm.meteo.report(ctx).forecast;
  const tasks = (f) => f.items.filter((x) => x.kind === 'tache').map((x) => [x.date, x.label, x.detail]);
  assert.deepEqual(tasks(meteo()), [['2026-11-20', 'Pose', 'Projet « Cuisine »']]);
  const config = structuredClone(socle.parameters.value(socle.state, 'calendrier.budgetPatrimoine'));
  config.elements.find((e) => e.id === 'tache-echeance').disponible = false;
  await setCalendar(socle, 'budgetPatrimoine', config);
  assert.deepEqual(tasks(meteo()), [], 'la Météo ne recalcule aucune date : elle lit le calendrier');
  assert.ok(!cal.read(ctx, 'budgetPatrimoine', WINDOW).events.some((e) => e.element === 'tache-echeance'));
  await socle.close();
});

test('préférences par profil : sources branchées, affichage et formats suivent la personne, côté serveur', async () => {
  const { socle, ctx, cal } = await setup();
  const other = (await import('./helpers.mjs')).makeUser;
  await cal.savePreferences(ctx, 'budgetPatrimoine', { plugged: ['revenu', 'noyau.tache-prevue'], display: { format: 'perso-mien', sources: { revenu: true }, perCell: 3, includeDone: false, indicators: ['flux'] } });
  await cal.saveFormats(ctx, { formats: [{ id: 'perso-mien', label: 'Le mien', layout: 'pastille', fields: ['status'], perCell: 5 }] });
  const r = cal.read(ctx, 'budgetPatrimoine', { ...WINDOW, offre: 'noyau' });
  assert.deepEqual(r.elements.map((e) => e.id), ['revenu', 'noyau.tache-prevue'], 'les sources enregistrées sont lues sans les redemander');
  assert.deepEqual(r.preferences.display, { format: 'perso-mien', sources: { revenu: true }, perCell: 3, includeDone: false, indicators: ['flux'] });
  assert.deepEqual(r.formats.at(-1), { id: 'perso-mien', label: 'Le mien', layout: 'pastille', fields: ['status'], perCell: 5, builtIn: false, own: true });
  // Les formats valent pour tous ses calendriers ; un autre profil ne voit rien de tout cela.
  assert.ok(cal.read(ctx, 'noyau', WINDOW).formats.some((f) => f.id === 'perso-mien'));
  const someone = await other(socle, { label: 'Autre' });
  assert.ok(!cal.read(someone.ctx, 'noyau', WINDOW).formats.some((f) => f.id === 'perso-mien'));
  assert.equal(cal.read(someone.ctx, 'budgetPatrimoine', WINDOW).preferences.display, null);
  // Revenir au défaut, et refus des valeurs mal formées.
  await cal.savePreferences(ctx, 'budgetPatrimoine', { plugged: null, display: null });
  assert.equal(cal.read(ctx, 'budgetPatrimoine', WINDOW).plugged, null);
  for (const bad of [{ display: { perCell: 12 } }, { display: { indicators: ['meteo'] } }, { plugged: 'revenu' }, {}]) {
    await assert.rejects(() => cal.savePreferences(ctx, 'budgetPatrimoine', bad), /display|plugged|perCell|indicateurs/);
  }
  await assert.rejects(() => cal.saveFormats(ctx, { formats: [{ id: 'standard', label: 'X', layout: 'ligne', fields: [] }] }), /perso/);
  await socle.close();
});

test('contrat des natures fournies : champs déclarés, configuration et objets rendus contrôlés', async () => {
  const { socle, ctx, cal } = await setup();
  const provided = cal.catalog().natures.find((n) => n.nature === 'bpmTache');
  assert.equal(provided.fields.dueDate, 'date');
  const config = structuredClone(socle.parameters.value(socle.state, 'calendrier.budgetPatrimoine'));
  config.elements.find((e) => e.id === 'tache-echeance').titre = '{title} · {secret}';
  assert.throws(() => socle.parameters.validate(socle.state, 'calendrier.budgetPatrimoine', config), /champ\(s\) non fourni\(s\) par « bpmTache » : secret/);
  const { validateProvidedNature, checkProvidedObjects } = await import('../src/modules/calendar/engine.mjs');
  assert.throws(() => validateProvidedNature('x', { label: 'X', read: () => [] }), /fields/);
  assert.throws(() => validateProvidedNature('x', { label: 'X', read: () => [], fields: { id: 'texte' } }), /identifiant/);
  assert.throws(() => checkProvidedObjects('x', { fields: { id: 'identifiant', d: 'date' } }, [{ id: 'a', d: '20/11/2026' }]), /AAAA-MM-JJ/);
  assert.throws(() => checkProvidedObjects('x', { fields: { id: 'identifiant' } }, [{ titre: 'sans id' }]), /identifiant/);
  assert.ok(cal.read(ctx, 'budgetPatrimoine', WINDOW).events.length > 0);
  await socle.close();
});

test('les autres modules lisent le calendrier de référence : échéances et Météo ignorent les choix personnels', async () => {
  const { socle, ctx, cal } = await setup();
  await operation(socle, ctx, { direction: 'charge', label: 'Plombier', amount: 120, date: '2026-11-06', status: 'planned', costCenterRef: 'std:logement' });
  const due = () => socle.modules.bpm.life.lifeManagement(ctx, {}).dueSoon.lines.map((l) => l.label);
  const before = due();
  assert.ok(before.includes('Plombier'));
  // La personne débranche les dépenses de son calendrier : sa lecture change, pas celle des autres modules.
  await cal.savePreferences(ctx, 'budgetPatrimoine', { plugged: ['revenu', 'tache-echeance'] });
  assert.ok(!cal.read(ctx, 'budgetPatrimoine', WINDOW).events.some((e) => e.title === 'Plombier'));
  assert.deepEqual(due(), before);
  assert.ok(socle.modules.bpm.meteo.report(ctx).forecast.items.some((x) => x.label === 'Plombier'));
  // Une période plus longue que la fenêtre maximale est lue par tranches, sans perte ni doublon.
  const all = cal.events(ctx, 'budgetPatrimoine', { from: '2026-01-01', to: '2027-06-30' });
  assert.equal(new Set(all.map((e) => e.key)).size, all.length);
  assert.ok(all.some((e) => e.title === 'Plombier'));
  await socle.close();
});

test('présentation : design et effet d’ouverture administrés, choix et réglages de la personne enregistrés', async () => {
  const { socle, ctx, cal } = await setup();
  const config = structuredClone(socle.parameters.value(socle.state, 'calendrier.noyau'));
  await setCalendar(socle, 'noyau', { ...config, design: 'horizon', effet: 'fondu-fluide' });
  const r = cal.read(ctx, 'noyau', WINDOW);
  assert.deepEqual([r.display.design, r.display.effect, r.interaction.controls.appearance], ['horizon', 'fondu-fluide', true]);
  await cal.savePreferences(ctx, 'noyau', { display: { design: 'mon-site', effect: 'fondu-fluide', effectParams: { enterMs: 450, leaveMs: 120 } } });
  assert.deepEqual(cal.read(ctx, 'noyau', WINDOW).preferences.display, { design: 'mon-site', effect: 'fondu-fluide', effectParams: { enterMs: 450, leaveMs: 120 } });
  for (const bad of [{ design: 'Pas Bon' }, { effectParams: { enterMs: -1 } }, { effectParams: { 'en-tree': 10 } }]) {
    await assert.rejects(() => cal.savePreferences(ctx, 'noyau', { display: bad }), /design|effectParams/);
  }
  assert.throws(() => socle.parameters.validate(socle.state, 'calendrier.noyau', { ...config, effet: 'Fondu Fluide' }), /effet/);
  await socle.close();
});
