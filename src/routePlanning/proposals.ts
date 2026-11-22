import { randomUUID } from "node:crypto";
import { DEFAULT_PLANNER_POLICY, PROPOSAL_SELECTION, type PlannerPolicy } from "./policy.js";
import { traversedFlowlines } from "./validation.js";
import { constraintActual, constraintRequested } from "./scoring.js";
import type {
  ConstraintFitFlag,
  FlowlineGeometry,
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

export interface SelectedProposal {
  label: ProposalLabel;
  route: ScoredRoute;
  recommended: boolean;
}

export const summarizeTargets = (ids: string[], targets: Map<string, QuestRouteTarget>): TargetSummary => {
  const summary: TargetSummary = { peaks: 0, places: 0, other: 0 };
  for (const id of ids) {
    const target = targets.get(id);
    if (!target) continue;
    if (target.category === "peak") summary.peaks += 1;
    else if (target.category === "place") summary.places += 1;
    else summary.other += 1;
  }
  return summary;
};

/** Composition hint: Climb for steep routes, else Discovery for destination-rich routes. */
export const proposalHint = (summary: TargetSummary, distanceM: number, elevationGainM?: number): ProposalHint | undefined => {
  if (elevationGainM !== undefined && distanceM > 0 && elevationGainM / (distanceM / 1000) >= PROPOSAL_SELECTION.climbMetersPerKm) {
    return "climb";
  }
  const total = summary.peaks + summary.places + summary.other;
  return total >= 2 && (summary.peaks + summary.places) / total >= PROPOSAL_SELECTION.hintShare ? "discovery" : undefined;
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

export const proposalStops = (route: ScoredRoute): ProposalStop[] =>
  route.candidate.stops.map((stop) => ({ targetId: stop.target.id }));

export const toRouteProposal = (
  { label, route, recommended }: SelectedProposal,
  input: RoutePlanningInput,
  targets: Map<string, QuestRouteTarget>,
  flowlines: FlowlineGeometry[],
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
    traversedFlowlines: traversedFlowlines(route.routing, flowlines),
    constraintFit: constraintFitFlag(input, route.routing, policy),
    score: route.score
  };
};
