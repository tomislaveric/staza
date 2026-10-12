import type { WorldCollectible, WorldFartlek } from "../domain.js";
import type { LatLon, QuestRouteTarget, RoutePlanningInput } from "../routePlanning/types.js";
import type { GeoBounds } from "../worldQuery.js";

/** The map area frozen when the player clicked "Explore this Area". */
export interface ExplorationAreaContext {
  bounds: GeoBounds;
  center: LatLon;
  zoom: number;
}

/**
 * One ephemeral exploration: the frozen area, the ride the player asked for and the eligible
 * targets resolved once from the area. Lives only in server memory until a route is confirmed;
 * which targets a route contains is decided by the planner and later by the player's edits.
 */
export interface ExplorationSession {
  id: string;
  playerId: string;
  area: ExplorationAreaContext;
  input: RoutePlanningInput;
  availableTargets: QuestRouteTarget[];
  /** World objects behind the available targets, returned to the client for rendering. */
  collectibles: WorldCollectible[];
  flowlines: WorldFartlek[];
  truncated: boolean;
  expiresAtMs: number;
}
