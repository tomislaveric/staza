import type { WorldCollectible, WorldFartlek } from "../domain.js";
import type { QuestRouteTarget } from "./types.js";

/** Upper bound of targets one exploration area can offer; denser areas report `truncated`. */
export const MAX_AVAILABLE_TARGETS = 150;

/**
 * Exploration-eligible World objects of an area as planner targets: published, visible
 * collectibles with a category and published Flowlines with valid geometry. Already found or
 * completed objects stay eligible (marked `alreadyAchieved`). Inputs are expected nearest-first;
 * planning never invents targets.
 */
export const buildExplorationTargets = (
  collectibles: WorldCollectible[],
  flowlines: WorldFartlek[]
): { targets: QuestRouteTarget[]; truncated: boolean } => {
  const points: QuestRouteTarget[] = collectibles
    .filter((collectible) => (collectible.status ?? "published") === "published"
      && collectible.visibility !== "hidden" && collectible.primaryCategory !== undefined)
    .map((collectible) => ({
      kind: "point",
      id: collectible.id,
      name: collectible.name,
      objectiveIds: [],
      category: collectible.primaryCategory,
      coordinate: { lat: collectible.latitude, lon: collectible.longitude },
      radiusMeters: collectible.radiusMeters,
      alreadyAchieved: collectible.found
    }));
  const segments: QuestRouteTarget[] = flowlines
    .filter((flowline) => flowline.status === "published" && flowline.geometry.coordinates.length >= 2)
    .map((flowline) => ({
      kind: "segment",
      id: flowline.id,
      name: flowline.name,
      objectiveIds: [],
      coordinates: flowline.geometry.coordinates.map(([lon, lat]) => [lon, lat] as [number, number]),
      lengthMeters: flowline.lengthMeters,
      bidirectional: true,
      alreadyAchieved: flowline.completed
    }));
  const all = [...segments, ...points];
  const truncated = all.length > MAX_AVAILABLE_TARGETS;
  // Keep a fair share of both kinds when capping.
  const kept = truncated
    ? [...segments.slice(0, Math.ceil(MAX_AVAILABLE_TARGETS / 3)), ...points].slice(0, MAX_AVAILABLE_TARGETS)
    : all;
  return { targets: kept, truncated };
};
