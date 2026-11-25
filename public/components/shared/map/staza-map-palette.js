/**
 * Colors of the Staza overlays drawn on top of the basemap. Mirrors `src/mapPalette.ts`, which
 * serves the same palette to native clients via `/api/world/basemap`; a test keeps them equal.
 */
export const STAZA_MAP_PALETTE = Object.freeze({
  casing: "#0b0c0f",
  questRoute: "#e8b80a",
  plannedRoute: "#4c8dff",
  alternateRoute: "#c9b46a",
  activityRoute: "#5ec8c2",
  activityRouteSubdued: "#4a4f59",
  position: "#e8b80a",
  positionCore: "#f5f7fa",
  flowline: "#6b9eac",
  flowlineCompleted: "#e8b80a",
  highlight: "#e8b80a",
  highlightSelected: "#fff1a8",
  collectibleVisited: "#e8b80a",
  collectibleUnvisited: "#315b68",
  collectibleUnvisitedRing: "#7fbad0"
});
