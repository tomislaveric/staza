import type { WorldCollectible, WorldFartlek } from "../domain.js";
import type { FlowlineGeometry, QuestRouteTarget } from "./types.js";

/** Upper bound of targets one exploration area can offer; denser areas report `truncated`. */
export const MAX_AVAILABLE_TARGETS = 150;

/**
 * Exploration-eligible destinations of an area as planner targets: published, visible
 * collectibles with a category. Already found objects stay eligible (marked `alreadyAchieved`).
 * Flowlines are never planner targets. Inputs are expected nearest-first; planning never
 * invents targets.
 */
export const buildExplorationTargets = (collectibles: WorldCollectible[]): { targets: QuestRouteTarget[]; truncated: boolean } => {
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
  return { targets: points.slice(0, MAX_AVAILABLE_TARGETS), truncated: points.length > MAX_AVAILABLE_TARGETS };
};

/** Published Flowlines of an area with valid geometry, for analysing finished routes. */
export const buildFlowlineGeometries = (flowlines: WorldFartlek[]): FlowlineGeometry[] =>
  flowlines
    .filter((flowline) => flowline.status === "published" && flowline.geometry.coordinates.length >= 2)
    .map((flowline) => ({
      id: flowline.id,
      name: flowline.name,
      coordinates: flowline.geometry.coordinates.map(([lon, lat]) => [lon, lat] as [number, number]),
      lengthMeters: flowline.lengthMeters
    }));
