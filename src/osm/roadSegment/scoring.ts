/**
 * Deterministic road-cycling segment quality scoring.
 *
 * Produces independent 0..100 style scores (flow, endurance, explore) plus a roadQuality score and
 * a 0..1 dataConfidence. Scores are not mutually exclusive: a segment can score highly in several.
 * Flow is delegated to the canonical Flowline quality calculation (its historical authority);
 * endurance/explore/roadQuality are computed here from the shared feature model via named weights.
 *
 * No LLM classification, no per-user personalization, no magic numbers inline: every weight and
 * curve is a named constant below so scores stay reproducible and inspectable.
 */

import type { FartlekCandidate } from "../fartlekModel.js";
import {
  extractRoadCyclingSegmentFeatures,
  type RoadCyclingSegmentFeatures
} from "./features.js";
import type { RoadSurfaceClass } from "./surface.js";
import type { RoadSmoothnessClass } from "./smoothness.js";

/** Integer scoring version persisted with each segment; bump when formulas/features/weights change. */
export const SEGMENT_SCORING_VERSION = 1;

export interface SegmentQualityScores {
  flow: number;
  endurance: number;
  explore: number;
  roadQuality: number;
  /** 0..1 confidence that the underlying map data is complete enough to trust the scores. */
  dataConfidence: number;
}

/** Named weights for the endurance scorer (components sum to 100). */
export const ENDURANCE_WEIGHTS = {
  surface: 24,
  length: 26,
  continuity: 20,
  lowJunctions: 12,
  lowTrafficControls: 12,
  nonUrban: 6
} as const;

/** Named weights for the explore scorer (components sum to 100). Phase 1 is intentionally coarse. */
export const EXPLORE_WEIGHTS = {
  nonUrban: 50,
  lowTrafficContext: 20,
  ruralSpeedEvidence: 15,
  cyclewayCorridor: 15
} as const;

/** Named weights for the intrinsic roadQuality scorer (components sum to 100). */
export const ROAD_QUALITY_WEIGHTS = {
  surface: 45,
  smoothness: 25,
  access: 20,
  metadata: 10
} as const;

/** Endurance length preference: full credit across ~5–30 km, tapering outside (not a hard limit). */
export const ENDURANCE_IDEAL_MIN_M = 5_000;
export const ENDURANCE_IDEAL_MAX_M = 30_000;

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));

const SURFACE_QUALITY: Record<RoadSurfaceClass, number> = {
  EXCELLENT: 1, GOOD: 0.92, ACCEPTABLE: 0.72, UNKNOWN: 0.4, BAD: 0, FORBIDDEN: 0
};
const SMOOTHNESS_QUALITY: Record<RoadSmoothnessClass, number> = {
  excellent: 1, good: 0.92, intermediate: 0.68, unknown: 0.55,
  bad: 0.15, very_bad: 0.05, horrible: 0, very_horrible: 0, impassable: 0
};

/** Triangular length-preference curve: 1.0 inside [idealMin, idealMax], linear taper to 0 outside. */
const lengthPreference = (
  lengthM: number,
  idealMin: number,
  idealMax: number,
  taperBelow: number,
  taperAbove: number
): number => {
  if (lengthM >= idealMin && lengthM <= idealMax) return 1;
  if (lengthM < idealMin) return clamp((lengthM - taperBelow) / (idealMin - taperBelow), 0, 1);
  return clamp(1 - (lengthM - idealMax) / taperAbove, 0, 1);
};

/** 1.0 at zero density, decaying toward 0 as per-km interruptions rise past `halfAt`. */
const lowDensityScore = (perKm: number, halfAt: number): number => clamp(halfAt / (halfAt + perKm), 0, 1);

const continuityScore = (features: RoadCyclingSegmentFeatures): number => {
  let score = 1;
  score -= Math.min(0.5, features.roadClassChanges * 0.2);
  score -= Math.min(0.4, features.surfaceChanges * 0.2);
  if (!features.nameContinuity && !features.refContinuity) score -= 0.15;
  return clamp(score, 0, 1);
};

/** Intrinsic road-bike quality, independent of ride style. */
export const scoreRoadQuality = (features: RoadCyclingSegmentFeatures): number => {
  if (!features.eligibility.eligible) return 0;
  const surface = SURFACE_QUALITY[features.surfaceClass];
  const smoothness = SMOOTHNESS_QUALITY[features.smoothnessClass];
  const access = clamp(
    features.bicycleAccess === "allowed" || features.generalAccess === "allowed" ? 1
      : features.generalAccess === "destination" ? 0.7
        : 0.55, 0, 1);
  return Math.round(
    ROAD_QUALITY_WEIGHTS.surface * surface +
    ROAD_QUALITY_WEIGHTS.smoothness * smoothness +
    ROAD_QUALITY_WEIGHTS.access * access +
    ROAD_QUALITY_WEIGHTS.metadata * features.metadataCompleteness
  );
};

/**
 * Endurance: sustained, efficient riding over long distance. Emphasizes length and continuity
 * rather than the dynamic low-interruption character that flow rewards — a segment can score
 * highly in both without one being a length-shifted copy of the other.
 */
export const scoreEndurance = (features: RoadCyclingSegmentFeatures): number => {
  if (!features.eligibility.eligible) return 0;
  const surface = SURFACE_QUALITY[features.surfaceClass];
  const length = lengthPreference(features.lengthM, ENDURANCE_IDEAL_MIN_M, ENDURANCE_IDEAL_MAX_M, 1_000, 40_000);
  const continuity = continuityScore(features);
  const lowJunctions = lowDensityScore(features.junctionDensityPerKm, 2);
  const lowTrafficControls = lowDensityScore(features.trafficControlDensityPerKm, 1.5);
  return clamp(Math.round(
    ENDURANCE_WEIGHTS.surface * surface +
    ENDURANCE_WEIGHTS.length * length +
    ENDURANCE_WEIGHTS.continuity * continuity +
    ENDURANCE_WEIGHTS.lowJunctions * lowJunctions +
    ENDURANCE_WEIGHTS.lowTrafficControls * lowTrafficControls +
    ENDURANCE_WEIGHTS.nonUrban * features.nonUrbanRatio
  ));
};

/**
 * Explore: scenic / interesting corridor character. Phase 1 uses only reliable signals already in
 * the extract (non-urban evidence, low traffic context, rural speed, dedicated cycleway corridors).
 * It deliberately does NOT infer scenic value from highway class, and is expected to mature once
 * POI/elevation context enrichment lands. Lower confidence than flow/endurance is expected.
 */
export const scoreExplore = (features: RoadCyclingSegmentFeatures): number => {
  if (!features.eligibility.eligible) return 0;
  const lowTrafficContext = (
    lowDensityScore(features.junctionDensityPerKm, 3) +
    lowDensityScore(features.trafficControlDensityPerKm, 2)
  ) / 2;
  const ruralSpeedEvidence = features.maxspeed !== undefined && features.maxspeed >= 60 ? 1 : 0;
  const cyclewayCorridor = features.cyclewayFlag ? 1 : 0;
  return clamp(Math.round(
    EXPLORE_WEIGHTS.nonUrban * features.nonUrbanRatio +
    EXPLORE_WEIGHTS.lowTrafficContext * lowTrafficContext +
    EXPLORE_WEIGHTS.ruralSpeedEvidence * ruralSpeedEvidence +
    EXPLORE_WEIGHTS.cyclewayCorridor * cyclewayCorridor
  ));
};

/**
 * Combined scorer. Flow and dataConfidence come from the canonical Flowline quality calculation so
 * flow stays byte-for-byte compatible with historical publication; the remaining scores are derived
 * from the shared feature model. Injected to avoid a circular import with the quality module.
 */
export const scoreRoadCyclingSegment = (
  candidate: FartlekCandidate,
  flow: { qualityScore: number; dataConfidence: number }
): SegmentQualityScores => {
  const features = extractRoadCyclingSegmentFeatures(candidate);
  const eligible = features.eligibility.eligible;
  return {
    flow: eligible ? flow.qualityScore : 0,
    endurance: scoreEndurance(features),
    explore: scoreExplore(features),
    roadQuality: scoreRoadQuality(features),
    dataConfidence: clamp(flow.dataConfidence, 0, 100) / 100
  };
};
