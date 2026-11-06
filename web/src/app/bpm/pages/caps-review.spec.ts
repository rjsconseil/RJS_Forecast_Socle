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

  it('lit une période close comme un bilan : plus de « nouvel achat » à surveiller', () => {
    const closed = { ...data(2000), totals: { reading: 'closed' } } as unknown as CapsReview;
    expect(reviewCards(closed, 'center')[0].alert).toBe('La période s’est terminée 15,00 € au-delà du plafond de ce poste.'.replace(' €', '\u00a0€'));
    expect(reviewCards(data(2000), 'center')[0].alert).toContain('Chaque nouvelle dépense');
  });

  it('suit la règle « proche du plafond » fournie par le middleware', () => {
    const c = { ...center(4000), near: false };
    expect(reviewCards({ centers: [c], categories: [], charges: {} } as unknown as CapsReview, 'center')[0].health).toBe('ok');
    expect(reviewCards({ centers: [{ ...c, near: true }], categories: [], charges: {} } as unknown as CapsReview, 'center')[0].health).toBe('watch');
  });
});
