/**
 * Foundational road-cycling eligibility layer.
 *
 * A segment must be eligible before any style score (flow/endurance/explore) is meaningful;
 * eligibility is never overridden by style scoring. This module owns the legal-access policy and
 * the hard-rejection rules, exposing explicit named reasons. Behaviour matches the prior inline
 * logic in `roadCyclingFlowlineQuality.ts` exactly.
 */

import {
  FARTLEK_MIN_LENGTH_METERS,
  type FartlekCandidate
} from "../fartlekModel.js";
import { classifyRoadCyclingSurface } from "./surface.js";
import { classifyRoadCyclingSmoothness } from "./smoothness.js";

export type RoadCyclingEligibilityReason =
  | "REJECT_MALFORMED_GEOMETRY"
  | "REJECT_TOO_SHORT"
  | "REJECT_LINK_STANDALONE"
  | "REJECT_UNSUITABLE_HIGHWAY"
  | "REJECT_BAD_SURFACE"
  | "REJECT_BAD_SMOOTHNESS"
  | "REJECT_ACCESS_NO"
  | "REJECT_PRIVATE_ACCESS"
  | "REJECT_RESTRICTED_ACCESS"
  | "REJECT_BICYCLE_FORBIDDEN"
  | "REJECT_BICYCLE_USE_SIDEPATH"
  | "REJECT_BICYCLE_RESTRICTED"
  | "REJECT_DESTINATION_ACCESS"
  | "REJECT_UNKNOWN_ACCESS"
  | "REJECT_ACCESS"
  | "REJECT_LINK_DOMINATED"
  | "REJECT_LOW_CONFIDENCE_UNCLASSIFIED"
  | "REJECT_CYCLEWAY_SURFACE_EVIDENCE";

export interface RoadCyclingEligibility {
  eligible: boolean;
  reasons: RoadCyclingEligibilityReason[];
}

const MAX_LINK_CONNECTOR_LENGTH_METERS = 300;
const MAX_LINK_CONNECTOR_CANDIDATE_FRACTION = 0.2;

const SUPPORTED_HIGHWAY_CLASSES = [
  "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link",
  "unclassified", "cycleway"
];

export const BICYCLE_ALLOWED = new Set([
  "yes", "designated", "permissive", "official", "optional_sidepath"
]);
export const ACCESS_ALLOWED = new Set(["yes", "all", "designated", "permissive"]);
export const RESTRICTED_ACCESS = new Set([
  "agricultural", "forestry", "customers", "permit", "military", "restricted", "emergency"
]);
export const RESTRICTED_BICYCLE = new Set([
  "no", "private", "destination", "customers", "permit", "dismount", "discouraged"
]);

export const normalizeTag = (value: string | undefined): string | undefined =>
  value?.trim().toLowerCase() || undefined;

export interface RoadCyclingAccessResult {
  allowed: boolean;
  confidence: number;
  reason?: RoadCyclingEligibilityReason;
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

/** First hard-rejection reason, or undefined when the candidate passes all gates. */
export const roadCyclingRejectionReason = (
  candidate: FartlekCandidate
): RoadCyclingEligibilityReason | undefined => {
  if (candidate.coordinates.length < 2) return "REJECT_MALFORMED_GEOMETRY";
  if (candidate.lengthMeters < FARTLEK_MIN_LENGTH_METERS) return "REJECT_TOO_SHORT";
  if (linkOnly(candidate.tagsBySegment)) return "REJECT_LINK_STANDALONE";
  for (const tags of candidate.tagsBySegment) {
    if (!SUPPORTED_HIGHWAY_CLASSES.includes(normalizeTag(tags.highway) ?? "")) {
      return "REJECT_UNSUITABLE_HIGHWAY";
    }
    if (classifyRoadCyclingSurface(tags.surface) === "BAD") return "REJECT_BAD_SURFACE";
    if (classifyRoadCyclingSmoothness(tags.smoothness) === "BAD") return "REJECT_BAD_SMOOTHNESS";
    const access = isRoadCyclingAccessible(tags);
    if (!access.allowed) return access.reason ?? "REJECT_ACCESS";
  }
  if (linkDominatesCandidate(candidate)) return "REJECT_LINK_DOMINATED";
  if (hasUnclassifiedWithoutEvidence(candidate.tagsBySegment)) return "REJECT_LOW_CONFIDENCE_UNCLASSIFIED";
  if (!cyclewayHasEvidence(candidate.tagsBySegment)) return "REJECT_CYCLEWAY_SURFACE_EVIDENCE";
  return undefined;
};

/** Structured eligibility result. `eligible` is foundational; style scoring must never override it. */
export const evaluateRoadCyclingEligibility = (
  candidate: FartlekCandidate
): RoadCyclingEligibility => {
  const reason = roadCyclingRejectionReason(candidate);
  return reason ? { eligible: false, reasons: [reason] } : { eligible: true, reasons: [] };
};

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
