import { CapsReview, ReviewCategory, ReviewCenter } from '../../core/bpm-caps.models';
import { reviewCards } from './caps-review';

const measure = (capCents: number | null, engagedCents: number) => ({ capCents, engagedCents, paidCents: engagedCents, toPayCents: 0, marginCents: capCents === null ? null : capCents - engagedCents, usedPct: capCents ? engagedCents / capCents * 100 : null, over: capCents !== null && engagedCents > capCents, lineCount: 0, chargeIds: [] });
const center = (cap: number | null): ReviewCenter => ({ ref: 'std:loisirs', label: 'Loisirs', standard: true, ...measure(cap, 3500) });
const category: ReviewCategory = { id: 'cat_1', label: 'Cinéma', costCenterRef: 'std:loisirs', costCenterLabel: 'Loisirs', archived: false, revision: 1, ...measure(3000, 3500) };
const data = (cap: number | null) => ({ centers: [center(cap)], categories: [category], charges: {} }) as CapsReview;

describe('revue indépendante des plafonds', () => {
  it('garde la catégorie dépassée visible lorsque son centre dispose encore de marge', () => {
    const cards = reviewCards(data(10000), 'both');
    expect(cards[0].health).toBe('alert');
    expect(cards[0].healthLabel).toBe('Catégorie dépassée');
    expect(cards[0].groups[0].health).toBe('alert');
    expect(cards[0].alert).toContain('reste dans son plafond');
    expect(reviewCards(data(10000), 'center')[0].health).toBe('ok');
  });

  it('montre aussi les catégories plafonnées d’un centre sans plafond', () => {
    const cards = reviewCards(data(null), 'both');
    expect(cards).toHaveLength(1);
    expect(cards[0].health).toBe('alert');
    expect(cards[0].groups[0].overCents).toBe(500);
  });

  it('signale le centre quand les deux niveaux dépassent', () => {
    expect(reviewCards(data(2000), 'both')[0].healthLabel).toBe('Plafond dépassé');
  });
});
