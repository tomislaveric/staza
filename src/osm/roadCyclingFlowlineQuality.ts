import {
  FARTLEK_IDEAL_MAX_LENGTH_METERS,
  FARTLEK_IDEAL_MIN_LENGTH_METERS,
  FARTLEK_MAX_LENGTH_METERS,
  FARTLEK_MIN_LENGTH_METERS,
  type FartlekCandidate
} from "./fartlekModel.js";
import {
  classifyRoadCyclingSurface,
  type RoadSurfaceSuitability
} from "./roadSegment/surface.js";
import {
  classifyRoadCyclingSmoothness,
  type RoadSmoothnessSuitability
} from "./roadSegment/smoothness.js";
import {
  evaluateRoadCyclingEligibility,
  isRoadCyclingAccessible,
  normalizeTag,
  roadCyclingCompatibilityKey,
  roadCyclingRejectionReason,
  type RoadCyclingAccessResult
} from "./roadSegment/eligibility.js";
import { scoreRoadCyclingSegment, type SegmentQualityScores } from "./roadSegment/scoring.js";

// Re-exported so existing importers keep a single, stable entry point while the canonical
// definitions now live in the reusable `roadSegment/` model.
export {
  classifyRoadCyclingSurface,
  classifyRoadCyclingSmoothness,
  isRoadCyclingAccessible,
  roadCyclingCompatibilityKey,
  evaluateRoadCyclingEligibility
};
export type { RoadSurfaceSuitability, RoadSmoothnessSuitability, RoadCyclingAccessResult };

export const ROAD_CYCLING_MIN_QUALITY_SCORE = 80;
export const ROAD_CYCLING_MIN_DATA_CONFIDENCE = 70;

const highwayClassConfidence = (highway: string | undefined): number => {
  switch (highway) {
    case "primary":
      return 78;
    case "secondary":
      return 72;
    case "tertiary":
      return 65;
    case "unclassified":
      return 38;
    default:
      return 0;
  }
};

const surfaceConfidence = (tags: Record<string, string>): number => {
  const surface = classifyRoadCyclingSurface(tags.surface);
  if (surface === "BAD") return 0;
  if (surface === "GOOD") return 96;
  if (surface === "ACCEPTABLE") return 82;
  if (tags.surface) return 30;
  return highwayClassConfidence(normalizeTag(tags.highway));
};

const smoothnessConfidence = (tags: Record<string, string>): number => {
  const smoothness = classifyRoadCyclingSmoothness(tags.smoothness);
  if (smoothness === "GOOD") return 95;
  if (smoothness === "ACCEPTABLE") return 84;
  if (smoothness === "BAD") return 0;
  return tags.smoothness ? 35 : 60;
};

const numericMaxspeed = (value: string | undefined): number | undefined => {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*(?:km\/?h)?$/i);
  return match ? Number(match[1]) : undefined;
};

const average = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const surfaceQualityPoints = (tags: Record<string, string>): number => {
  switch (classifyRoadCyclingSurface(tags.surface)) {
    case "GOOD":
      return 30;
    case "ACCEPTABLE":
      return 24;
    case "BAD":
      return 0;
    case "UNKNOWN":
      if (tags.surface) return 8;
      switch (normalizeTag(tags.highway)) {
        case "primary":
          return 24;
        case "secondary":
          return 21;
        case "tertiary":
          return 18;
        default:
          return 0;
      }
  }
};

const accessQualityPoints = (tagsBySegment: Record<string, string>[]): number =>
  average(tagsBySegment.map((tags) => {
    const result = isRoadCyclingAccessible(tags);
    if (!result.allowed) return 0;
    if (result.confidence >= 90) return 15;
    return 12;
  }));

const lengthQualityPoints = (length: number): number => {
  if (length >= FARTLEK_IDEAL_MIN_LENGTH_METERS && length <= FARTLEK_IDEAL_MAX_LENGTH_METERS) return 12;
  if (length >= FARTLEK_MIN_LENGTH_METERS && length < FARTLEK_IDEAL_MIN_LENGTH_METERS) return 10;
  if (length <= FARTLEK_MAX_LENGTH_METERS) return 6;
  return 3;
};

const interruptionQualityPoints = (count: number, length: number): number => {
  const perKm = count / Math.max(length / 1_000, 0.001);
  if (perKm < 1) return 8;
  if (perKm < 3) return 5;
  return 1;
};

const highwayQualityPoints = (tagsBySegment: Record<string, string>[]): number =>
  average(tagsBySegment.map((tags) => {
    switch (normalizeTag(tags.highway)) {
      case "primary":
      case "cycleway":
        return 5;
      case "secondary":
      case "tertiary":
        return 4;
      case "unclassified":
        return 3;
      default:
        return 1;
    }
  }));

const maxspeedQualityPoints = (tagsBySegment: Record<string, string>[]): number => {
  const speeds = tagsBySegment.map((tags) => numericMaxspeed(tags.maxspeed)).filter((value): value is number =>
    value !== undefined);
  if (!speeds.length) return 3;
  const speed = average(speeds);
  if (speed <= 60) return 5;
  if (speed <= 80) return 3;
  if (speed <= 100) return 2;
  return 1;
};

export const calculateRoadCyclingFlowlineDataConfidence = (candidate: FartlekCandidate): number => {
  const tagsBySegment = candidate.tagsBySegment;
  if (!tagsBySegment.length) return 0;
  const perWay = tagsBySegment.map((tags) =>
    surfaceConfidence(tags) * 0.5 +
    smoothnessConfidence(tags) * 0.2 +
    isRoadCyclingAccessible(tags).confidence * 0.2 +
    (tags.ref || tags.name || candidate.name ? 95 : 55) * 0.1
  );
  const profileConsistency = new Set(tagsBySegment.map((tags) => roadCyclingCompatibilityKey(tags))).size === 1
    ? 100
    : 60;
  return Math.round(average(perWay) * 0.9 + profileConsistency * 0.1);
};

export interface RoadCyclingFlowlineQuality {
  /** Flow score (0..100); historically the single "suitability" score. */
  qualityScore: number;
  dataConfidence: number;
  reasons: string[];
  rejectionReason?: string;
  /** Full independent score set (flow/endurance/explore/roadQuality + dataConfidence 0..1). */
  scores: SegmentQualityScores;
}

/** Hard-invalid candidates are rejected before quality or confidence can permit publication. */
export const calculateRoadCyclingFlowlineQuality = (
  candidate: FartlekCandidate
): RoadCyclingFlowlineQuality => {
  const rejectionReason = roadCyclingRejectionReason(candidate);
  if (rejectionReason) {
    const dataConfidence = calculateRoadCyclingFlowlineDataConfidence(candidate);
    return {
      qualityScore: 0,
      dataConfidence,
      reasons: [rejectionReason],
      rejectionReason,
      scores: scoreRoadCyclingSegment(candidate, { qualityScore: 0, dataConfidence })
    };
  }

  const tags = candidate.tagsBySegment;
  const distinctProfiles = new Set(tags.map((segment) => [
    classifyRoadCyclingSurface(segment.surface),
    classifyRoadCyclingSmoothness(segment.smoothness),
    normalizeTag(segment.highway),
    normalizeTag(segment.access),
    normalizeTag(segment.bicycle)
  ].join("|")));
  const continuityPoints = tags.length <= 1 ? 15 : distinctProfiles.size === 1 ? 15 : 10;
  const priorityRoadValues = tags.map((segment) => normalizeTag(segment.priority_road));
  const priorityRoadPenalty = priorityRoadValues.some((value) => value === "designated" || value === "yes") ? 2 : 0;
  const surfacePoints = average(tags.map(surfaceQualityPoints));
  const smoothnessPoints = average(tags.map((segment) => {
    switch (classifyRoadCyclingSmoothness(segment.smoothness)) {
      case "GOOD":
        return 10;
      case "ACCEPTABLE":
        return 7;
      case "UNKNOWN":
        return 6;
      case "BAD":
        return 0;
    }
  }));
  const junctionPoints = interruptionQualityPoints(candidate.junctionCount, candidate.lengthMeters);
  const controlPoints = interruptionQualityPoints(candidate.trafficControlCount, candidate.lengthMeters);
  const nameIdentities = new Set(tags.map((segment) => segment.ref ?? segment.name).filter(Boolean));
  const namePoints = nameIdentities.size === 1 || candidate.name ? 3 : 0;
  const urbanPoints = candidate.mostlyNonUrban ? 2 : 0;
  const interruptionPoints = (junctionPoints + controlPoints) / 2;
  const score = Math.max(0, Math.min(100, Math.round(
    surfacePoints + accessQualityPoints(tags) + continuityPoints + lengthQualityPoints(candidate.lengthMeters) +
    interruptionPoints + highwayQualityPoints(tags) + maxspeedQualityPoints(tags) +
    smoothnessPoints / 2 + namePoints + urbanPoints - priorityRoadPenalty
  )));
  const dataConfidence = calculateRoadCyclingFlowlineDataConfidence(candidate);
  const reasons = [
    `SURFACE_${classifyRoadCyclingSurface(tags[0]?.surface)}`,
    `SMOOTHNESS_${classifyRoadCyclingSmoothness(tags[0]?.smoothness)}`,
    `ACCESS_CONFIDENCE_${Math.round(average(tags.map((segment) => isRoadCyclingAccessible(segment).confidence)))}`,
    `CONTINUITY_${distinctProfiles.size === 1 ? "CONSISTENT" : "MIXED"}`,
    `INTERRUPTIONS_${interruptionPoints >= 7 ? "LOW" : interruptionPoints >= 4 ? "MODERATE" : "HIGH"}`,
    `MAXSPEED_${maxspeedQualityPoints(tags) >= 5 ? "LOW" : maxspeedQualityPoints(tags) >= 3 ? "MODERATE" : "HIGH"}`,
    `QUALITY_SCORE_${score}`,
    `DATA_CONFIDENCE_${dataConfidence}`
  ];
  if (priorityRoadPenalty) reasons.push("PRIORITY_ROAD_TRAFFIC_CONTEXT_PENALTY");
  return {
    qualityScore: score,
    dataConfidence,
    reasons,
    scores: scoreRoadCyclingSegment(candidate, { qualityScore: score, dataConfidence })
  };
};

export const shouldPublishRoadCyclingFlowline = (
  quality: Pick<RoadCyclingFlowlineQuality, "qualityScore" | "dataConfidence" | "rejectionReason">
): boolean =>
  !quality.rejectionReason &&
  quality.qualityScore >= ROAD_CYCLING_MIN_QUALITY_SCORE &&
  quality.dataConfidence >= ROAD_CYCLING_MIN_DATA_CONFIDENCE;
