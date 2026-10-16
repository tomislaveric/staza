/**
 * Normalized road-cycling segment feature extraction.
 *
 * Features are computed once from a {@link FartlekCandidate} and consumed by every scorer, so no
 * scorer recomputes raw-tag math. Only robust, reliably-present signals are implemented here
 * (Phase 1); the interface is intentionally open for later additions (curvature, elevation,
 * urban-polygon ratio, POI proximity) without changing the scorer contract.
 */

import type { FartlekCandidate } from "../fartlekModel.js";
import { classifyRoadSurface, type RoadSurfaceClass } from "./surface.js";
import { classifyRoadSmoothness, type RoadSmoothnessClass } from "./smoothness.js";
import {
  BICYCLE_ALLOWED,
  evaluateRoadCyclingEligibility,
  isRoadCyclingAccessible,
  normalizeTag,
  roadCyclingCompatibilityKey,
  type RoadCyclingEligibility
} from "./eligibility.js";

export type BicycleAccess = "allowed" | "restricted" | "unknown";
export type GeneralAccess = "allowed" | "restricted" | "destination" | "unknown";

export interface RoadCyclingSegmentFeatures {
  eligibility: RoadCyclingEligibility;
  lengthM: number;
  highwayClass: string | undefined;
  /** Worst surface class across contributing ways (worst constituent governs suitability). */
  surfaceClass: RoadSurfaceClass;
  /** Worst smoothness class across contributing ways. */
  smoothnessClass: RoadSmoothnessClass;
  bicycleAccess: BicycleAccess;
  generalAccess: GeneralAccess;
  maxspeed: number | undefined;
  priorityRoad: boolean;
  lit: boolean;
  junctionCount: number;
  junctionDensityPerKm: number;
  trafficControlCount: number;
  trafficControlDensityPerKm: number;
  cityLimitCrossings: number;
  nameContinuity: boolean;
  refContinuity: boolean;
  roadClassChanges: number;
  surfaceChanges: number;
  cyclewayFlag: boolean;
  /** 0..1 fraction of surface/smoothness/access/name tags present across contributing ways. */
  metadataCompleteness: number;
  /** 0..1 heuristic non-urban fraction; derived from the candidate's existing evidence flag. */
  nonUrbanRatio: number;
}

const average = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const numericMaxspeed = (value: string | undefined): number | undefined => {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*(?:km\/?h)?$/i);
  return match ? Number(match[1]) : undefined;
};

const SURFACE_RANK: Record<RoadSurfaceClass, number> = {
  FORBIDDEN: 0, BAD: 1, UNKNOWN: 2, ACCEPTABLE: 3, GOOD: 4, EXCELLENT: 5
};
const SMOOTHNESS_RANK: Record<RoadSmoothnessClass, number> = {
  impassable: 0, very_horrible: 1, horrible: 2, very_bad: 3, bad: 4,
  unknown: 5, intermediate: 6, good: 7, excellent: 8
};

const worstSurface = (tags: Record<string, string>[]): RoadSurfaceClass =>
  tags.map((segment) => classifyRoadSurface(segment.surface))
    .reduce<RoadSurfaceClass>((worst, current) =>
      SURFACE_RANK[current] < SURFACE_RANK[worst] ? current : worst, "EXCELLENT");

const worstSmoothness = (tags: Record<string, string>[]): RoadSmoothnessClass =>
  tags.map((segment) => classifyRoadSmoothness(segment.smoothness))
    .reduce<RoadSmoothnessClass>((worst, current) =>
      SMOOTHNESS_RANK[current] < SMOOTHNESS_RANK[worst] ? current : worst, "excellent");

const bicycleAccessOf = (tags: Record<string, string>[]): BicycleAccess => {
  const values = tags.map((segment) => normalizeTag(segment.bicycle));
  if (values.some((value) => value !== undefined && !BICYCLE_ALLOWED.has(value) && value !== "use_sidepath")) {
    return "restricted";
  }
  if (values.some((value) => value !== undefined && BICYCLE_ALLOWED.has(value))) return "allowed";
  return "unknown";
};

const generalAccessOf = (tags: Record<string, string>[]): GeneralAccess => {
  const values = tags.map((segment) => normalizeTag(segment.access));
  if (values.some((value) => value === "destination")) return "destination";
  if (values.some((value) => value === "no" || value === "private")) return "restricted";
  if (values.some((value) => value === "yes" || value === "designated" || value === "permissive")) {
    return "allowed";
  }
  return "unknown";
};

const distinctCount = <T>(values: T[]): number => new Set(values).size;

const metadataCompletenessOf = (tags: Record<string, string>[]): number => {
  if (!tags.length) return 0;
  const present = tags.map((segment) =>
    (segment.surface?.trim() ? 1 : 0) +
    (segment.smoothness?.trim() ? 1 : 0) +
    (segment.access?.trim() || segment.bicycle?.trim() ? 1 : 0) +
    (segment.name?.trim() || segment.ref?.trim() ? 1 : 0)
  );
  return average(present) / 4;
};

/** Extracts the normalized, scorer-facing feature set from a candidate. */
export const extractRoadCyclingSegmentFeatures = (
  candidate: FartlekCandidate
): RoadCyclingSegmentFeatures => {
  const tags = candidate.tagsBySegment.length ? candidate.tagsBySegment : [{}];
  const lengthKm = Math.max(candidate.lengthMeters / 1_000, 0.001);
  const highwayBases = tags.map((segment) => normalizeTag(segment.highway)?.replace(/_link$/, ""));
  const speeds = tags.map((segment) => numericMaxspeed(segment.maxspeed))
    .filter((value): value is number => value !== undefined);

  return {
    eligibility: evaluateRoadCyclingEligibility(candidate),
    lengthM: candidate.lengthMeters,
    highwayClass: normalizeTag(tags[0]?.highway),
    surfaceClass: worstSurface(tags),
    smoothnessClass: worstSmoothness(tags),
    bicycleAccess: bicycleAccessOf(tags),
    generalAccess: generalAccessOf(tags),
    maxspeed: speeds.length ? average(speeds) : undefined,
    priorityRoad: tags.some((segment) => {
      const value = normalizeTag(segment.priority_road);
      return value === "designated" || value === "yes";
    }),
    lit: tags.some((segment) => normalizeTag(segment.lit) === "yes"),
    junctionCount: candidate.junctionCount,
    junctionDensityPerKm: candidate.junctionCount / lengthKm,
    trafficControlCount: candidate.trafficControlCount,
    trafficControlDensityPerKm: candidate.trafficControlCount / lengthKm,
    cityLimitCrossings: candidate.hasClearBoundaries ? 2 : 0,
    nameContinuity: distinctCount(tags.map((segment) => segment.name).filter(Boolean)) <= 1,
    refContinuity: distinctCount(tags.map((segment) => segment.ref).filter(Boolean)) <= 1,
    roadClassChanges: Math.max(0, distinctCount(highwayBases) - 1),
    surfaceChanges: Math.max(0, distinctCount(tags.map((segment) => classifyRoadSurface(segment.surface))) - 1),
    cyclewayFlag: highwayBases.every((base) => base === "cycleway") && highwayBases.length > 0,
    metadataCompleteness: metadataCompletenessOf(tags),
    nonUrbanRatio: candidate.mostlyNonUrban ? 1 : 0
  };
};

/** Profile-consistency key count, used by confidence and continuity scoring. */
export const distinctSegmentProfiles = (tags: Record<string, string>[]): number =>
  new Set(tags.map(roadCyclingCompatibilityKey)).size;

export const averageAccessConfidence = (tags: Record<string, string>[]): number =>
  average(tags.map((segment) => isRoadCyclingAccessible(segment).confidence));
