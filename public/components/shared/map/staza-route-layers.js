import { STAZA_MAP_PALETTE } from "./staza-map-palette.js";
/**
 * Shared Staza route line vocabulary. A route reads as one deliberate Staza layer over any
 * basemap: a soft glow, a dark casing, and the accent line on top. The factory is
 * parameterized by source id and accent so the World quest route and the Activity Detail
 * route share styling conventions while staying visually distinct.
 */

const QUEST_ACCENT = STAZA_MAP_PALETTE.questRoute;
const CASING_COLOR = STAZA_MAP_PALETTE.casing;

const routeWidth = (scale) => ["interpolate", ["linear"], ["zoom"], 8, 2 * scale, 12, 3.5 * scale, 16, 6 * scale];

const routeLine = (sourceId, suffix, paint) => ({
  id: `${sourceId}-${suffix}`,
  type: "line",
  source: sourceId,
  layout: { "line-cap": "round", "line-join": "round" },
  paint
});

/** Glow, casing and line drawn in that order from a single source. */
export const stazaRouteLayers = (sourceId, {
  accent = QUEST_ACCENT,
  glowOpacity = 0.16,
  lineOpacity = 0.95,
  widthScale = 1
} = {}) => [
  routeLine(sourceId, "glow", {
    "line-color": accent,
    "line-opacity": glowOpacity,
    "line-blur": 4,
    "line-width": routeWidth(3.2 * widthScale)
  }),
  routeLine(sourceId, "casing", {
    "line-color": CASING_COLOR,
    "line-opacity": 0.75,
    "line-width": routeWidth(1.9 * widthScale)
  }),
  routeLine(sourceId, "line", {
    "line-color": accent,
    "line-opacity": lineOpacity,
    "line-width": routeWidth(1 * widthScale)
  })
];

/**
 * A subdued route used as context for the full historical activity: visible but secondary,
 * so the travelled segment and current position lead. Casing plus a muted line only.
 */
export const stazaSubduedRouteLayers = (sourceId, { color = STAZA_MAP_PALETTE.activityRouteSubdued, opacity = 0.5 } = {}) => [
  routeLine(sourceId, "casing", {
    "line-color": CASING_COLOR,
    "line-opacity": 0.5,
    "line-width": routeWidth(1.4)
  }),
  routeLine(sourceId, "line", {
    "line-color": color,
    "line-opacity": opacity,
    "line-width": routeWidth(0.7)
  })
];
