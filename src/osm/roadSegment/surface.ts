/**
 * Canonical, reusable road-cycling surface model.
 *
 * This is the single source of truth for how an OSM `surface` tag maps to road-cycling
 * suitability. Raw OSM surface strings must not be compared ad hoc elsewhere in the codebase;
 * import {@link classifyRoadSurface} (rich 6-level model) or {@link classifyRoadCyclingSurface}
 * (legacy 4-level compatibility view) instead.
 */

export type RoadSurfaceClass =
  | "EXCELLENT"
  | "GOOD"
  | "ACCEPTABLE"
  | "UNKNOWN"
  | "BAD"
  | "FORBIDDEN";

/** Legacy 4-level view retained for existing callers/tests. */
export type RoadSurfaceSuitability = "GOOD" | "ACCEPTABLE" | "UNKNOWN" | "BAD";

const EXCELLENT_SURFACES = new Set(["asphalt"]);
const GOOD_SURFACES = new Set(["concrete", "concrete:lanes", "chipseal", "tared", "tarmac"]);
const ACCEPTABLE_SURFACES = new Set(["paved"]);
/** Rough but potentially traversable on a road bike with discomfort; rejected for V1 publication. */
const BAD_SURFACES = new Set([
  "unpaved", "gravel", "fine_gravel", "compacted", "pebblestone", "sett", "cobblestone",
  "cobblestone:flattened", "cobblestone_flatened", "unhewn_cobblestone", "paving_stones",
  "paving_stones:lanes", "concrete:plates", "concrete_plates", "plates", "rock", "clay", "dirt"
]);
/** Clearly unusable for road cycling. */
const FORBIDDEN_SURFACES = new Set([
  "ground", "earth", "mud", "sand", "grass", "grass_paver", "woodchips", "wood"
]);

/** Suitability ordering, worst to best; used for compound-tag resolution (worst constituent wins). */
const RANK: Record<RoadSurfaceClass, number> = {
  FORBIDDEN: 0,
  BAD: 1,
  UNKNOWN: 2,
  ACCEPTABLE: 3,
  GOOD: 4,
  EXCELLENT: 5
};

const surfaceParts = (value: string): string[] =>
  value.split(/[;,]/).map((part) => part.trim().toLowerCase()).filter(Boolean);

const classifyPart = (part: string): RoadSurfaceClass => {
  if (FORBIDDEN_SURFACES.has(part)) return "FORBIDDEN";
  if (BAD_SURFACES.has(part)) return "BAD";
  if (EXCELLENT_SURFACES.has(part)) return "EXCELLENT";
  if (GOOD_SURFACES.has(part)) return "GOOD";
  if (ACCEPTABLE_SURFACES.has(part)) return "ACCEPTABLE";
  return "UNKNOWN";
};

/** Rich 6-level classification of an OSM `surface` tag; compound tags resolve to their worst part. */
export const classifyRoadSurface = (surface: string | undefined): RoadSurfaceClass => {
  if (!surface?.trim()) return "UNKNOWN";
  const parts = surfaceParts(surface);
  if (parts.length === 0) return "UNKNOWN";
  return parts
    .map(classifyPart)
    .reduce((worst, current) => (RANK[current] < RANK[worst] ? current : worst));
};

/** True for surfaces that must never carry a road-cycling segment. */
export const isForbiddenRoadSurface = (surface: string | undefined): boolean =>
  classifyRoadSurface(surface) === "FORBIDDEN";

/**
 * Legacy 4-level view. EXCELLENT collapses to GOOD and FORBIDDEN collapses to BAD so historical
 * scoring/behaviour and existing tests remain unchanged.
 */
export const classifyRoadCyclingSurface = (surface: string | undefined): RoadSurfaceSuitability => {
  switch (classifyRoadSurface(surface)) {
    case "EXCELLENT":
    case "GOOD":
      return "GOOD";
    case "ACCEPTABLE":
      return "ACCEPTABLE";
    case "BAD":
    case "FORBIDDEN":
      return "BAD";
    default:
      return "UNKNOWN";
  }
};
