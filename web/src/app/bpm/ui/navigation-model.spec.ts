import { bpmAddress, emptyTrail, recordVisit } from './navigation-model';

const visit = (id: string, url = `/creer?step=${id}`) => ({ id, url, label: id });

describe('historique du parcours BPM', () => {
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
    trail = recordVisit(trail, visit('nouveau', '/depenses'));
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
    for (let i = 0; i < 90; i++) trail = recordVisit(trail, visit(String(i)));
    expect(trail.visits).toHaveLength(60);
    expect(trail.cursor).toBe(59);
    expect(bpmAddress('https://example.com')).toBe(false);
    expect(bpmAddress('//example.com')).toBe(false);
    expect(bpmAddress('/socle/budget')).toBe(false);
    expect(bpmAddress('/app/gestion-projet/prj_1?q=travaux')).toBe(true);
  });
});
