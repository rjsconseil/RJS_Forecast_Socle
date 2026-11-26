// Faux service des lectures du lien projets ↔ projet de vie, pour les tests des pages qui l'affichent.
const life = { budgetId: 'bud_life', projectCount: 0, fundedCount: 0, allocatedCents: 0, paidCents: 0, approvedOverrunCents: 0, sharesCents: 0, availableCents: 0, remainingCents: 0, periodPaidCents: null, taskRequests: [], deficitCount: 0, pendingRequests: [], billable: [], billableCents: 0, nextBillingDate: null };
export const lifeLinkApiStub = () => ({
  projectsOverview: async () => ({ life, projects: [], candidates: [] }),
  bilan: async () => null,
  bilans: async () => ({ bilans: [], projects: [], totals: { closedCount: 0, capitalizedCents: 0, projectsClosedCents: 0 } }),
});
