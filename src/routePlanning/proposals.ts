import { randomUUID } from "node:crypto";
import { DEFAULT_PLANNER_POLICY, PLANNING_LIMITS, PROPOSAL_SELECTION, type PlannerPolicy } from "./policy.js";
import { constraintActual, constraintRequested } from "./scoring.js";
import type {
  ConstraintFitFlag,
  ProposalHint,
  ProposalLabel,
  ProposalStop,
  QuestRouteTarget,
  RoutePlanningInput,
  RouteProposal,
  ScoredRoute,
  TargetSummary
} from "./types.js";

/** Targets a route contains: served ones plus planned targets reachable on foot. */
export const routeTargetIds = (route: Pick<ScoredRoute, "includedTargetIds" | "nearbyTargetIds">): string[] =>
  [...new Set([...route.includedTargetIds, ...route.nearbyTargetIds])].sort();

const jaccard = (a: string[], b: string[]): number => {
  const left = new Set(a);
  const intersection = b.filter((id) => left.has(id)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : intersection / union;
};

export const distinctRoutes = (a: ScoredRoute, b: ScoredRoute): boolean =>
  jaccard(routeTargetIds(a), routeTargetIds(b)) < PROPOSAL_SELECTION.maxTargetOverlap
  || Math.abs(a.routing.distanceM - b.routing.distanceM)
    > PROPOSAL_SELECTION.minDistanceDifference * Math.max(a.routing.distanceM, b.routing.distanceM);

const byScore = (a: ScoredRoute, b: ScoredRoute) => b.score.total - a.score.total
  || a.routing.distanceM - b.routing.distanceM || a.candidate.key.localeCompare(b.candidate.key);

const targetCount = (route: ScoredRoute) => routeTargetIds(route).length;

export interface SelectedProposal {
  label: ProposalLabel;
  route: ScoredRoute;
  recommended: boolean;
}

/**
 * Picks up to three meaningfully different routes — which may contain different targets — and
 * labels them relative to each other:
 * - Adventure: the route with the most targets (ties: longer).
 * - Quick: the shortest remaining route, clearly shorter than Adventure.
 * - Balanced: the best-scoring remaining route.
 * The best-scoring route overall is marked recommended. Results are ordered Quick, Balanced, Adventure.
 */
export const selectProposals = (routes: ScoredRoute[]): SelectedProposal[] => {
  if (routes.length === 0) return [];
  const ranked = [...routes].sort(byScore);
  const best = ranked[0];
  const chosen: ScoredRoute[] = [best];
  const isDistinct = (route: ScoredRoute) => chosen.every((entry) => distinctRoutes(entry, route));
  const add = (route: ScoredRoute | undefined) => {
    if (route && chosen.length < PLANNING_LIMITS.maxProposals && isDistinct(route)) chosen.push(route);
  };
  add([...ranked].sort((a, b) => targetCount(b) - targetCount(a) || byScore(a, b)).find(isDistinct));
  add([...ranked].sort((a, b) => a.routing.distanceM - b.routing.distanceM || byScore(a, b)).find(isDistinct));
  for (const route of ranked) add(route);

  if (chosen.length === 1) return [{ label: "balanced", route: best, recommended: true }];
  const adventure = [...chosen].sort((a, b) => targetCount(b) - targetCount(a)
    || b.routing.distanceM - a.routing.distanceM || byScore(a, b))[0];
  const rest = chosen.filter((route) => route !== adventure).sort((a, b) => a.routing.distanceM - b.routing.distanceM || byScore(a, b));
  const labelled: Array<{ label: ProposalLabel; route: ScoredRoute }> = [{ label: "adventure", route: adventure }];
  const quickLimit = adventure.routing.distanceM * PROPOSAL_SELECTION.quickDistanceRatio;
  if (rest.length === 2) {
    labelled.push({ label: "quick", route: rest[0] }, { label: "balanced", route: rest[1] });
  } else {
    labelled.push({ label: rest[0].routing.distanceM <= quickLimit ? "quick" : "balanced", route: rest[0] });
  }
  const order: ProposalLabel[] = ["quick", "balanced", "adventure"];
  return labelled
    .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
    .map((entry) => ({ ...entry, recommended: entry.route === best }));
};

export const summarizeTargets = (ids: string[], targets: Map<string, QuestRouteTarget>): TargetSummary => {
  const summary: TargetSummary = { flowlines: 0, peaks: 0, places: 0, other: 0 };
  for (const id of ids) {
    const target = targets.get(id);
    if (!target) continue;
    if (target.kind === "segment") summary.flowlines += 1;
    else if (target.category === "peak") summary.peaks += 1;
    else if (target.category === "place") summary.places += 1;
    else summary.other += 1;
  }
  return summary;
};

/** Composition hint: Climb for steep routes, else Flowline-rich or Discovery when one kind dominates. */
export const proposalHint = (summary: TargetSummary, distanceM: number, elevationGainM?: number): ProposalHint | undefined => {
  if (elevationGainM !== undefined && distanceM > 0 && elevationGainM / (distanceM / 1000) >= PROPOSAL_SELECTION.climbMetersPerKm) {
    return "climb";
  }
  const total = summary.flowlines + summary.peaks + summary.places + summary.other;
  if (total < 2) return undefined;
  if (summary.flowlines / total >= PROPOSAL_SELECTION.hintShare) return "flowline_rich";
  if ((total - summary.flowlines) / total >= PROPOSAL_SELECTION.hintShare) return "discovery";
  return undefined;
};

export const constraintFitFlag = (
  input: RoutePlanningInput,
  routing: ScoredRoute["routing"],
  policy: PlannerPolicy = DEFAULT_PLANNER_POLICY
): ConstraintFitFlag => {
  const ratio = constraintActual(input.constraint, routing) / constraintRequested(input.constraint);
  if (ratio < 1 - policy.acceptableTolerance) return "short";
  if (ratio > 1 + policy.acceptableTolerance) return "long";
  return "within";
};

export const proposalStops = (route: ScoredRoute): ProposalStop[] => route.candidate.stops.map((stop) =>
  stop.direction ? { targetId: stop.target.id, direction: stop.direction } : { targetId: stop.target.id });

export const toRouteProposal = (
  { label, route, recommended }: SelectedProposal,
  input: RoutePlanningInput,
  targets: Map<string, QuestRouteTarget>,
  policy: PlannerPolicy = DEFAULT_PLANNER_POLICY
): RouteProposal => {
  const distanceM = Math.round(route.routing.distanceM);
  const elevationGainM = route.routing.elevationGainM !== null ? Math.round(route.routing.elevationGainM) : undefined;
  const targetSummary = summarizeTargets(routeTargetIds(route), targets);
  const hint = proposalHint(targetSummary, distanceM, elevationGainM);
  return {
    id: randomUUID(),
    label,
    ...(hint ? { hint } : {}),
    recommended,
    routeType: input.routeType,
    distanceM,
    durationS: Math.round(route.routing.durationS),
    ...(elevationGainM !== undefined ? { elevationGainM } : {}),
    ...(route.routing.elevationLossM !== null ? { elevationLossM: Math.round(route.routing.elevationLossM) } : {}),
    geometry: route.routing.geometry,
    start: input.start,
    end: input.end,
    includedTargetIds: [...route.includedTargetIds].sort(),
    nearbyTargetIds: [...route.nearbyTargetIds].sort(),
    targetSummary,
    constraintFit: constraintFitFlag(input, route.routing, policy),
    score: route.score
  };
};
