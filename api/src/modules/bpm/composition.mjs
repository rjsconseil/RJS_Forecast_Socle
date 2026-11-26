// Accès de BPM à sa composition, à sa liaison de cycle et à ses clôtures (lectures de ses propres natures).
export const compositionOf = (state, userId) => Object.values(state.bpmCompositions).find((c) => c.userId === userId) ?? null;
export const cycleOf = (state, compositionId) => Object.values(state.cycleLinks).find((c) => c.bpmCompositionId === compositionId) ?? null;
export const closuresOf = (state, cycleId) => Object.values(state.closures).filter((c) => c.cycleLinkId === cycleId).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
