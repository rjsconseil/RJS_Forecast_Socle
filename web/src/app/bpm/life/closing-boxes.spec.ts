import { Bilan } from '../data/bpm-bilans.models';
import { ClosingChecks, ClosingJourney, ClosingPoint } from '../data/bpm-closing.models';
import { checkBoxes, closeConditions, closeTone, pathColumns, plural, resultTone } from './closing-boxes';

// Les chiffres clés de la clôture se calculent sans page : seuils d'alerte et libellés, vérifiés directement.
const journey = (over: Partial<ClosingJourney>) => ({ period: { key: '2026-11', label: 'Novembre', end: '2026-11-30' }, criteria: [], points: [], ...over }) as unknown as ClosingJourney;
const point = (group: string, status: string) => ({ group, status, state: 'open', kind: 'entry' }) as unknown as ClosingPoint;

describe('chiffres clés de la clôture', () => {
  it('résultat : vert en excédent, orange pour un petit déficit, rouge au-delà de 10 % des entrées', () => {
    const bilan = (resultCents: number) => ({ flows: { resultCents, receivedCents: 100_000 } }) as unknown as Bilan;
    expect(resultTone(bilan(500), null)).toBe('ok');
    expect(resultTone(bilan(-10_000), null)).toBe('n3');
    expect(resultTone(bilan(-10_001), null)).toBe('n4');
    expect(resultTone(null, null)).toBe('neutral');
    expect(resultTone(null, journey({ netCents: -1 }))).toBe('n4');
  });

  it('étapes : la couleur suit le nombre de points en retard, et vire au rouge en clôture', () => {
    const j = journey({ criteria: [{ key: 'charges', state: 'todo', done: 1, total: 5 }] as ClosingJourney['criteria'] });
    const late = [point('charges', 'late'), point('charges', 'due'), point('charges', 'late'), point('income', 'late')];
    expect(pathColumns(j, late, false)[0]).toEqual({ label: 'Charges réglées', value: '1 / 5', tone: 'n3', sub: '3 en retard' });
    expect(pathColumns(j, late.slice(0, 1), false)[0].tone).toBe('n2');
    expect(pathColumns(j, [], false)[0]).toMatchObject({ tone: 'n1', sub: 'en cours' });
    expect(pathColumns(j, [], true)[0].tone).toBe('n4');
  });

  it('cohérence : un contrôle bloquant encore « à voir » annonce qu’il bloquera la clôture', () => {
    const checks = { ok: 1, total: 3, later: 0, items: [
      { key: 'a', label: 'Solde', value: '12 €', level: 'blocking', state: 'warn' },
      { key: 'b', label: 'Écart', value: '3 €', level: 'info', state: 'warn' },
      { key: 'c', label: 'Dates', value: 'ok', level: 'info', state: 'ok' },
    ] } as unknown as ClosingChecks;
    const [good, toSee, blocking] = checkBoxes(checks);
    expect(good.value).toBe('1 / 3');
    expect(toSee.lines).toEqual(['Écart : 3 €']);
    expect(blocking.lines).toEqual(['Solde : 12 € (bloquera la clôture)']);
  });

  it('clôturer : au-delà de deux conditions restantes en clôture, l’état passe au rouge', () => {
    const j = journey({ phase: 'to_close', canClose: false } as Partial<ClosingJourney>);
    const blocking = [{ label: 'Vérification du compte', detail: 'à faire', tone: 'n4' as const }, { label: 'Solde', detail: '12 €', tone: 'n4' as const }];
    const two = closeConditions(j, 0, true, 'n3', blocking);
    expect(closeTone(j, two)).toBe('n3');
    const three = closeConditions(j, 4, true, 'n3', blocking);
    expect(three[0]).toEqual({ label: plural(4, 'point à valider', 'points à valider'), tone: 'n4' });
    expect(closeTone(j, three)).toBe('n4');
    expect(closeTone(journey({ canClose: true } as Partial<ClosingJourney>), three)).toBe('ok');
  });
});
