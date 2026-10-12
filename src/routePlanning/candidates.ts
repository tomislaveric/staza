import type { QuestObjective } from "../domain.js";
import { distanceBetween } from "./geo.js";
import { stopPosition } from "./routingPlan.js";
import { DEFAULT_PLANNER_POLICY, PLANNING_LIMITS, type PlannerPolicy } from "./policy.js";
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

const setKey = (stops: CandidateStop[]): string => stops.map((stop) => stop.target.id).sort().join(",");

/**
 * Keeps targets that can plausibly be visited within the budget, preferring unachieved and
 * nearby ones, with a per-objective cap so one dense objective cannot crowd out the others.
 */
export const selectTargetPool = (
  targets: QuestRouteTarget[],
  objectives: QuestObjective[],
  input: RoutePlanningInput,
  policy: PlannerPolicy = DEFAULT_PLANNER_POLICY
): QuestRouteTarget[] => {
  const budget = budgetMeters(input.constraint, policy);
  const reachCost = (target: QuestRouteTarget): number =>
    estimateTour(input.start, input.end, [makeStop(target)], policy.roadFactor);
  const reachable = targets
    .map((target) => ({ target, cost: reachCost(target) }))
    .filter(({ cost }) => cost <= budget * policy.maxEstimateRatio)
    .sort((a, b) => Number(a.target.alreadyAchieved) - Number(b.target.alreadyAchieved) || a.cost - b.cost
      || a.target.id.localeCompare(b.target.id));

  const selected = new Map<string, QuestRouteTarget>();
  for (const objective of objectives) {
    const objectiveTargets = reachable.filter(({ target }) => target.objectiveIds.includes(objective.id));
    for (const { target } of objectiveTargets.slice(0, PLANNING_LIMITS.maxPoolTargetsPerObjective)) {
      selected.set(target.id, target);
    }
  }
  return reachable
    .filter(({ target }) => selected.has(target.id))
    .slice(0, PLANNING_LIMITS.maxPoolTargets)
    .map(({ target }) => target);
};

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

const unmetObjectives = (objectives: QuestObjective[], stops: CandidateStop[]): Set<string> => {
  const { objectives: progress } = objectiveProgress(objectives, stops.map((stop) => stop.target.id));
  return new Set(progress.filter((entry) => entry.included < entry.required).map((entry) => entry.objectiveId));
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

/**
 * Seeded greedy construction. "minimal" adds only targets advancing unmet objectives until the
 * quest's required counts are covered; "extended" keeps adding the cheapest useful targets while
 * the estimate stays within the requested budget.
 */
const buildFromSeed = (
  input: RoutePlanningInput,
  objectives: QuestObjective[],
  pool: QuestRouteTarget[],
  seed: QuestRouteTarget,
  policy: PlannerPolicy
): { minimal?: CandidateStop[]; extended?: CandidateStop[] } => {
  const budget = budgetMeters(input.constraint, policy);
  const hardCap = budget * policy.maxEstimateRatio;
  let stops = cheapestInsertion(input, [], seed, policy.roadFactor).stops;
  if (estimateTour(input.start, input.end, stops, policy.roadFactor) > hardCap) return {};

  const tryAdd = (eligible: (target: QuestRouteTarget) => boolean, limit: number): boolean => {
    let best: Insertion | undefined;
    const used = new Set(stops.map((stop) => stop.target.id));
    for (const target of pool) {
      if (used.has(target.id) || !eligible(target)) continue;
      const insertion = cheapestInsertion(input, stops, target, policy.roadFactor);
      const penalty = target.alreadyAchieved ? 1.5 : 1;
      if (insertion.estimate <= limit && (!best || insertion.estimate * penalty < best.estimate)) {
        best = { stops: insertion.stops, estimate: insertion.estimate * penalty };
      }
    }
    if (!best) return false;
    stops = improveOrder(input, best.stops, policy.roadFactor);
    return true;
  };

  while (stops.length < PLANNING_LIMITS.maxTargetsPerCandidate) {
    const unmet = unmetObjectives(objectives, stops);
    if (unmet.size === 0) break;
    if (!tryAdd((target) => target.objectiveIds.some((id) => unmet.has(id)), hardCap)) break;
  }
  const minimal = improveOrder(input, stops, policy.roadFactor);

  stops = minimal;
  const objectiveTargetIds = new Set(objectives.flatMap((objective) => objective.targets.map((target) => target.id)));
  while (stops.length < PLANNING_LIMITS.maxTargetsPerCandidate) {
    if (!tryAdd((target) => objectiveTargetIds.has(target.id), budget)) break;
  }
  return { minimal, extended: stops.length > minimal.length ? stops : undefined };
};

/**
 * Generates deterministic, deduplicated route candidates for routing, best first, alternating
 * strategies so both quick and fuller variants reach the routing budget.
 */
export const generateCandidates = (
  input: RoutePlanningInput,
  objectives: QuestObjective[],
  pool: QuestRouteTarget[],
  policy: PlannerPolicy = DEFAULT_PLANNER_POLICY
): RouteCandidate[] => {
  const seeds = [...pool]
    .sort((a, b) => Number(a.alreadyAchieved) - Number(b.alreadyAchieved)
      || estimateTour(input.start, input.end, [makeStop(a)], policy.roadFactor)
        - estimateTour(input.start, input.end, [makeStop(b)], policy.roadFactor)
      || a.id.localeCompare(b.id));

  // Seeds are spread across the ranking so candidates explore different directions from the start.
  const seedCount = Math.min(PLANNING_LIMITS.maxSeeds, seeds.length);
  const chosenSeeds = Array.from({ length: seedCount }, (_value, index) =>
    seeds[Math.floor((index * seeds.length) / seedCount)]);

  const minimal = new Map<string, RouteCandidate>();
  const extended = new Map<string, RouteCandidate>();
  const reduced = new Map<string, RouteCandidate>();
  const keep = (map: Map<string, RouteCandidate>, candidate: RouteCandidate) => {
    const key = setKey(candidate.stops);
    const existing = minimal.get(key) ?? extended.get(key) ?? reduced.get(key);
    if (!existing || candidate.estimatedDistanceM < existing.estimatedDistanceM) {
      minimal.delete(key);
      extended.delete(key);
      reduced.delete(key);
      map.set(key, candidate);
    }
  };

  for (const seed of chosenSeeds) {
    const built = buildFromSeed(input, objectives, pool, seed, policy);
    if (built.minimal) keep(minimal, makeCandidate(input, objectives, built.minimal, "minimal", policy));
    if (built.extended) keep(extended, makeCandidate(input, objectives, built.extended, "extended", policy));
  }

  // Shorter variants of the fullest candidate: repeatedly drop the stop whose removal saves the most.
  let current = [...minimal.values(), ...extended.values()].sort((a, b) => b.stops.length - a.stops.length
    || a.estimatedDistanceM - b.estimatedDistanceM || a.key.localeCompare(b.key))[0];
  for (let variant = 0; variant < PLANNING_LIMITS.maxReducedVariants && current && current.stops.length > 1; variant += 1) {
    let best: { stops: CandidateStop[]; estimate: number; id: string } | undefined;
    for (const stop of current.stops) {
      const stops = current.stops.filter((candidate) => candidate !== stop);
      const estimate = estimateTour(input.start, input.end, stops, policy.roadFactor);
      if (!best || estimate < best.estimate || (estimate === best.estimate && stop.target.id < best.id)) {
        best = { stops, estimate, id: stop.target.id };
      }
    }
    current = makeCandidate(input, objectives, improveOrder(input, best!.stops, policy.roadFactor), "reduced", policy);
    keep(reduced, current);
  }

  const rank = (candidates: RouteCandidate[]) => candidates.sort((a, b) => b.heuristicScore - a.heuristicScore
    || a.estimatedDistanceM - b.estimatedDistanceM || a.key.localeCompare(b.key));
  const minimalRanked = rank([...minimal.values()]);
  const extendedRanked = rank([...extended.values()]);
  const interleaved: RouteCandidate[] = [];
  for (let index = 0; index < Math.max(minimalRanked.length, extendedRanked.length); index += 1) {
    if (minimalRanked[index]) interleaved.push(minimalRanked[index]);
    if (extendedRanked[index]) interleaved.push(extendedRanked[index]);
  }
  // Route the best full candidate first, then the shorter variants, so every label gets a chance.
  const reducedOrdered = [...reduced.values()].sort((a, b) => b.stops.length - a.stops.length);
  return [...interleaved.slice(0, 1), ...reducedOrdered, ...interleaved.slice(1)];
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
