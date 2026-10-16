import {
  FARTLEK_IDEAL_MAX_LENGTH_METERS,
  FARTLEK_IDEAL_MIN_LENGTH_METERS,
  FARTLEK_MAX_LENGTH_METERS,
  FARTLEK_MIN_LENGTH_METERS,
  type FartlekCandidate
} from "./fartlekModel.js";

export type RoadSurfaceSuitability = "GOOD" | "ACCEPTABLE" | "UNKNOWN" | "BAD";
export type RoadSmoothnessSuitability = "GOOD" | "ACCEPTABLE" | "UNKNOWN" | "BAD";

export const ROAD_CYCLING_MIN_QUALITY_SCORE = 80;
export const ROAD_CYCLING_MIN_DATA_CONFIDENCE = 70;
const MAX_LINK_CONNECTOR_LENGTH_METERS = 300;
const MAX_LINK_CONNECTOR_CANDIDATE_FRACTION = 0.2;

const GOOD_SURFACES = new Set(["asphalt", "concrete", "concrete:lanes", "chipseal", "tared"]);
const ACCEPTABLE_SURFACES = new Set(["paved"]);
const BAD_SURFACES = new Set([
  "unpaved", "gravel", "fine_gravel", "compacted", "dirt", "ground", "earth", "mud", "sand",
  "grass", "grass_paver", "woodchips", "wood", "pebblestone", "sett", "cobblestone",
  "cobblestone:flattened", "cobblestone_flatened", "unhewn_cobblestone", "paving_stones",
  "paving_stones:lanes", "concrete:plates", "concrete_plates", "plates", "rock", "clay"
]);
const BAD_SMOOTHNESS = new Set(["bad", "very_bad", "horrible", "very_horrible", "impassable", "poor"]);
const GOOD_SMOOTHNESS = new Set(["excellent", "very_good", "good"]);
const ACCEPTABLE_SMOOTHNESS = new Set(["intermediate"]);
const BICYCLE_ALLOWED = new Set(["yes", "designated", "permissive", "official", "optional_sidepath"]);
const ACCESS_ALLOWED = new Set(["yes", "all", "designated", "permissive"]);
const RESTRICTED_ACCESS = new Set([
  "agricultural", "forestry", "customers", "permit", "military", "restricted", "emergency"
]);
const RESTRICTED_BICYCLE = new Set(["no", "private", "destination", "customers", "permit", "dismount", "discouraged"]);

const normalizeTag = (value: string | undefined): string | undefined =>
  value?.trim().toLowerCase() || undefined;

const surfaceParts = (value: string): string[] =>
  value.split(/[;,]/).map((part) => part.trim().toLowerCase()).filter(Boolean);

export const classifyRoadCyclingSurface = (surface: string | undefined): RoadSurfaceSuitability => {
  if (!surface?.trim()) return "UNKNOWN";
  const parts = surfaceParts(surface);
  if (parts.length === 0) return "UNKNOWN";
  if (parts.some((part) => BAD_SURFACES.has(part))) return "BAD";
  if (parts.every((part) => GOOD_SURFACES.has(part))) return "GOOD";
  if (parts.every((part) => GOOD_SURFACES.has(part) || ACCEPTABLE_SURFACES.has(part))) {
    return "ACCEPTABLE";
  }
  return "UNKNOWN";
};

export const classifyRoadCyclingSmoothness = (
  smoothness: string | undefined
): RoadSmoothnessSuitability => {
  const value = normalizeTag(smoothness);
  if (!value) return "UNKNOWN";
  if (BAD_SMOOTHNESS.has(value)) return "BAD";
  if (GOOD_SMOOTHNESS.has(value)) return "GOOD";
  if (ACCEPTABLE_SMOOTHNESS.has(value)) return "ACCEPTABLE";
  return "UNKNOWN";
};

export interface RoadCyclingAccessResult {
  allowed: boolean;
  confidence: number;
  reason?: string;
}

/** Evaluates access in the context of the way type; `use_sidepath` only rejects carriageways. */
export const isRoadCyclingAccessible = (tags: Record<string, string>): RoadCyclingAccessResult => {
  const highway = normalizeTag(tags.highway);
  const access = normalizeTag(tags.access);
  const bicycle = normalizeTag(tags.bicycle);

  if (access === "no") return { allowed: false, confidence: 100, reason: "REJECT_ACCESS_NO" };
  if (access === "private") return { allowed: false, confidence: 100, reason: "REJECT_PRIVATE_ACCESS" };
  if (RESTRICTED_ACCESS.has(access ?? "")) {
    return { allowed: false, confidence: 90, reason: "REJECT_RESTRICTED_ACCESS" };
  }
  if (bicycle === "no") return { allowed: false, confidence: 100, reason: "REJECT_BICYCLE_FORBIDDEN" };
  if (bicycle === "use_sidepath" && highway !== "cycleway") {
    return { allowed: false, confidence: 100, reason: "REJECT_BICYCLE_USE_SIDEPATH" };
  }
  if (bicycle === "use_sidepath" && highway === "cycleway") {
    return { allowed: true, confidence: 55 };
  }
  if (RESTRICTED_BICYCLE.has(bicycle ?? "")) {
    return { allowed: false, confidence: 90, reason: "REJECT_BICYCLE_RESTRICTED" };
  }
  if (access === "destination" && !BICYCLE_ALLOWED.has(bicycle ?? "")) {
    return { allowed: false, confidence: 100, reason: "REJECT_DESTINATION_ACCESS" };
  }
  if (BICYCLE_ALLOWED.has(bicycle ?? "") || ACCESS_ALLOWED.has(access ?? "")) {
    return { allowed: true, confidence: 96 };
  }
  if (access === "destination") return { allowed: true, confidence: 76 };
  if (access || bicycle) return { allowed: false, confidence: 35, reason: "REJECT_UNKNOWN_ACCESS" };
  return { allowed: true, confidence: 62 };
};

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

const linkOnly = (tagsBySegment: Record<string, string>[]): boolean =>
  tagsBySegment.length > 0 && tagsBySegment.every((tags) => normalizeTag(tags.highway)?.endsWith("_link"));

const linkDominatesCandidate = (candidate: FartlekCandidate): boolean => {
  const hasLink = candidate.tagsBySegment.some((tags) => normalizeTag(tags.highway)?.endsWith("_link"));
  return hasLink &&
    (candidate.linkLengthMeters ?? 0) >
      Math.min(MAX_LINK_CONNECTOR_LENGTH_METERS, candidate.lengthMeters * MAX_LINK_CONNECTOR_CANDIDATE_FRACTION);
};

const hasUnclassifiedWithoutEvidence = (tagsBySegment: Record<string, string>[]): boolean =>
  tagsBySegment.some((tags) =>
    normalizeTag(tags.highway) === "unclassified" &&
    !tags.surface?.trim() &&
    !tags.smoothness?.trim()
  );

const cyclewayHasEvidence = (tagsBySegment: Record<string, string>[]): boolean =>
  tagsBySegment.every((tags) => {
    if (normalizeTag(tags.highway) !== "cycleway") return true;
    const surface = normalizeTag(tags.surface);
    return surface !== undefined &&
      ["asphalt", "paved", "concrete"].includes(surface) &&
      classifyRoadCyclingSurface(surface) !== "BAD";
  });

const candidateHardRejection = (candidate: FartlekCandidate): string | undefined => {
  if (candidate.coordinates.length < 2) return "REJECT_MALFORMED_GEOMETRY";
  if (candidate.lengthMeters < FARTLEK_MIN_LENGTH_METERS) return "REJECT_TOO_SHORT";
  if (linkOnly(candidate.tagsBySegment)) return "REJECT_LINK_STANDALONE";
  for (const tags of candidate.tagsBySegment) {
    if (!["primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link",
      "unclassified", "cycleway"].includes(normalizeTag(tags.highway) ?? "")) {
      return "REJECT_UNSUITABLE_HIGHWAY";
    }
    const surface = classifyRoadCyclingSurface(tags.surface);
    if (surface === "BAD") return "REJECT_BAD_SURFACE";
    if (classifyRoadCyclingSmoothness(tags.smoothness) === "BAD") return "REJECT_BAD_SMOOTHNESS";
    const access = isRoadCyclingAccessible(tags);
    if (!access.allowed) return access.reason ?? "REJECT_ACCESS";
  }
  if (linkDominatesCandidate(candidate)) return "REJECT_LINK_DOMINATED";
  if (hasUnclassifiedWithoutEvidence(candidate.tagsBySegment)) return "REJECT_LOW_CONFIDENCE_UNCLASSIFIED";
  if (!cyclewayHasEvidence(candidate.tagsBySegment)) return "REJECT_CYCLEWAY_SURFACE_EVIDENCE";
  return undefined;
};

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
  qualityScore: number;
  dataConfidence: number;
  reasons: string[];
  rejectionReason?: string;
}

/** Hard-invalid candidates are rejected before quality or confidence can permit publication. */
export const calculateRoadCyclingFlowlineQuality = (
  candidate: FartlekCandidate
): RoadCyclingFlowlineQuality => {
  const rejectionReason = candidateHardRejection(candidate);
  if (rejectionReason) {
    return {
      qualityScore: 0,
      dataConfidence: calculateRoadCyclingFlowlineDataConfidence(candidate),
      reasons: [rejectionReason],
      rejectionReason
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
  return { qualityScore: score, dataConfidence, reasons };
};

export const shouldPublishRoadCyclingFlowline = (
  quality: Pick<RoadCyclingFlowlineQuality, "qualityScore" | "dataConfidence" | "rejectionReason">
): boolean =>
  !quality.rejectionReason &&
  quality.qualityScore >= ROAD_CYCLING_MIN_QUALITY_SCORE &&
  quality.dataConfidence >= ROAD_CYCLING_MIN_DATA_CONFIDENCE;

/** Chain join guard: do not join across material surface, smoothness, access, or road-class changes. */
export const roadCyclingCompatibilityKey = (tags: Record<string, string>): string => [
  classifyRoadCyclingSurface(tags.surface),
  classifyRoadCyclingSmoothness(tags.smoothness),
  normalizeTag(tags.highway)?.replace(/_link$/, ""),
  normalizeTag(tags.access) === "destination" ? "destination" :
    RESTRICTED_ACCESS.has(normalizeTag(tags.access) ?? "") ? "restricted" :
      normalizeTag(tags.access) ? "explicit" : "default",
  normalizeTag(tags.bicycle) === "use_sidepath" || RESTRICTED_BICYCLE.has(normalizeTag(tags.bicycle) ?? "")
    ? "restricted"
    : BICYCLE_ALLOWED.has(normalizeTag(tags.bicycle) ?? "")
      ? "explicit"
      : normalizeTag(tags.bicycle) ?? "default"
].join("|");
