/**
 * Canonical, reusable road-cycling smoothness model.
 *
 * Smoothness is a supporting signal; {@link ./surface surface} remains the dominant road-quality
 * indicator. Import {@link classifyRoadSmoothness} for the rich 9-level model or
 * {@link classifyRoadCyclingSmoothness} for the legacy 4-level suitability band.
 */

export type RoadSmoothnessClass =
  | "excellent"
  | "good"
  | "intermediate"
  | "bad"
  | "very_bad"
  | "horrible"
  | "very_horrible"
  | "impassable"
  | "unknown";

/** Legacy 4-level suitability band retained for existing callers/tests. */
export type RoadSmoothnessSuitability = "GOOD" | "ACCEPTABLE" | "UNKNOWN" | "BAD";

const CANONICAL: Record<string, RoadSmoothnessClass> = {
  excellent: "excellent",
  very_good: "good",
  good: "good",
  intermediate: "intermediate",
  bad: "bad",
  poor: "bad",
  very_bad: "very_bad",
  horrible: "horrible",
  very_horrible: "very_horrible",
  impassable: "impassable"
};

const normalize = (value: string | undefined): string | undefined =>
  value?.trim().toLowerCase() || undefined;

/** Rich 9-level classification of an OSM `smoothness` tag. */
export const classifyRoadSmoothness = (smoothness: string | undefined): RoadSmoothnessClass => {
  const value = normalize(smoothness);
  if (!value) return "unknown";
  return CANONICAL[value] ?? "unknown";
};

/**
 * Legacy 4-level band. excellent/good -> GOOD, intermediate -> ACCEPTABLE,
 * bad and worse -> BAD, missing/unrecognized -> UNKNOWN. Matches prior behaviour exactly.
 */
export const classifyRoadCyclingSmoothness = (
  smoothness: string | undefined
): RoadSmoothnessSuitability => {
  switch (classifyRoadSmoothness(smoothness)) {
    case "excellent":
    case "good":
      return "GOOD";
    case "intermediate":
      return "ACCEPTABLE";
    case "bad":
    case "very_bad":
    case "horrible":
    case "very_horrible":
    case "impassable":
      return "BAD";
    default:
      return "UNKNOWN";
  }
};
