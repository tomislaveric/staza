import type { QuestObjective } from "../domain.js";
import type { GeoBounds } from "../worldQuery.js";
import { cheapestInsertion, improveOrder, makeCandidate } from "./candidates.js";
import { distanceBetween } from "./geo.js";
import { flowlineRidePoints, noRouteError, routeCandidates, waypointId, waypointTarget, type PlannedProposal, type PlannerDependencies } from "./planner.js";
import { DEFAULT_PLANNER_POLICY, PLANNING_LIMITS } from "./policy.js";
import { proposalStops, routeTargetIds, toRouteProposal } from "./proposals.js";
import { policyForSport } from "./sport.js";
import type { CandidateStop, FlowlineGeometry, LatLon, QuestRouteTarget, RoutePlanningInput } from "./types.js";
import { traversedFlowlines } from "./validation.js";

/** One player-chosen stop: a collectible or route-only map point, or a Flowline ridden in full. */
export type ManualStop =
  | { kind: "target"; target: QuestRouteTarget }
  | { kind: "flowline"; flowline: FlowlineGeometry };

export const manualStopId = (stop: ManualStop): string =>
  stop.kind === "flowline" ? `flowline:${stop.flowline.id}` : stop.target.id;

const anchor = (stop: ManualStop): LatLon => {
  if (stop.kind === "target") return stop.target.coordinate;
  const [lon, lat] = stop.flowline.coordinates[Math.floor(stop.flowline.coordinates.length / 2)];
  return { lat, lon };
};

/**
 * Orders the player's stops: the given order when `keepOrder`, otherwise cheapest insertion plus
 * 2-opt over one anchor per stop (a Flowline's middle vertex).
 */
export const orderManualStops = (
  input: RoutePlanningInput,
  stops: ManualStop[],
  keepOrder: boolean,
  roadFactor: number = DEFAULT_PLANNER_POLICY.roadFactor
): ManualStop[] => {
  if (keepOrder || stops.length < 2) return stops;
  const byId = new Map(stops.map((stop) => [manualStopId(stop), stop]));
  let ordered: CandidateStop[] = [];
  for (const stop of stops) {
    const point: QuestRouteTarget = { ...waypointTarget(anchor(stop)), id: manualStopId(stop) };
    ordered = cheapestInsertion(input, ordered, point, roadFactor).stops;
  }
  return improveOrder(input, ordered, roadFactor).map((stop) => byId.get(stop.target.id)!);
};

/** Routing points of ordered stops: a Flowline is entered at the end nearer the previous point. */
export const expandManualStops = (input: RoutePlanningInput, stops: ManualStop[]): CandidateStop[] => {
  let previous = input.start;
  const expanded: CandidateStop[] = [];
  const seen = new Set<string>();
  for (const stop of stops) {
    const points = stop.kind === "target"
      ? [stop.target]
      : flowlineRidePoints(previous, stop.flowline).map(waypointTarget);
    for (const target of points) {
      if (seen.has(target.id)) continue;
      seen.add(target.id);
      expanded.push({ target });
    }
    previous = points[points.length - 1].coordinate;
  }
  return expanded;
};

export interface PlanManualRouteInput {
  requestId: string;
  playerId: string;
  scopeId: string;
  /** The player's stops; collectible targets carry their objective ids. */
  stops: ManualStop[];
  /** Keep the player's order instead of letting Staza order the stops. */
  keepOrder: boolean;
  objectives: QuestObjective[];
  /** Revealed Flowlines of the area, reported when the route rides them. */
  flowlines: FlowlineGeometry[];
  input: RoutePlanningInput;
  bounds?: GeoBounds;
}

/**
 * Manual planner: routes exactly the player's stops and nothing else. It never picks targets on
 * its own. Flowline stops are ridden end to end; Flowlines the final route does not ride are
 * reported as dropped, as are unroutable collectibles and map points.
 */
export const planManualRoute = async (
  { requestId, playerId, scopeId, stops, keepOrder, objectives, flowlines, input, bounds }: PlanManualRouteInput,
  { routing, policy: basePolicy = DEFAULT_PLANNER_POLICY, now = Date.now, log = (entry) => console.log(JSON.stringify(entry)) }: PlannerDependencies
): Promise<PlannedProposal & { stopOrder: string[] }> => {
  const policy = policyForSport(basePolicy, input.sport);
  const startedAt = now();
  const ordered = orderManualStops(input, stops, keepOrder, policy.roadFactor);
  const targets = ordered.flatMap((stop) => (stop.kind === "target" && !stop.target.routeOnly ? [stop.target] : []));
  const candidate = makeCandidate(input, objectives, expandManualStops(input, ordered), "custom", policy);
  const run = await routeCandidates([{ candidate, objectives }], {
    requestId, input, bounds, eligibleTargets: targets, maxRequests: PLANNING_LIMITS.maxRerouteRequests, routing, policy
  });
  const required = ordered.flatMap((stop) => (stop.kind === "flowline" ? [stop.flowline] : []));
  const ridden = (route: (typeof run.scored)[number]) => traversedFlowlines(route.routing, required).length;
  const best = [...run.scored].sort((a, b) => ridden(b) - ridden(a)
    || routeTargetIds(b).length - routeTargetIds(a).length
    || b.score.total - a.score.total)[0];
  log({
    event: "exploration_manual_route",
    requestId,
    playerId,
    explorationId: scopeId,
    stopCount: stops.length,
    flowlineCount: required.length,
    routingRequests: run.routingRequests,
    failureCodes: [...new Set(run.failureCodes)].sort(),
    planningDurationMs: now() - startedAt,
    routed: Boolean(best)
  });
  if (!best) throw noRouteError(run.failureCodes);
  const riddenIds = new Set(traversedFlowlines(best.routing, required).map((flowline) => flowline.id));
  const served = new Set(routeTargetIds(best));
  const servedStops = new Set(best.candidate.stops.map((stop) => stop.target.id));
  const waypoints = ordered.flatMap((stop) => (stop.kind === "target" && stop.target.routeOnly ? [stop.target.coordinate] : []));
  const droppedTargetIds = targets.map((target) => target.id).filter((id) => !served.has(id)).sort();
  const droppedFlowlineIds = required.map((flowline) => flowline.id).filter((id) => !riddenIds.has(id)).sort();
  const servedWaypoints = waypoints.filter((point) => servedStops.has(waypointId(point)));
  const droppedWaypoints = waypoints.filter((point) => !servedStops.has(waypointId(point)));
  const proposal = toRouteProposal({ label: "balanced", route: best, recommended: true }, input,
    new Map(targets.map((target) => [target.id, target])), flowlines, policy);
  return {
    proposal: {
      ...proposal,
      customized: true,
      flowlineIds: required.map((flowline) => flowline.id).filter((id) => riddenIds.has(id)),
      ...(droppedTargetIds.length > 0 ? { droppedTargetIds } : {}),
      ...(droppedFlowlineIds.length > 0 ? { droppedFlowlineIds } : {}),
      ...(servedWaypoints.length > 0 ? { waypoints: servedWaypoints } : {}),
      ...(droppedWaypoints.length > 0 ? { droppedWaypoints } : {})
    },
    stops: proposalStops(best),
    stopOrder: ordered.map(manualStopId)
  };
};

/** Distance from the start to the nearest stop anchor; guards against far-away starts. */
export const startToNearestStopM = (input: RoutePlanningInput, stops: ManualStop[]): number =>
  Math.min(...stops.map((stop) => distanceBetween(input.start, anchor(stop))));
