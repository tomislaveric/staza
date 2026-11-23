import type { FartlekCandidate } from "../fartlekModel.js";
import { normalizeTag } from "./eligibility.js";
import { classifyRoadCyclingSmoothness } from "./smoothness.js";
import { classifyRoadCyclingSurface } from "./surface.js";

export type RoadSpeed =
  | { kind: "known"; kmh: number }
  | { kind: "unknown" }
  | { kind: "unlimited" };

export const numericMaxspeed = (value: string | undefined): number | undefined => {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*(km\/?h|mph)?$/i);
  if (!match) return undefined;
  const speed = Number(match[1]) * (match[2]?.toLowerCase() === "mph" ? 1.609344 : 1);
  return Number.isFinite(speed) ? speed : undefined;
};

export const roadSpeed = (tags: Record<string, string>): RoadSpeed => {
  const values = [tags.maxspeed, tags["maxspeed:forward"], tags["maxspeed:backward"]]
    .filter((value): value is string => Boolean(value?.trim()));
  if (values.some((value) => normalizeTag(value) === "none")) return { kind: "unlimited" };
  const speeds = values.map(numericMaxspeed);
  // A known dangerous limit cannot be concealed by an unparsed directional/conditional value.
  const known = speeds.filter((speed): speed is number => speed !== undefined);
  if (known.some((speed) => speed >= 70)) return { kind: "known", kmh: Math.max(...known) };
  const oneway = normalizeTag(tags.oneway);
  const directionCovered = tags.maxspeed?.trim() ||
    (tags["maxspeed:forward"]?.trim() && tags["maxspeed:backward"]?.trim()) ||
    ((oneway === "yes" || oneway === "1") && tags["maxspeed:forward"]?.trim()) ||
    (oneway === "-1" && tags["maxspeed:backward"]?.trim());
  if (!values.length || speeds.some((speed) => speed === undefined) ||
    !directionCovered ||
    ["maxspeed:conditional", "maxspeed:forward:conditional", "maxspeed:backward:conditional"]
      .some((key) => Boolean(tags[key]?.trim()))) {
    return { kind: "unknown" };
  }
  return { kind: "known", kmh: Math.max(...known) };
};

const exclusiveLane = (tags: Record<string, string>, side: string): boolean =>
  normalizeTag(tags[`cycleway:${side}`]) === "lane" &&
  normalizeTag(tags[`cycleway:${side}:lane`]) === "exclusive";

const hasUsableLane = (tags: Record<string, string>): boolean => {
  if (["cycleway", "cycleway:both", "cycleway:left", "cycleway:right"]
    .some((key) => ["separate", "track", "shared_lane", "share_busway"].includes(normalizeTag(tags[key]) ?? ""))) {
    return false;
  }
  if (exclusiveLane(tags, "both") || (exclusiveLane(tags, "left") && exclusiveLane(tags, "right"))) return true;
  const oneway = normalizeTag(tags.oneway);
  return (oneway === "yes" || oneway === "1" || oneway === "-1") &&
    (exclusiveLane(tags, "left") || exclusiveLane(tags, "right") ||
      (normalizeTag(tags.cycleway) === "lane" && normalizeTag(tags["cycleway:lane"]) === "exclusive"));
};

const MIN_USABLE_SHOULDER_WIDTH_METERS = 1.5;

const hasUsableShoulder = (tags: Record<string, string>): boolean => {
  const width = tags["shoulder:width"]?.trim().match(/^(\d+(?:\.\d+)?)\s*(?:m)?$/);
  return normalizeTag(tags.shoulder) === "both" &&
    classifyRoadCyclingSurface(tags["shoulder:surface"]) === "GOOD" &&
    width !== undefined && width !== null && Number.isFinite(Number(width[1])) &&
    Number(width[1]) >= MIN_USABLE_SHOULDER_WIDTH_METERS;
};

export const hasStrongCyclingComfortEvidence = (tags: Record<string, string>): boolean =>
  classifyRoadCyclingSurface(tags.surface) === "GOOD" &&
  classifyRoadCyclingSmoothness(tags.smoothness) === "GOOD" &&
  (hasUsableLane(tags) || hasUsableShoulder(tags));

export type TrafficRejectionReason =
  | "REJECT_HIGH_SPEED_MOTOR_ROAD"
  | "REJECT_PRIMARY_TRAFFIC_COMFORT"
  | "REJECT_SECONDARY_UNKNOWN_SPEED"
  | "REJECT_60_KMH_TRAFFIC_COMFORT";

export interface RoadTrafficProfile {
  highwayClass: string | undefined;
  speed: RoadSpeed;
  strongComfortEvidence: boolean;
  multiLane: boolean;
}

export const roadTrafficProfile = (tags: Record<string, string>): RoadTrafficProfile => ({
  highwayClass: normalizeTag(tags.highway)?.replace(/_link$/, ""),
  speed: roadSpeed(tags),
  strongComfortEvidence: hasStrongCyclingComfortEvidence(tags),
  multiLane: /^\d+$/.test(tags.lanes?.trim() ?? "") && Number(tags.lanes) >= 3
});

export interface RoadCyclingTrafficComfort {
  allowed: boolean;
  rejectionReason?: TrafficRejectionReason;
  qualityPenalty: number;
  confidencePenalty: number;
  reasons: string[];
}

const TRAFFIC_PENALTIES = {
  primary: 8,
  secondary: 5,
  speed60: 12,
  speedAbove50: 7,
  multiLane: 5,
  missingQuality: { primary: 12, secondary: 8, tertiary: 4, unclassified: 2 },
  missingConfidence: { primary: 20, secondary: 12, tertiary: 8, unclassified: 4 }
} as const;

/** Recommendation policy only: legal eligibility and independent style scores are unchanged. */
export const evaluateRoadCyclingTrafficComfort = (candidate: FartlekCandidate): RoadCyclingTrafficComfort => {
  const profiles = candidate.tagsBySegment.map(roadTrafficProfile)
    .filter((profile) => profile.highwayClass !== "cycleway");
  let rejectionReason: TrafficRejectionReason | undefined;
  if (profiles.some(({ speed }) => speed.kind === "unlimited" || (speed.kind === "known" && speed.kmh >= 70))) {
    rejectionReason = "REJECT_HIGH_SPEED_MOTOR_ROAD";
  } else if (profiles.some(({ highwayClass, speed, strongComfortEvidence }) =>
    highwayClass === "primary" && (speed.kind !== "known" || speed.kmh > 50 || !strongComfortEvidence))) {
    rejectionReason = "REJECT_PRIMARY_TRAFFIC_COMFORT";
  } else if (profiles.some(({ highwayClass, speed }) => highwayClass === "secondary" && speed.kind !== "known")) {
    rejectionReason = "REJECT_SECONDARY_UNKNOWN_SPEED";
  } else if (profiles.some(({ speed, strongComfortEvidence }) =>
    speed.kind === "known" && speed.kmh >= 60 && !strongComfortEvidence)) {
    rejectionReason = "REJECT_60_KMH_TRAFFIC_COMFORT";
  }

  let qualityPenalty = 0;
  let confidencePenalty = 0;
  const reasons = new Set<string>();
  for (const profile of profiles) {
    const { highwayClass, speed, strongComfortEvidence, multiLane } = profile;
    const classPenalty = highwayClass === "primary" ? TRAFFIC_PENALTIES.primary :
      highwayClass === "secondary" ? TRAFFIC_PENALTIES.secondary : 0;
    const riskClass = highwayClass === "primary" || highwayClass === "secondary" ||
      highwayClass === "tertiary" ? highwayClass : "unclassified";
    const speedPenalty = speed.kind === "unknown" ? TRAFFIC_PENALTIES.missingQuality[riskClass] :
      speed.kind === "unlimited" || speed.kmh >= 60 ? TRAFFIC_PENALTIES.speed60 :
        speed.kmh > 50 ? TRAFFIC_PENALTIES.speedAbove50 : 0;
    qualityPenalty = Math.max(qualityPenalty, classPenalty + speedPenalty +
      (multiLane ? TRAFFIC_PENALTIES.multiLane : 0));
    confidencePenalty = Math.max(confidencePenalty,
      speed.kind === "unknown" ? TRAFFIC_PENALTIES.missingConfidence[riskClass] : 0);
    reasons.add(`TRAFFIC_${highwayClass ?? "UNKNOWN"}_${speed.kind === "known" ? speed.kmh : speed.kind}`);
    if (strongComfortEvidence) reasons.add("TRAFFIC_EXPLICIT_COMFORT_EVIDENCE");
    if (multiLane) reasons.add("TRAFFIC_MULTI_LANE_RISK");
  }
  return {
    allowed: rejectionReason === undefined,
    ...(rejectionReason ? { rejectionReason } : {}),
    qualityPenalty,
    confidencePenalty,
    reasons: [...reasons].sort()
  };
};
