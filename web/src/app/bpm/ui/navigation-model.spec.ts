import { bpmAddress, emptyTrail, recordVisit, removeVisits, sameStep, TRAIL_LIMIT, visitLabel } from './navigation-model';

const visit = (id: string, url = `/creer?step=${id}`) => ({ id, url, label: id });

describe('historique du parcours BPM', () => {
  it('nomme les saisies et réglages pour distinguer chaque geste du parcours', () => {
    expect(visitLabel('/vision?goal=new')).toBe('Créer un objectif daté');
    expect(visitLabel('/vision?goal=obj_1')).toBe('Modifier un objectif daté');
    expect(visitLabel('/vision/reperes?reglage=savings')).toBe('Régler l’épargne visée');
    expect(visitLabel('/vision/projection?reglage=projection')).toBe('Ajuster les hypothèses');
    expect(visitLabel('/app/gestion-projet/prj_1/taches?task=tsk_1&demande=tsk_1', 'Bureau')).toBe('Bureau · Tâches · Demander une part de budget');
    expect(visitLabel('/app/gestion-projet/prj_1/taches?task=tsk_1&ligne=op_1', 'Bureau')).toBe('Bureau · Tâches · Détail d’une échéance');
  });
  it('revient de plusieurs étapes puis retrouve le même chemin en avant', () => {
    let trail = emptyTrail();
    for (const id of ['1', '2', '3', '4']) trail = recordVisit(trail, visit(id));
    trail = recordVisit(trail, visit('2'), { restoredId: '2' });
    expect(trail.cursor).toBe(1);
    expect(trail.visits.map((v) => v.id)).toEqual(['1', '2', '3', '4']);
    trail = recordVisit(trail, visit('3'), { restoredId: '3' });
    expect(trail.cursor).toBe(2);
    expect(trail.visits[trail.cursor + 1].id).toBe('4');
  });
  it('une nouvelle direction après un retour remplace seulement le chemin à venir', () => {
    let trail = recordVisit(recordVisit(emptyTrail(), visit('1')), visit('2'));
    trail = recordVisit(trail, visit('1'), { restoredId: '1' });
    trail = recordVisit(trail, visit('nouveau', '/depenses/registre'));
    expect(trail.visits.map((v) => v.id)).toEqual(['1', 'nouveau']);
  });
  it('modifier les filtres remplace la visite courante sans ajouter une étape par caractère', () => {
    let trail = recordVisit(emptyTrail(), visit('liste', '/app/gestion-projet'));
    trail = recordVisit(trail, visit('filtre', '/app/gestion-projet?q=vacances'), {
      replace: true,
    });
    expect(trail.visits).toHaveLength(1);
    expect(trail.visits[0].url).toContain('q=vacances');
    expect(trail.cursor).toBe(0);
  });
  it('limite le parcours et refuse les destinations externes ou d’une autre couche', () => {
    let trail = emptyTrail();
    for (let i = 0; i < TRAIL_LIMIT + 30; i++) trail = recordVisit(trail, visit(String(i)));
    expect(trail.visits).toHaveLength(TRAIL_LIMIT);
    expect(trail.cursor).toBe(TRAIL_LIMIT - 1);
    expect(trail.visits[0].id).toBe('30');
    expect(bpmAddress('https://example.com')).toBe(false);
    expect(bpmAddress('//example.com')).toBe(false);
    expect(bpmAddress('/socle/budget')).toBe(false);
    expect(bpmAddress('/app/gestion-projet/prj_1?q=travaux')).toBe(true);
  });
  it('rejoindre l’étape suivante par un lien de la page garde le chemin jusqu’à la dernière étape atteinte', () => {
    let trail = emptyTrail();
    for (const id of ['1', '2', '3', '4']) trail = recordVisit(trail, visit(id));
    trail = recordVisit(trail, visit('2'), { restoredId: '2' });
    trail = recordVisit(trail, visit('autre-id', '/creer?step=3'));
    expect(trail.cursor).toBe(2);
    expect(trail.visits.map((v) => v.id)).toEqual(['1', '2', '3', '4']);
  });
  it('remonter vers l’étape précédente par un lien la rejoint sans effacer l’étape quittée', () => {
    let trail = emptyTrail();
    for (const id of ['1', '2', '3']) trail = recordVisit(trail, visit(id));
    trail = recordVisit(trail, visit('lien', '/creer?step=2'));
    expect(trail.cursor).toBe(1);
    expect(trail.visits[2].id).toBe('3');
  });
  it('refermer une saisie ouverte sur la page la rend à l’étape d’avant, sans doublon', () => {
    let trail = recordVisit(emptyTrail(), visit('accueil', '/projet-de-vie'));
    trail = recordVisit(trail, visit('tdb', '/tableau-de-bord?period=2026-11'));
    trail = recordVisit(trail, visit('saisie', '/tableau-de-bord?period=2026-11&entry=new'));
    trail = recordVisit(trail, visit('ferme', '/tableau-de-bord?period=2026-11'), { replace: true });
    expect(trail.visits.map((v) => v.id)).toEqual(['accueil', 'tdb']);
    expect(trail.cursor).toBe(1);
  });
  it('compare les adresses sans tenir compte de l’ordre des paramètres', () => {
    expect(sameStep('/plafonds?period=2026-11&show=over', '/plafonds?show=over&period=2026-11')).toBe(true);
    expect(sameStep('/plafonds?period=2026-11', '/plafonds?period=2026-10')).toBe(false);
  });
  it('retire les étapes d’un parcours guidé confirmé et revient à ce qui le précédait', () => {
    let trail = recordVisit(emptyTrail(), visit('tdb', '/tableau-de-bord'));
    for (const id of ['1', '2', '3']) trail = recordVisit(trail, visit(id));
    trail = removeVisits(trail, (url) => url.startsWith('/creer'));
    expect(trail.visits.map((v) => v.id)).toEqual(['tdb']);
    expect(trail.cursor).toBe(0);
    trail = recordVisit(trail, visit('vie', '/projet-de-vie'));
    expect(trail.visits.map((v) => v.id)).toEqual(['tdb', 'vie']);
  });
});
