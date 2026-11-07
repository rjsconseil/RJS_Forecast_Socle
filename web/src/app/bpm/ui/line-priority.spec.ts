import { RegisterLine } from '../../core/bpm-models';
import { nextOpenLine } from './line-priority';
const line = (id: string, status: string, date: string, extra = {}) =>
  ({ id, status, plannedDate: date, settled: status === 'settled', ...extra }) as RegisterLine;
describe('priorité des échéances du bandeau', () => {
  it('traite le retard avant le jour et les prévisions, indépendamment du sens du flux', () => {
    const lines = [
      line('future', 'pending', '2026-11-20'),
      line('today', 'due', '2026-11-07'),
      line('late', 'late', '2026-11-05', { direction: 'income' }),
    ];
    expect(nextOpenLine(lines)?.id).toBe('late');
    expect(lines.map((l) => l.id)).toEqual(['future', 'today', 'late']);
  });
  it('passe à la suivante après règlement et ignore charges spéciales et périodes closes', () => {
    const lines = [
      line('allocation', 'late', '2026-01-01', { special: true }),
      line('done', 'settled', '2026-02-01'),
      line('closed', 'unrealized', '2026-03-01'),
      line('next', 'pending', '2026-11-12'),
    ];
    expect(nextOpenLine(lines)?.id).toBe('next');
    expect(nextOpenLine(lines.slice(0, 3))).toBeNull();
  });
  it('choisit la première date puis une identité stable, et accepte une liste vide', () => {
    expect(
      nextOpenLine([
        line('z', 'pending', '2026-11-15'),
        line('b', 'pending', '2026-11-12'),
        line('a', 'pending', '2026-11-12'),
      ])?.id,
    ).toBe('a');
    expect(nextOpenLine([])).toBeNull();
  });
});
