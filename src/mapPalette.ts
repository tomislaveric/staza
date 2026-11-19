/**
 * Colors of the Staza overlays drawn on top of the basemap: routes, Flowlines, position and
 * collectible markers. Served with `/api/world/basemap` so native clients draw maps exactly like
 * the web, which uses the identical copy in `public/components/shared/map/staza-map-palette.js`.
 */
export const STAZA_MAP_PALETTE = {
  casing: "#0b0c0f",
  questRoute: "#e8b80a",
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
} as const;

export type StazaMapPalette = typeof STAZA_MAP_PALETTE;
