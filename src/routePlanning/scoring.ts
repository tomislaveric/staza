import type { QuestObjective } from "../domain.js";
import { LocalProjection, PolylineIndex, sampleAlong, type LonLat } from "./geo.js";
import { DEFAULT_PLANNER_POLICY, VALIDATION, type PlannerPolicy } from "./policy.js";
import type { ObjectiveProgressPotential, QuestRouteTarget, RideConstraint, RouteType, RoutingResult, ScoreBreakdown } from "./types.js";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * 1.0 inside the preferred band, linearly down to 0.5 at the acceptable band edge, then to 0 at
 * the zero-fit deviation. Symmetric: too short is as bad as too long.
 */
export const constraintFit = (actual: number, requested: number, policy: PlannerPolicy = DEFAULT_PLANNER_POLICY): number => {
  if (requested <= 0) return 0;
  const deviation = Math.abs(actual / requested - 1);
  if (deviation <= policy.preferredTolerance) return 1;
  if (deviation <= policy.acceptableTolerance) {
    return 1 - 0.5 * (deviation - policy.preferredTolerance) / (policy.acceptableTolerance - policy.preferredTolerance);
  }
  if (deviation >= policy.zeroFitTolerance) return 0;
  return 0.5 * (1 - (deviation - policy.acceptableTolerance) / (policy.zeroFitTolerance - policy.acceptableTolerance));
};

export const constraintActual = (constraint: RideConstraint, routing: Pick<RoutingResult, "distanceM" | "durationS">): number =>
  constraint.type === "distance" ? routing.distanceM : routing.durationS;

export const constraintRequested = (constraint: RideConstraint): number =>
  constraint.type === "distance" ? constraint.meters : constraint.seconds;

/** Upper-bound progress each objective could gain from the included targets. Never mutates real progress. */
export const objectiveProgress = (objectives: QuestObjective[], includedTargetIds: Iterable<string>): {
  objectives: ObjectiveProgressPotential[];
  overall: number;
} => {
  const included = new Set(includedTargetIds);
  let achieved = 0;
  let required = 0;
  const result = objectives.map((objective) => {
    const count = objective.targets.filter((target) => included.has(target.id)).length;
    const capped = Math.min(count, objective.requiredCount);
    achieved += capped;
    required += objective.requiredCount;
    return {
      objectiveId: objective.id,
      type: objective.type,
      ...(objective.type !== "flowline_rule" && objective.category ? { category: objective.category } : {}),
      included: count,
      required: objective.requiredCount,
      potential: objective.requiredCount > 0 ? capped / objective.requiredCount : 1
    };
  });
  return { objectives: result, overall: required > 0 ? achieved / required : 0 };
};

/** Share of the route that runs over a part already ridden earlier on the same route. */
export const retraceRatio = (coordinates: LonLat[]): number => {
  if (coordinates.length < 2) return 0;
  const index = new PolylineIndex(coordinates, VALIDATION.retraceCorridorMeters * 4);
  const samples = sampleAlong(coordinates, VALIDATION.routeSampleSpacingMeters);
  if (samples.length < 3) return 0;
  const spacing = index.lengthMeters / (samples.length - 1);
  let retraced = 0;
  samples.forEach((sample, sampleIndex) => {
    const along = sampleIndex * spacing;
    const other = index.nearest(sample, VALIDATION.retraceCorridorMeters,
      (candidate) => Math.abs(candidate - along) > VALIDATION.retraceMinSeparationMeters);
    if (other) retraced += 1;
  });
  return retraced / samples.length;
};

/** 4πA / P² of the route polygon: 1 for a circle, ~0 for an out-and-back. */
export const isoperimetricQuotient = (coordinates: LonLat[]): number => {
  if (coordinates.length < 3) return 0;
  const projection = new LocalProjection({ lat: coordinates[0][1], lon: coordinates[0][0] });
  const points = coordinates.map((coordinate) => projection.project(coordinate));
  let area = 0;
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [ax, ay] = points[index];
    const [bx, by] = points[(index + 1) % points.length];
    area += ax * by - bx * ay;
    perimeter += Math.hypot(bx - ax, by - ay);
  }
  return perimeter > 0 ? clamp01((4 * Math.PI * Math.abs(area / 2)) / (perimeter * perimeter)) : 0;
};

export const loopQuality = (retrace: number, coordinates: LonLat[]): number =>
  0.5 * (1 - retrace) + 0.5 * Math.min(1, isoperimetricQuotient(coordinates) / VALIDATION.loopCompactnessTarget);

export const detourPenalty = (actualMeters: number, estimatedMeters: number): number => {
  if (estimatedMeters <= 0) return 0;
  return clamp01((actualMeters / estimatedMeters - VALIDATION.detourFreeRatio) / VALIDATION.detourPenaltySpan);
};

export const targetQuality = (included: QuestRouteTarget[]): number =>
  included.length === 0 ? 0 : included.reduce((sum, target) => sum + (target.alreadyAchieved ? 0.3 : 1), 0) / included.length;

export interface ScoreInput {
  routeType: RouteType;
  constraint: RideConstraint;
  routing: RoutingResult;
  estimatedDistanceM: number;
  progress: number;
  includedTargets: QuestRouteTarget[];
}

export const scoreRoute = (input: ScoreInput, policy: PlannerPolicy = DEFAULT_PLANNER_POLICY): ScoreBreakdown => {
  const coordinates = input.routing.geometry.coordinates;
  const retrace = retraceRatio(coordinates);
  const fit = constraintFit(constraintActual(input.constraint, input.routing), constraintRequested(input.constraint), policy);
  const loop = input.routeType === "round_trip" ? loopQuality(retrace, coordinates) : 0;
  const shape = 1 - retrace;
  const quality = targetQuality(input.includedTargets);
  const detour = detourPenalty(input.routing.distanceM, input.estimatedDistanceM);
  const { weights } = policy;
  const shapeWeight = weights.routeShape + (input.routeType === "round_trip" ? 0 : weights.loopQuality);
  const total = weights.questProgress * input.progress
    + weights.constraintFit * fit
    + (input.routeType === "round_trip" ? weights.loopQuality * loop : 0)
    + weights.targetQuality * quality
    + shapeWeight * shape
    - weights.detourPenalty * detour;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    questProgress: round(input.progress),
    constraintFit: round(fit),
    loopQuality: round(loop),
    routeShape: round(shape),
    targetQuality: round(quality),
    detourPenalty: round(detour),
    total: round(total)
  };
};
