/** Flowlines one "Explore this Area" generation reveals at most. */
export const FLOWLINES_REVEALED_PER_EXPLORE = 5;

/**
 * The best unrevealed Flowlines of an area: highest flow score first, ties by id, so the same area
 * always reveals the same Flowlines in the same order.
 */
export const selectFlowlinesToReveal = <T extends { id: string; flowScore?: number }>(
  candidates: T[],
  revealedIds: ReadonlySet<string>,
  count: number = FLOWLINES_REVEALED_PER_EXPLORE
): T[] =>
  candidates
    .filter((candidate) => !revealedIds.has(candidate.id))
    .sort((a, b) => (b.flowScore ?? 0) - (a.flowScore ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, count));
