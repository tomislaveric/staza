/**
 * Ride-style policy: maps the generic road-cycling segment scores onto named ride archetypes.
 *
 * Flowlines are the "flow" expression of the segment model; endurance and explore are equally
 * first-class. A ride style is just a named weighting over the independent style scores, so the
 * planner can rank routes for a chosen character without any per-user personalization or magic
 * numbers inline. Weights for each style sum to 1.
 */

export type RideStyle = "flow" | "endurance" | "explore" | "balanced";

export interface RideStyleWeights {
  flow: number;
  endurance: number;
  explore: number;
  roadQuality: number;
}

export interface RideStylePolicy {
  style: RideStyle;
  weights: RideStyleWeights;
  /** Minimum data confidence (0..1) a segment needs before its scores count toward the style. */
  minDataConfidence: number;
}

const policy = (
  style: RideStyle,
  weights: RideStyleWeights,
  minDataConfidence = 0.6
): RideStylePolicy => ({ style, weights, minDataConfidence });

export const RIDE_STYLE_POLICIES: Record<RideStyle, RideStylePolicy> = {
  flow: policy("flow", { flow: 0.7, endurance: 0.1, explore: 0.05, roadQuality: 0.15 }),
  endurance: policy("endurance", { flow: 0.15, endurance: 0.6, explore: 0.1, roadQuality: 0.15 }),
  explore: policy("explore", { flow: 0.1, endurance: 0.15, explore: 0.6, roadQuality: 0.15 }),
  balanced: policy("balanced", { flow: 0.3, endurance: 0.3, explore: 0.2, roadQuality: 0.2 })
};

export const DEFAULT_RIDE_STYLE: RideStyle = "balanced";

export const rideStylePolicy = (style: RideStyle = DEFAULT_RIDE_STYLE): RideStylePolicy =>
  RIDE_STYLE_POLICIES[style];

/** Scores a single segment's style-fit (0..100) for a policy from its independent style scores. */
export const styleFit = (
  policy: RideStylePolicy,
  scores: { flow: number; endurance: number; explore: number; roadQuality: number }
): number =>
  policy.weights.flow * scores.flow +
  policy.weights.endurance * scores.endurance +
  policy.weights.explore * scores.explore +
  policy.weights.roadQuality * scores.roadQuality;
