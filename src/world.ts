import type { Collectible, WorldCollectibleVisibility, WorldSnapshot } from "./domain.js";

export const createWorldSnapshot = (
  collectibles: Collectible[],
  discoveredSourceIds: Iterable<string>,
  visibilityBySourceId: ReadonlyMap<string, WorldCollectibleVisibility> = new Map()
): WorldSnapshot => {
  const discoveredIds = new Set(discoveredSourceIds);
  const worldCollectibles = collectibles.map((collectible) => ({
    ...collectible,
    found: discoveredIds.has(collectible.id),
    visibility: visibilityBySourceId.get(collectible.id) ?? "visible"
  }));
  const discovered = worldCollectibles.filter((collectible) => collectible.found);

  return {
    collectibles: worldCollectibles,
    stats: {
      totalCollectibles: worldCollectibles.length,
      discoveredCount: discovered.length,
      remainingCount: worldCollectibles.length - discovered.length
    }
  };
};
