import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BpmApi } from '../data/bpm-api.service';
import { ClosingActions, ClosingChecks, ClosingJourney, ClosingPoint } from '../data/bpm-closing.models';
import { BpmClosingPage } from './closing.page';

/** Un point du cycle tel que le rend le serveur. */
const point = (id: string, label: string, over: Partial<ClosingPoint> = {}): ClosingPoint => ({
  id, lineId: id, kind: 'line', group: 'charges', blocking: false, lineKind: 'occurrence', operationId: null, recurrenceId: `rec_${id}`, occurrenceDate: '2026-11-07', revision: null,
  label, detail: 'Alimentation', direction: 'charge', plannedDate: '2026-11-07', plannedCents: 35000, realizedDate: null, realizedCents: null,
  costCenterLabel: 'Alimentation', cadenceLabel: 'Mensuelle', project: null, status: 'late', statusLabel: 'En retard', state: 'open',
  openedOn: '2026-11-01', closedAt: null, closedOn: null, outcome: null, outcomeLabel: null, inheritedFrom: null, deferTo: null, ...over,
});
const account = (over: Partial<ClosingPoint> = {}) => point('account', 'Vérification du compte', {
  kind: 'account', group: 'account', blocking: true, lineId: null, lineKind: undefined, recurrenceId: null, plannedDate: undefined, plannedCents: undefined, direction: undefined,
  detail: null, status: 'late', statusLabel: 'À vérifier', openedOn: '2026-12-01', ...over,
});
const targets = [{ key: '2026-12', label: 'Décembre 2026', start: '2026-12-01' }, { key: '2027-01', label: 'Janvier 2027', start: '2027-01-01' }, { key: '2027-02', label: 'Février 2027', start: '2027-02-01' }];

/** Actions du cycle : une catégorie détaillée par le journal, une reconstituée depuis les données. */
const actions: ClosingActions = {
  total: 3, entries: 2, lastAt: '2026-11-22T14:35:00.000Z', firstAt: '2026-11-05T09:00:00.000Z',
  source: { journalFrom: '2026-11-06T12:55:35.651Z', complete: false },
  categories: [
    { key: 'daily', label: 'Argent du quotidien', part: 'quotidien', text: 'Dépenses et entrées du budget du projet de vie.', count: 2, entries: 1, realizedCents: -35000, lastAt: '2026-11-22T14:35:00.000Z', items: [
      { category: 'daily', command: 'settleOccurrence', verb: 'Échéance réglée', label: 'Alimentation', detail: 'Alimentation · payée le 7 nov. 2026', at: '2026-11-22T14:35:00.000Z', firstAt: '2026-11-22T14:30:00.000Z', count: 2, source: 'journal', objectId: 'op_1', amountCents: 35000, direction: 'charge', effect: 'realized', target: { kind: 'line', id: 'op_1', coreProjectId: null } },
    ] },
    { key: 'caps', label: 'Plafonds et postes', part: 'quotidien', text: 'Plafonds des postes.', count: 1, entries: 1, realizedCents: 0, lastAt: '2026-11-05T09:00:00.000Z', items: [
      { category: 'caps', command: 'setCaps', verb: 'Plafonds des postes fixés', label: 'Plafonds des postes', detail: '3 postes plafonnés', at: '2026-11-05T09:00:00.000Z', firstAt: '2026-11-05T09:00:00.000Z', count: 1, source: 'objects', objectId: 'bud_1', amountCents: null, direction: null, effect: 'setting', target: { kind: 'caps' } },
    ] },
  ],
};
/** Contrôles de cohérence : un bloquant (avec sa résolution), un bon, un à voir. */
const checks: ClosingChecks = {
  items: [
    {
      key: 'points', level: 'blocking', label: 'Points du cycle traités', state: 'fail', value: '3 / 5', text: '2 points ouverts.', target: 'closing-path-title',
      resolution: {
        problem: '2 points restent ouverts.', why: 'Chaque évènement du cycle doit être réglé, écarté ou reporté.',
        steps: [{ text: 'Validez chaque point ouvert dans « À valider ».', target: { kind: 'section', id: 'closing-path-title' } }, { text: 'Comparez avec la banque.', target: { kind: 'reconciliation' } }],
        progress: { done: 3, total: 5 },
      },
      items: [{ id: 'alim', label: 'Alimentation', detail: 'En retard', amountCents: -35000, target: { kind: 'line', id: 'alim', coreProjectId: null, page: 'echeances' } }],
    },
    { key: 'integrity', level: 'blocking', label: 'Données intègres', state: 'ok', value: 'Aucune anomalie', text: 'Références cohérentes.', items: [], target: null },
    {
      key: 'caps', level: 'warning', label: 'Plafonds respectés', state: 'warn', value: '1 poste au-delà', text: 'Dépassement constaté.', target: null,
      resolution: { problem: '1 poste dépasse son plafond.', why: 'Un dépassement entame l’épargne.', steps: [{ text: 'Relevez le plafond du poste.', target: { kind: 'page', path: 'plafonds' } }], progress: { done: 2, total: 3 } },
      items: [{ id: 'std:alimentation', label: 'Alimentation', detail: '789,50 € engagés pour 770,00 €', amountCents: -1950, target: { kind: 'center', ref: 'std:alimentation' } }],
    },
  ],
  ok: 1, warn: 1, fail: 1, later: 0, total: 3, blocking: ['Points du cycle traités'],
};

/** Lecture du parcours : clôture de novembre ouverte, une charge, une décision et le compte restant à traiter. */
const journey = (over: Partial<ClosingJourney> = {}): ClosingJourney => ({
  context: { user: { id: 'usr_test', label: 'Camille', userType: 'individual' }, scope: 'principal', scopeLabel: '', budgets: [], period: null, calculationDate: '2026-12-02', revision: 1, unit: 'centimes (EUR)' } as never,
  phase: 'to_close',
  period: { key: '2026-11', label: 'Novembre 2026', start: '2026-11-01', end: '2026-11-30', status: 'ended' },
  next: { key: '2026-12', label: 'Décembre 2026', start: '2026-12-01', end: '2026-12-31' },
  opensOn: '2026-12-01',
  days: { total: 30, elapsed: 30, left: 0 },
  backlog: 1,
  lock: { enabled: true, active: true, from: '2026-12-01', message: 'Novembre 2026 est terminé et attend sa clôture : Décembre 2026 démarrera à sa clôture.' },
  closingMode: { active: true, message: 'Novembre 2026 est en clôture : ses points sont figés.' },
  percent: 50, done: 3, total: 6,
  counts: { total: 6, open: 3, closed: 3, deferred: 0, later: 0, inherited: 0 },
  criteria: [
    { key: 'income', label: 'Entrées reçues', done: 1, total: 1, state: 'done', remaining: null },
    { key: 'charges', label: 'Charges réglées', done: 2, total: 3, state: 'todo', remaining: '1 charge à régler ou décider' },
    { key: 'projects', label: 'Flux des projets imputés au cycle', done: 0, total: 0, state: 'none', remaining: null },
    { key: 'decisions', label: 'Décisions de financement', done: 0, total: 1, state: 'todo', remaining: '1 décision à prendre ou reporter' },
    { key: 'account', label: 'Compte vérifié', done: 0, total: 1, state: 'todo', remaining: 'compte à vérifier' },
  ],
  points: [
    point('alim', 'Alimentation'),
    point('overrun:ovr_1', 'Dépassement à autoriser · Cuisine', { kind: 'decision', group: 'decisions', lineId: null, lineKind: undefined, status: 'awaiting', statusLabel: 'Décision du budget de vie attendue', plannedDate: '2026-11-10', plannedCents: 15000, detail: 'Cuisine' }),
    account(),
    point('loyer', 'Loyer', { state: 'closed', status: 'settled', statusLabel: 'Réglé', closedAt: '2026-11-02T08:15:00.000Z', closedOn: '2026-11-02', outcome: 'settled', outcomeLabel: 'Payée le 2 nov. 2026', realizedCents: 70000 }),
  ],
  targets,
  netCents: 130000,
  account: null,
  closing: { possible: true, reason: null, preview: { periodKey: '2026-11', periodLabel: 'Novembre 2026', capitalizationDate: '2026-11-30', resultCents: 130000, stockBefore: 1000, stockAfter: 2300, conditions: [] } },
  canClose: false,
  remaining: ['1 charge à régler ou décider', '1 décision à prendre ou reporter', 'compte à vérifier'],
  impacts: {
    next: { key: '2026-12', label: 'Décembre 2026', start: '2026-12-01', end: '2026-12-31' },
    capitalization: { resultCents: 130000, stockBefore: 1000, stockAfter: 2300, date: '2026-11-30', provisional: false },
    recurring: { count: 6, incomeCents: 200000, chargeCents: 90000 },
    planned: { count: 0, incomeCents: 0, chargeCents: 0 },
    projects: { count: 0, incomeCents: 0, chargeCents: 0 },
    deferred: { count: 1, incomeCents: 0, chargeCents: 12000, intoNext: { count: 0, incomeCents: 0, chargeCents: 0 }, byCycle: [
      { key: '2027-02', label: 'Février 2027', start: '2027-02-01', count: 1, incomeCents: 0, chargeCents: 12000, points: [{ id: 'carreaux', label: 'Carreaux', group: 'projects', direction: 'charge', plannedCents: 12000, project: 'Cuisine' }] },
    ] },
    decisions: { count: 1, points: [{ id: 'overrun:ovr_1', label: 'Dépassement à autoriser · Cuisine', project: 'Cuisine', plannedCents: 15000, state: 'open' }] },
    balanceCents: 110000,
    opensEntries: true,
  },
  actions,
  checks,
  lastClosure: null,
  ...over,
});

/** Demande de dépassement du projet « Cuisine », telle que la rend la fiche du projet. */
const overrun = {
  id: 'ovr_1', revision: 2, budgetId: 'bud_c', taskId: null, reason: 'reglement', reasonLabel: 'Règlement au-delà de l’enveloppe', amountCents: 15000, note: null,
  status: 'pending', statusLabel: 'En attente', requestedAt: '2026-11-10', decidedAt: null, billingDate: null, periodKey: null, billedAt: null,
  taskTitle: null, budgetName: 'Cuisine', coreProjectId: 'prj_c',
};

/** Plafonds du cycle : le poste Alimentation au-delà du sien. */
const caps = {
  context: { period: { key: '2026-11', label: 'Novembre 2026' } },
  lifeBudget: { budgetId: 'bud_vie', revision: 3, capsCents: { 'std:alimentation': 77000 } },
  centers: [{ ref: 'std:alimentation', label: 'Alimentation', standard: true, paidCents: 21950, toPayCents: 57000, engagedCents: 78950, capCents: 77000, marginCents: -1950, usedPct: 103, over: true, near: false, level: 'over', lineCount: 3 }],
  overCount: 1, alerts: [], levels: { mid: 50, high: 80, near: 90 },
};

const bilan = {
  context: null,
  bilan: {
    source: 'provisoire', status: 'ended', period: { key: '2026-11', label: 'Novembre 2026', start: '2026-11-01', end: '2026-11-30' },
    flows: { receivedCents: 200000, spentCents: 70000, resultCents: 130000, savingsRatePct: 65, plannedResultCents: 110000, savingsTargetCents: null, receivedCount: 1, paidCount: 2 },
    natures: [{ key: 'indispensable', label: 'Indispensables', paidCents: 70000, count: 2, sharePct: 100 }],
    highlights: [{ kind: 'result', tone: 'positive', title: 'Cycle excédentaire à ce jour', text: '+1 300,00 € à verser au patrimoine.' }],
  },
};

describe('page Clôture du cycle', () => {
  let harness: RouterTestingHarness;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  const dom = () => harness.routeNativeElement!;
  const buttons = () => [...dom().querySelectorAll<HTMLButtonElement>('button')];
  const button = (start: string) => buttons().find((b) => b.textContent!.trim().startsWith(start))!;
  const texts = (selector: string, root: ParentNode = dom()) => [...root.querySelectorAll(selector)].map((e) => e.textContent!.replace(/\s+/g, ' ').trim());
  const section = (cls: string) => dom().querySelector(`.${cls}`)!;
  async function settle() {
    for (let i = 0; i < 3; i++) { harness.detectChanges(); await harness.fixture.whenStable(); }
    harness.detectChanges();
  }
  /** Ouvre la page ; elle s'ouvre repliée, `unfold` déplie toutes les sections. */
  async function open(j: ClosingJourney, { unfold = true } = {}) {
    api = {
      closingJourney: vi.fn().mockResolvedValue(j),
      bilan: vi.fn().mockResolvedValue(bilan),
      closingDecision: vi.fn().mockResolvedValue(j),
      settleOccurrence: vi.fn().mockResolvedValue({}),
      realizeOperation: vi.fn().mockResolvedValue({}),
      finalizeClosing: vi.fn().mockResolvedValue({ replayed: false, closure: { periodLabel: 'Novembre 2026', result: 1300 }, carriedCount: 1, deferredCount: 1, journey: j }),
      costCenters: vi.fn().mockResolvedValue([]),
      // Fenêtres « Régler le problème » : la fiche d'échéance, la carte de décision, la comparaison du compte.
      line: vi.fn().mockRejectedValue(new Error('Fiche indisponible')),
      projectDetail: vi.fn().mockResolvedValue({ budget: { revision: 4, regime: true }, overruns: [overrun], requests: [] }),
      decideOverrun: vi.fn().mockResolvedValue({ notice: null }),
      register: vi.fn().mockResolvedValue({ totals: { netSettledCents: 130000 } }),
      spendingCaps: vi.fn().mockResolvedValue(caps),
    };
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'projet-de-vie/cloture', component: BpmClosingPage }]), { provide: BpmApi, useValue: api }] });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/projet-de-vie/cloture', BpmClosingPage);
    await settle();
    if (unfold) {
      button('Tout déplier').click();
      await settle();
    }
  }
  beforeEach(() => sessionStorage.clear());

  it('à l’ouverture : sections repliées (le compte rendu déplié), sans synthèse ; la clôture grisée tant qu’elle n’est pas débloquée', async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); } as never;
    await open(journey(), { unfold: false });
    expect(texts('.closing-fold')).toEqual(['Déplier', 'Déplier', 'Clôturer le cycle']);
    expect(dom().querySelector<HTMLButtonElement>('.closing-open-close')!.disabled).toBe(true);
    expect(dom().querySelector('.closing-summary, .closing-tiles, .closing-ring')).toBeNull();
    expect(texts('.closing-section-head h2')).toEqual(['Finaliser les points ouverts', 'Cohérence du cycle', 'Résultat de Novembre 2026 et cycle suivant', 'Clôturer Novembre 2026 et lancer Décembre 2026']);
    expect(texts('.closing-section-n')).toEqual(['1', '2', '3', '4']);
    expect(dom().querySelector('.closing-steps')).toBeNull();
    expect(dom().querySelector('bpm-closing-resolution')).toBeNull();

    // 1. À valider : trois encadrés, puis une colonne par étape (faits / à faire).
    const path = section('closing-path');
    expect(texts('.kb-label', path)).toEqual(['Points à valider', 'Points clos', 'Points bloquants']);
    expect(texts('.kb-value', path)).toEqual(['2', '3', '1']);
    expect(texts('.kb-part', path)[0]).toBe('dont 1 urgent');
    expect(path.querySelector('.kb-part')!.getAttribute('data-tone')).toBe('n4');
    expect([...path.querySelectorAll('.kb-box')].map((b) => b.getAttribute('data-tone'))).toEqual(['n3', 'ok', 'n4']);
    expect(texts('.kb-box:last-child small', path)).toEqual(['Vérification du compte : à faire']);
    expect(texts('.kt-head', path)).toEqual(['Entrées reçues', 'Charges réglées', 'Flux des projets', 'Décisions de financement', 'Compte vérifié']);
    expect(texts('.kt-cell b', path)).toEqual(['1 / 1', '2 / 3', '—', '0 / 1', '0 / 1']);
    expect([...path.querySelectorAll('.kt-col')].map((c) => c.getAttribute('data-tone'))).toEqual(['ok', 'n4', 'neutral', 'n4', 'n4']);

    // 2. Résultat puis cycle suivant, chiffres mis en valeur.
    const result = section('closing-result');
    // Compte rendu toujours déplié : le résultat d'abord, ce qu'il laisse au cycle suivant en dernier.
    const subs = texts('.closing-sub', result);
    expect(subs[0]).toBe('Le résultat');
    expect(subs.at(-1)).toBe('Ce que Novembre 2026 laisse à Décembre 2026');
    expect(result.querySelector('.closing-fold')).toBeNull();
    expect(texts('.kb-label', result)).toEqual(['Reçu', 'Dépensé', 'Résultat', 'Épargne', 'Solde prévu de Décembre 2026', 'Versé au patrimoine', 'Budget récurrent', 'Reports et décisions']);
    expect(texts('.kb-value', result)[2]).toMatch(/^\+1\s300,00\s€$/);
    expect([...result.querySelectorAll('.kb-box')].map((b) => b.getAttribute('data-tone'))).toEqual(['ok', 'n1', 'ok', 'ok', 'ok', 'ok', 'n1', 'n2']);

    // 3. Cohérence : bons, à voir, bloquants ; une colonne par contrôle.
    const coherence = section('closing-checks');
    expect(texts('.kb-value', coherence)).toEqual(['1 / 3', '1', '1']);
    expect([...coherence.querySelectorAll('.kt-col')].map((c) => c.getAttribute('data-tone'))).toEqual(['n4', 'ok', 'n2']);
    // Une seule ligne de colonnes : un texte trop long finit par « … », le texte complet reste au survol.
    expect([...coherence.querySelectorAll('.kt-head')].map((h) => h.getAttribute('title'))).toEqual(['Points du cycle traités', 'Données intègres', 'Plafonds respectés']);
    expect(coherence.querySelector('.kt-cell')!.getAttribute('title')).toBe('3 / 5 · bloque');
    // Les valeurs chiffrées ne sont jamais coupées, les textes peuvent finir par « … ».
    expect([...coherence.querySelectorAll('.kt-col')].map((c) => c.classList.contains('kt-figure'))).toEqual([true, false, false]);
    expect([...path.querySelectorAll('.kt-col')].map((c) => c.classList.contains('kt-figure'))).toEqual([true, true, false, true, true]);

    // 4. Clôture : ses encadrés et, en clôture, son bouton.
    expect(texts('.kb-label', section('closing-final'))).toEqual(['État de la clôture', 'Conditions restantes', 'Ce qui sera figé']);
    expect(button('Clôturer Novembre 2026 et lancer Décembre 2026')).toBeUndefined();

    // Une section se déplie par son bouton ; « Clôturer le cycle » reste grisé, même avec « Tout déplier ».
    coherence.querySelector<HTMLButtonElement>('.closing-fold')!.click();
    await settle();
    expect(scrolled).toEqual([]);
    expect(dom().querySelectorAll('.rs-card').length).toBe(2);
    button('Tout replier').click();
    await settle();
    expect(dom().querySelector('bpm-closing-resolution')).toBeNull();
  });

  it('cycle en cours : pas d’action de clôture, chaque point se règle en fenêtre ou là où il se traite', async () => {
    await open(journey({
      phase: 'running', percent: 52, done: 12, total: 23, canClose: false, closing: null,
      lock: { enabled: true, active: false, from: null, message: null },
      closingMode: { active: false, message: null },
      days: { total: 30, elapsed: 23, left: 7 },
      counts: { total: 23, open: 10, closed: 12, deferred: 0, later: 1, inherited: 1 },
      points: [
        point('alim', 'Alimentation'),
        point('report', 'Plombier', { lineKind: 'operation', operationId: 'op_1', recurrenceId: null, status: 'pending', statusLabel: 'À venir', plannedDate: '2026-11-28', inheritedFrom: { periodKey: '2026-10', label: 'Octobre 2026', date: '2026-10-25' } }),
        account({ state: 'later', status: 'later', statusLabel: 'À la fin du cycle, le 1 déc. 2026', openedOn: null }),
        point('loyer', 'Loyer', { state: 'closed', status: 'settled', closedAt: '2026-11-02T08:15:00.000Z', closedOn: '2026-11-02', outcome: 'settled', outcomeLabel: 'Payée le 2 nov. 2026', realizedCents: 70000 }),
      ],
      impacts: { ...journey().impacts!, capitalization: { resultCents: 130000, stockBefore: null, stockAfter: null, date: '2026-11-30', provisional: true }, deferred: { count: 0, incomeCents: 0, chargeCents: 0, intoNext: { count: 0, incomeCents: 0, chargeCents: 0 }, byCycle: [] }, opensEntries: false },
    }));
    expect(dom().querySelector('.closing-final-hint')!.textContent).toContain('se débloquera le');
    expect(dom().querySelector('.closing-lock.is-later')!.textContent).toContain('entrera en clôture');
    // 2 à valider dont 1 urgent : à surveiller ; le compte, bloquant, attend la fin du cycle (bleu).
    const path = section('closing-path');
    expect(texts('.kb-value', path)).toEqual(['2', '12', '1']);
    expect([...path.querySelectorAll('.kb-box')].map((b) => b.getAttribute('data-tone'))).toEqual(['n2', 'ok', 'n1']);
    expect(texts('.kb-box:first-child small', path)).toEqual(['à surveiller : 1 en retard ou du jour', '1 à venir d’ici le 30 nov.']);
    expect(texts('.kb-box:last-child small', path)).toEqual(['Vérification du compte : à faire après le 30 nov.']);
    // Aucune action de clôture : chaque point renvoie là où il se traite.
    expect(button('Payée le')).toBeUndefined();
    expect(dom().querySelector('.closing-defer')).toBeNull();
    const where = [...dom().querySelectorAll<HTMLAnchorElement>('.closing-item .closing-where')];
    expect(where.map((a) => a.textContent!.trim())).toEqual(['Régler dans les échéances →', 'Régler dans les échéances →']);
    expect(where[0].getAttribute('href')).toBe('/projet-de-vie/echeances?ligne=alim');
    expect(texts('.closing-mark[data-mark="inherited"]')).toEqual(['Reporté de Octobre 2026']);
    expect(texts('.closing-closed .closing-item strong')).toEqual(['Loyer']);
    expect(dom().querySelector('.closing-closed .closing-mark[data-mark="closed"]')!.textContent).toContain('Clos le 2 nov.');
    expect(button('Clôturer Novembre 2026 et lancer')).toBeUndefined();
    expect(dom().querySelector<HTMLButtonElement>('.closing-open-close')!.disabled).toBe(true);
    expect(dom().querySelector('.closing-final-hint')!.textContent).toContain('La clôture se débloquera le');
    // « Régler le problème », à gauche du lien vers sa page, ouvre la fiche de l'échéance en fenêtre, sur cette page ;
    // le compte se compare déjà (sa confirmation attend la clôture).
    const actions = dom().querySelector('.closing-item .closing-actions')!;
    expect([...actions.children].map((e) => e.textContent!.trim())).toEqual(['Régler le problème', 'Régler dans les échéances →']);
    expect(texts('.closing-account .closing-actions > *')).toEqual(['Régler le problème', 'Comparer avec la banque']);
    actions.querySelector<HTMLButtonElement>('.closing-fix')!.click();
    await settle();
    expect(api['line']).toHaveBeenCalledWith('alim', undefined);
    expect(dom().querySelector('bpm-line-detail dialog')).not.toBeNull();
  });

  it('« Régler le problème » : la décision du projet et la vérification du compte se font en fenêtre', async () => {
    const decision = point('overrun:ovr_1', 'Dépassement à autoriser · Cuisine', {
      kind: 'decision', group: 'decisions', lineId: null, lineKind: undefined, recurrenceId: null, status: 'awaiting', statusLabel: 'Décision du budget de vie attendue',
      plannedDate: '2026-11-10', plannedCents: 15000, detail: 'Cuisine', decisionKind: 'overrun', decisionId: 'ovr_1', project: { budgetId: 'bud_c', coreProjectId: 'prj_c', name: 'Cuisine' },
    });
    await open(journey({ points: [point('alim', 'Alimentation'), decision, account()] }));

    // La décision : la carte du projet, avec ses gestes ; décidée, la fenêtre se ferme et la page le dit.
    const item = [...dom().querySelectorAll('.closing-item')].find((li) => li.textContent!.includes('Dépassement à autoriser'))!;
    expect([...item.querySelector('.closing-actions')!.children].slice(0, 2).map((e) => e.textContent!.trim())).toEqual(['Régler le problème', 'Accorder ou refuser dans les règlements des projets →']);
    item.querySelector<HTMLButtonElement>('.closing-fix')!.click();
    await settle();
    expect(api['projectDetail']).toHaveBeenCalledWith('prj_c');
    const card = dom().querySelector('bpm-closing-decision .bpm-overrun')!;
    expect(card.textContent).toContain('Règlement au-delà de l’enveloppe');
    [...card.querySelectorAll('button')].find((b) => b.textContent!.trim().startsWith('Autoriser'))!.click();
    await settle();
    expect(api['decideOverrun']).toHaveBeenCalledWith('ovr_1', 'approve', 2);
    expect(dom().querySelector('bpm-closing-decision')).toBeNull();
    expect(dom().textContent).toContain('Moyens supplémentaires autorisés');

    // Le compte : la comparaison du Rapprochement bancaire, aux mêmes dates, puis la confirmation.
    const block = dom().querySelector('.closing-account')!;
    expect(texts('.closing-actions > *', block)).toEqual(['Régler le problème', 'Comparer avec la banque', 'Le compte correspond']);
    block.querySelector<HTMLButtonElement>('.closing-fix')!.click();
    await settle();
    expect(api['register']).toHaveBeenCalledWith({ from: '2026-11-01', to: '2026-11-30', period: '2026-11', dateBasis: 'realized', direction: '', status: 'settled' });
    const dialog = dom().querySelector('bpm-closing-account')!;
    expect(dialog.querySelector('bpm-bank-reconciliation')).not.toBeNull();
    [...dialog.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Le compte correspond')!.click();
    await settle();
    expect(api['closingDecision']).toHaveBeenCalledWith({ periodKey: '2026-11', account: { confirmed: true } });
    expect(dom().querySelector('bpm-closing-account')).toBeNull();
  });

  it('en clôture : seuls les points ouverts se traitent, une échéance se revoit dans le cycle choisi', async () => {
    await open(journey());
    expect(dom().querySelector('.closing-lock[role="status"]')!.textContent).toContain('est en clôture : ses points sont figés');
    expect(dom().querySelector('.closing-final-hint')!.textContent).toContain('Encore : 1 charge à régler ou décider, 1 décision à prendre ou reporter, compte à vérifier.');
    expect(dom().querySelector('[data-impact="deferred"]')!.textContent).toContain('1 point revu en Février 2027');

    button('Payée le').click();
    await settle();
    expect(api['settleOccurrence']).toHaveBeenCalledWith('rec_alim', { requestKey: expect.any(String), occurrenceDate: '2026-11-07', realizedDate: '2026-11-07' });

    // Une échéance : n'importe quel cycle à venir ; une décision : le cycle suivant seulement.
    const [lineSelect, decisionSelect] = [...dom().querySelectorAll<HTMLSelectElement>('.closing-defer select')];
    expect([...lineSelect.options].map((o) => o.textContent)).toEqual(['Décembre 2026', 'Janvier 2027', 'Février 2027']);
    expect([...decisionSelect.options].map((o) => o.textContent)).toEqual(['Décembre 2026']);
    lineSelect.value = '2027-02';
    dom().querySelectorAll<HTMLButtonElement>('.closing-defer button')[0].click();
    await settle();
    expect(api['closingDecision']).toHaveBeenCalledWith({ periodKey: '2026-11', defer: { pointId: 'alim', toPeriodKey: '2027-02' } });

    button('Le compte correspond').click();
    await settle();
    expect(api['closingDecision']).toHaveBeenCalledWith({ periodKey: '2026-11', account: { confirmed: true } });
    expect(api['finalizeClosing']).not.toHaveBeenCalled();
  });

  it('cohérence : chaque incohérence dit comment la résoudre, et ce que l’action a changé depuis le dernier passage', async () => {
    const at = new Date(2026, 10, 23, 14, 32).toISOString();
    sessionStorage.setItem('bpm.closing.visit.anonyme.2026-11', JSON.stringify({ at, open: ['loyer', 'alim'], checks: { caps: { state: 'warn', count: 2, done: 1 }, points: { state: 'fail', count: 1, done: 2 } } }));
    await open(journey());
    const cards = [...dom().querySelectorAll('.rs-card')];
    expect(cards.map((c) => c.getAttribute('data-tone'))).toEqual(['n4', 'n2']);
    expect(texts('.rs-problem')).toEqual(['2 points restent ouverts.', '1 poste dépasse son plafond.']);
    expect(texts('.rs-steps .rs-text', cards[0])).toEqual(['Validez chaque point ouvert dans « À valider ».', 'Comparez avec la banque.']);
    expect(texts('.rs-go', cards[0])).toEqual(['Voir sur cette page →', 'Y aller →']);
    expect(cards[0].querySelector<HTMLAnchorElement>('a.rs-go')!.getAttribute('href')).toBe('/tableau-de-bord/rapprochement?period=2026-11');
    expect(cards[0].querySelector<HTMLAnchorElement>('.rs-items a')!.getAttribute('href')).toBe('/projet-de-vie/echeances?ligne=alim');
    expect(cards[1].querySelector<HTMLAnchorElement>('.rs-items a')!.getAttribute('href')).toBe('/argent/postes/alimentation?period=2026-11');
    // Depuis le passage de 14 h 32 : un poste revenu sous son plafond, un point de plus de fait, Loyer clos.
    expect(texts('.rs-delta')).toEqual(['Avancée depuis votre passage de 14 h 32 : 1 de plus, encore 2 avant que ce contrôle soit bon.', '1 élément résolu depuis votre passage de 14 h 32 : il en reste 1.']);
    expect(texts('.closing-path .kb-box:nth-child(2) small')).toContain('+1 depuis votre passage de 14 h 32');
    expect(texts('.rs-ok li strong')).toEqual(['Données intègres']);
  });

  it('cohérence : « Régler le problème » ouvre, sur cette page, le formulaire de chaque étape et élément à corriger', async () => {
    const account: ClosingChecks['items'][number] = {
      key: 'account', level: 'blocking', label: 'Compte vérifié', state: 'fail', value: 'À vérifier', text: 'Le compte reste à vérifier.', target: 'closing-step-account', items: [],
      resolution: {
        problem: 'Le compte n’est pas vérifié.', why: 'Le cycle doit raconter la même chose que la banque.', progress: null,
        steps: [
          { text: 'Ouvrez « Vérifier le compte » et comparez.', target: { kind: 'reconciliation' } },
          { text: 'S’il manque un mouvement, saisissez-le comme déjà réglé.', target: { kind: 'page', path: 'mouvements' } },
          { text: 'Revenez ici et confirmez.', target: { kind: 'section', id: 'closing-step-account' } },
        ],
      },
    };
    await open(journey({ checks: { ...checks, items: [...checks.items, account] } }));
    dom().querySelectorAll('details.rs-items').forEach((d) => ((d as HTMLDetailsElement).open = true));
    const card = (key: string) => dom().querySelector(`#closing-check-${key}`)!;
    const acts = (key: string, sel: string) => [...card(key).querySelectorAll(sel)].map((a) => [...a.children].map((e) => e.textContent!.trim()).join(' | '));
    // Chaque lien vers une page de correction a, à sa gauche, sa fenêtre quand le site a le formulaire.
    expect(acts('points', '.rs-steps .rs-acts')).toEqual(['Voir sur cette page →', 'Régler le problème | Y aller →']);
    expect(acts('points', '.rs-items .rs-acts')).toEqual(['Régler le problème | Corriger →']);
    expect(acts('caps', '.rs-steps .rs-acts')).toEqual(['Régler le problème | Y aller →']);
    expect(acts('caps', '.rs-items .rs-acts')).toEqual(['Régler le problème | Corriger →']);
    expect(acts('account', '.rs-steps .rs-acts')).toEqual(['Régler le problème | Y aller →', 'Régler le problème | Y aller →', 'Voir sur cette page →']);

    // L'échéance : sa fiche.
    card('points').querySelector<HTMLButtonElement>('.rs-items .rs-fix')!.click();
    await settle();
    expect(api['line']).toHaveBeenCalledWith('alim', undefined);
    dom().querySelector<HTMLButtonElement>('bpm-line-detail .modal-close')!.click();
    await settle();
    // Le poste au-delà de son plafond : la fenêtre du plafond, lue sur le cycle de la clôture.
    card('caps').querySelector<HTMLButtonElement>('.rs-items .rs-fix')!.click();
    await settle();
    expect(api['spendingCaps']).toHaveBeenCalledWith('2026-11');
    expect(dom().querySelector('bpm-cap-dialog')!.textContent).toContain('Alimentation');
    dom().querySelector<HTMLButtonElement>('bpm-cap-dialog .modal-close')!.click();
    await settle();
    expect(dom().querySelector('bpm-closing-cap')).toBeNull();
    // Le compte : la comparaison ; un mouvement manquant : la saisie, déjà réglée.
    card('account').querySelector<HTMLButtonElement>('.rs-steps .rs-fix')!.click();
    await settle();
    expect(dom().querySelector('bpm-closing-account bpm-bank-reconciliation')).not.toBeNull();
    dom().querySelector<HTMLButtonElement>('bpm-closing-account .modal-close')!.click();
    await settle();
    card('account').querySelectorAll<HTMLButtonElement>('.rs-steps .rs-fix')[1].click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/projet-de-vie/cloture?entry=new&entryDirection=charge&entryPaid=1');
  });

  it('actions du cycle : une ligne qui se déplie, par catégorie, chaque action vers son objet', async () => {
    await open(journey());
    const line = dom().querySelector<HTMLDetailsElement>('.closing-actions-line')!;
    expect(line.open).toBe(false);
    expect(line.querySelector('summary')!.textContent!.replace(/\s+/g, ' ')).toContain('3 actions enregistrées depuis le 1 nov.');
    expect(texts('.jn-title strong')).toEqual(['Argent du quotidien', 'Plafonds et postes']);
    expect(texts('.jn-main > span')).toEqual(['Échéance réglée · Alimentation × 2', 'Plafonds des postes fixés · Plafonds des postes']);
    expect([...dom().querySelectorAll<HTMLAnchorElement>('.jn-open')].map((a) => a.getAttribute('href'))).toEqual(['/tableau-de-bord/entrees?ligne=op_1', '/plafonds']);
    expect(dom().querySelector('.jn-note')!.textContent).toContain('reconstituées depuis les données');
  });

  it('point reporté : il garde sa marque et le report se retire', async () => {
    await open(journey({ points: [point('alim', 'Alimentation', { state: 'deferred', deferTo: targets[2] }), account()] }));
    expect(texts('.closing-mark[data-mark="deferred"]')).toEqual(['Non validé ici · à revoir en Février 2027']);
    button('Le garder dans Novembre 2026').click();
    await settle();
    expect(api['closingDecision']).toHaveBeenCalledWith({ periodKey: '2026-11', defer: { pointId: 'alim', toPeriodKey: null } });
  });

  it('à 100 % : la clôture fige le bilan et lance le cycle suivant', async () => {
    await open(journey({
      percent: 100, done: 6, canClose: true, remaining: [],
      counts: { total: 6, open: 0, closed: 5, deferred: 1, later: 0, inherited: 0 },
      criteria: journey().criteria.map((c) => ({ ...c, done: c.total, state: c.total ? 'done' : 'none', remaining: null })),
      points: [account({ state: 'closed', status: 'settled', statusLabel: 'Vérifié', outcome: 'confirmed', outcomeLabel: 'Vérifié le 2 déc. 2026', closedOn: '2026-12-02' })],
      account: { confirmedAt: '2026-12-02', netCents: 130000, note: null, stale: false },
      checks: { ...checks, items: checks.items.map((c) => ({ ...c, state: 'ok' as const })), ok: 3, warn: 0, fail: 0, blocking: [] },
    }));
    expect(dom().querySelector<HTMLButtonElement>('.closing-open-close')!.disabled).toBe(false);
    expect(texts('.closing-path .kb-value')).toEqual(['0', '5', '0']);
    expect(texts('.closing-path .kb-box:last-child small')).toEqual(['Aucun point bloquant', 'la clôture n’attend que les points à valider']);
    const final = button('Clôturer Novembre 2026 et lancer Décembre 2026');
    expect(final.disabled).toBe(false);
    final.click();
    await settle();
    expect(api['finalizeClosing']).toHaveBeenCalledWith({ requestKey: expect.any(String), periodKey: '2026-11', expectedResultCents: 130000 });
  });
});
