/**
 * Route-level aggregation of the generic segment model.
 *
 * A planned route traverses zero or more scored road-cycling segments (Flowlines and, in future,
 * any eligible segment). This module rolls per-segment style scores up to one route-level profile
 * by distance-weighting each segment over the portion of the route it actually covers, so a short
 * brilliant segment never outweighs a long one. Pure and deterministic: no routing, no I/O.
 */

import {
  rideStylePolicy,
  styleFit,
  type RideStyle,
  type RideStylePolicy
} from "../../routePlanning/rideStyle.js";

export interface TraversedSegmentScores {
  flow: number;
  endurance: number;
  explore: number;
  roadQuality: number;
  dataConfidence: number;
}

export interface TraversedSegment {
  id: string;
  /** Meters of the route actually covered by this segment (not the segment's full length). */
  coveredMeters: number;
  scores: TraversedSegmentScores;
}

export interface RouteSegmentProfile {
  /** Distance-weighted style scores (0..100) over covered segments. */
  flow: number;
  endurance: number;
  explore: number;
  roadQuality: number;
  /** Distance-weighted data confidence (0..1) over covered segments. */
  dataConfidence: number;
  /** Fraction of the route length covered by scored segments (0..1). */
  coverageRatio: number;
  /** Total meters covered by scored segments. */
  coveredMeters: number;
  segmentCount: number;
}

const weightedAverage = (
  segments: TraversedSegment[],
  select: (scores: TraversedSegmentScores) => number
): number => {
  const totalWeight = segments.reduce((sum, segment) => sum + segment.coveredMeters, 0);
  if (totalWeight <= 0) return 0;
  const weighted = segments.reduce(
    (sum, segment) => sum + select(segment.scores) * segment.coveredMeters,
    0
  );
  return weighted / totalWeight;
};

/**
 * Builds a route-level segment profile. `routeLengthMeters` is the full planned-route length used
 * for the coverage ratio; covered meters never exceed it.
 */
export const aggregateRouteSegments = (
  segments: TraversedSegment[],
  routeLengthMeters: number
): RouteSegmentProfile => {
  const coveredMeters = Math.min(
    segments.reduce((sum, segment) => sum + Math.max(0, segment.coveredMeters), 0),
    Math.max(routeLengthMeters, 0)
  );
  return {
    flow: Math.round(weightedAverage(segments, (scores) => scores.flow)),
    endurance: Math.round(weightedAverage(segments, (scores) => scores.endurance)),
    explore: Math.round(weightedAverage(segments, (scores) => scores.explore)),
    roadQuality: Math.round(weightedAverage(segments, (scores) => scores.roadQuality)),
    dataConfidence: weightedAverage(segments, (scores) => scores.dataConfidence),
    coverageRatio: routeLengthMeters > 0 ? coveredMeters / routeLengthMeters : 0,
    coveredMeters,
    segmentCount: segments.length
  };
};

/**
 * Single style-fit score (0..100) for a route under a ride style. Segments below the policy's
 * confidence floor are excluded so low-confidence data cannot inflate (or deflate) the rating; the
 * result is scaled by coverage so a route that is mostly unscored cannot earn a top rating.
 */
export const scoreRouteForStyle = (
  segments: TraversedSegment[],
  routeLengthMeters: number,
  style: RideStyle | RideStylePolicy = "balanced"
): { style: RideStyle; fit: number; profile: RouteSegmentProfile } => {
  const policy = typeof style === "string" ? rideStylePolicy(style) : style;
  const confident = segments.filter((segment) => segment.scores.dataConfidence >= policy.minDataConfidence);
  const profile = aggregateRouteSegments(confident, routeLengthMeters);
  const fit = styleFit(policy, profile) * profile.coverageRatio;
  return { style: policy.style, fit: Math.round(fit), profile };
};
