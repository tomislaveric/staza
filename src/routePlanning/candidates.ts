import type { QuestObjective } from "../domain.js";
import { distanceBetween } from "./geo.js";
import { stopPosition } from "./routingPlan.js";
import { DEFAULT_PLANNER_POLICY, type PlannerPolicy } from "./policy.js";
import { constraintFit, objectiveProgress } from "./scoring.js";
import type { CandidateStop, LatLon, QuestRouteTarget, RideConstraint, RouteCandidate, RoutePlanningInput } from "./types.js";

/** Planning budget in meters; time constraints are converted with a heuristic speed only for pre-routing estimates. */
export const budgetMeters = (constraint: RideConstraint, policy: PlannerPolicy = DEFAULT_PLANNER_POLICY): number =>
  constraint.type === "distance" ? constraint.meters : constraint.seconds * policy.heuristicSpeedMps;

/** Road-distance estimate of riding start → stops → end. */
export const estimateTour = (start: LatLon, end: LatLon, stops: CandidateStop[], roadFactor: number): number => {
  let position = start;
  let total = 0;
  for (const stop of stops) {
    total += distanceBetween(position, stopPosition(stop)) * roadFactor;
    position = stopPosition(stop);
  }
  return total + distanceBetween(position, end) * roadFactor;
};

const makeStop = (target: QuestRouteTarget): CandidateStop => ({ target });

const candidateKey = (stops: CandidateStop[]): string =>
  stops.map((stop) => stop.target.id).join(",");

export interface Insertion {
  stops: CandidateStop[];
  estimate: number;
}

export const cheapestInsertion = (input: RoutePlanningInput, stops: CandidateStop[], target: QuestRouteTarget, roadFactor: number): Insertion => {
  let best: Insertion | undefined;
  for (let position = 0; position <= stops.length; position += 1) {
    const next = [...stops.slice(0, position), makeStop(target), ...stops.slice(position)];
    const estimate = estimateTour(input.start, input.end, next, roadFactor);
    if (!best || estimate < best.estimate) best = { stops: next, estimate };
  }
  return best!;
};

/** Bounded 2-opt. Deterministic and small (≤ 12 stops). */
export const improveOrder = (input: RoutePlanningInput, stops: CandidateStop[], roadFactor: number): CandidateStop[] => {
  let best = stops;
  let bestEstimate = estimateTour(input.start, input.end, best, roadFactor);
  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false;
    for (let i = 0; i < best.length; i += 1) {
      for (let j = i; j < best.length; j += 1) {
        const reversed = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const estimate = estimateTour(input.start, input.end, reversed, roadFactor);
        if (estimate + 1 < bestEstimate) {
          best = reversed;
          bestEstimate = estimate;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return best;
};

export const makeCandidate = (
  input: RoutePlanningInput,
  objectives: QuestObjective[],
  stops: CandidateStop[],
  strategy: RouteCandidate["strategy"],
  policy: PlannerPolicy
): RouteCandidate => {
  const estimate = estimateTour(input.start, input.end, stops, policy.roadFactor);
  const progress = objectiveProgress(objectives, stops.map((stop) => stop.target.id)).overall;
  const fit = constraintFit(estimate, budgetMeters(input.constraint, policy), policy);
  const freshness = stops.filter((stop) => !stop.target.alreadyAchieved).length / Math.max(1, stops.length);
  return {
    key: candidateKey(stops),
    stops,
    estimatedDistanceM: Math.round(estimate),
    heuristicScore: Math.round((0.55 * progress + 0.35 * fit + 0.1 * freshness) * 1000) / 1000,
    strategy
  };
};

/** Removes a target from a candidate (after it proved unroutable); returns undefined when nothing is left. */
export const withoutTarget = (
  input: RoutePlanningInput,
  objectives: QuestObjective[],
  candidate: RouteCandidate,
  targetId: string,
  policy: PlannerPolicy = DEFAULT_PLANNER_POLICY
): RouteCandidate | undefined => {
  const stops = candidate.stops.filter((stop) => stop.target.id !== targetId);
  return stops.length > 0 ? makeCandidate(input, objectives, stops, candidate.strategy, policy) : undefined;
};
