import type { QuestObjective } from "../domain.js";
import { cheapestInsertion, generateCandidates, improveOrder, makeCandidate, selectTargetPool, withoutTarget } from "./candidates.js";
import { backtrackRatio, closeRoundTrip, detourLengthM } from "./roundTrip.js";
import { buildRoutingPlan } from "./routingPlan.js";
import { policyForSport, profileForSport } from "./sport.js";
import { DEFAULT_PLANNER_POLICY, PLANNING_LIMITS, type PlannerPolicy } from "./policy.js";
import { proposalStops, routeTargetIds, selectProposals, toRouteProposal } from "./proposals.js";
import { RoutingError } from "./routingClient.js";
import { objectiveProgress, scoreRoute } from "./scoring.js";
import { buildStrategies } from "./strategies.js";
import type {
  CandidateStop,
  FlowlineGeometry,
  ProposalLabel,
  ProposalStop,
  LatLon,
  QuestRouteTarget,
  RouteCandidate,
  RoutePlanningInput,
  RouteProposal,
  RoutingRequest,
  RoutingResult,
  ScoredRoute
} from "./types.js";
import { staysWithinBounds, validateRoute } from "./validation.js";
import { insideBounds } from "./validation.js";
import { distanceBetween } from "./geo.js";
import type { GeoBounds } from "../worldQuery.js";

export type PlanningErrorCode = "no_reachable_targets" | "no_route" | "routing_unavailable";

export class PlanningError extends Error {
  constructor(readonly code: PlanningErrorCode, message: string) {
    super(message);
  }
}

export interface RouteProvider {
  route(request: RoutingRequest, options?: { requestId?: string; signal?: AbortSignal }): Promise<RoutingResult>;
}

export interface PlannerDependencies {
  routing: RouteProvider;
  policy?: PlannerPolicy;
  now?: () => number;
  log?: (entry: Record<string, unknown>) => void;
}

/** A planned proposal plus its ordered stops (kept server-side for later customization). */
export interface PlannedProposal {
  proposal: RouteProposal;
  stops: ProposalStop[];
}

const transientCodes = new Set(["timeout", "unavailable", "rate_limited"]);

interface QueuedCandidate {
  candidate: RouteCandidate;
  /** Objectives the candidate was built for; scores its progress and rebuilds retries. */
  objectives: QuestObjective[];
  strategy?: string;
}

interface RoutingRun {
  scored: ScoredRoute[];
  failureCodes: string[];
  routingRequests: number;
  unroutable: Set<string>;
}

/**
 * Routes queued candidates through the routing service with limited concurrency and a shared
 * deadline, validates and scores the results, and retries without targets that proved
 * unroutable. Planned-but-unserved points within walking distance are reported as nearby;
 * other near-route points are ignored.
 */
const routeCandidates = async (
  queued: QueuedCandidate[],
  { requestId, input, bounds, eligibleTargets, maxRequests, routing, policy }: {
    requestId: string;
    input: RoutePlanningInput;
    /** Frozen exploration area; routes may not leave it except for an outside start's connector. */
    bounds?: GeoBounds;
    eligibleTargets: QuestRouteTarget[];
    maxRequests: number;
    routing: RouteProvider;
    policy: PlannerPolicy;
  }
): Promise<RoutingRun> => {
  const targetsById = new Map(eligibleTargets.map((target) => [target.id, target]));
  const queue: Array<QueuedCandidate> = [...queued];
  const attempted = new Set<string>();
  const unroutable = new Set<string>();
  const scored: ScoredRoute[] = [];
  const failureCodes: string[] = [];
  let routingRequests = 0;
  let stopRouting = false;
  const deadline = AbortSignal.timeout(PLANNING_LIMITS.planningDeadlineMs);

  const next = (): QueuedCandidate | undefined => {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      let candidate: RouteCandidate | undefined = entry.candidate;
      for (const id of unroutable) {
        if (candidate && candidate.stops.some((stop) => stop.target.id === id)) {
          candidate = withoutTarget(input, entry.objectives, candidate, id, policy);
        }
      }
      if (!candidate || attempted.has(candidate.key)) continue;
      attempted.add(candidate.key);
      return { ...entry, candidate };
    }
    return undefined;
  };

  const startOutside = bounds ? !insideBounds([input.start.lon, input.start.lat], bounds, 0) : false;
  const evaluate = ({ candidate, objectives, strategy }: QueuedCandidate, result: RoutingResult) => {
    if (bounds && !staysWithinBounds(result.geometry.coordinates, bounds, { startOutside, roundTrip: input.routeType === "round_trip" })) {
      failureCodes.push("outside_area");
      return;
    }
    const validation = validateRoute(result, eligibleTargets);
    const planned = new Set(candidate.stops.map((stop) => stop.target.id));
    const nearbyTargetIds = validation.nearbyTargetIds.filter((id) => planned.has(id));
    if (eligibleTargets.length > 0 && validation.includedTargetIds.length + nearbyTargetIds.length === 0) {
      failureCodes.push("no_targets_served");
      return;
    }
    const progress = objectiveProgress(objectives, [...validation.includedTargetIds, ...nearbyTargetIds]);
    const includedTargets = validation.includedTargetIds.map((id) => targetsById.get(id)!).filter(Boolean);
    scored.push({
      candidate,
      routing: result,
      includedTargetIds: validation.includedTargetIds,
      nearbyTargetIds,
      objectiveProgress: progress.objectives,
      progressPotential: progress.overall,
      ...(strategy ? { strategy } : {}),
      score: scoreRoute({
        routeType: input.routeType,
        constraint: input.constraint,
        routing: result,
        estimatedDistanceM: candidate.estimatedDistanceM,
        progress: progress.overall,
        includedTargets
      }, policy)
    });
  };

  const worker = async () => {
    while (!stopRouting && !deadline.aborted && routingRequests < maxRequests) {
      const entry = next();
      if (!entry) return;
      routingRequests += 1;
      const plan = buildRoutingPlan(input.start, input.end, entry.candidate.stops, profileForSport(input.sport));
      try {
        const result = await routing.route(plan.request, { requestId: `${requestId}-${routingRequests}`, signal: deadline });
        evaluate(entry, input.routeType === "round_trip" ? closeRoundTrip(result, input.start) : result);
      } catch (error) {
        const code = error instanceof RoutingError ? error.code : "unexpected";
        failureCodes.push(code);
        if (code === "rate_limited") stopRouting = true;
        if (error instanceof RoutingError && (code === "point_not_routable" || code === "snap_distance_exceeded")) {
          const targetId = error.waypointIndex !== undefined ? plan.waypointTargetIds.get(error.waypointIndex) : undefined;
          if (targetId) {
            unroutable.add(targetId);
            const retry = withoutTarget(input, entry.objectives, entry.candidate, targetId, policy);
            if (retry) queue.unshift({ ...entry, candidate: retry });
          }
        }
      }
    }
  };

  await Promise.all(Array.from({ length: PLANNING_LIMITS.routingConcurrency }, worker));
  return { scored, failureCodes, routingRequests, unroutable };
};

const noRouteError = (failureCodes: string[]): PlanningError => {
  const transientOnly = failureCodes.length > 0 && failureCodes.every((code) => transientCodes.has(code));
  return transientOnly
    ? new PlanningError("routing_unavailable", "Route planning is temporarily unavailable.")
    : new PlanningError("no_route", "No suitable route was found for this exploration.");
};

const setKey = (candidate: RouteCandidate): string => candidate.stops.map((stop) => stop.target.id).sort().join(",");

export interface GenerateExplorationRoutesInput {
  requestId: string;
  playerId: string;
  /** Correlation id for logs (the exploration session id). */
  scopeId: string;
  /** Every eligible destination of the frozen area; the planner chooses subsets itself. */
  targets: QuestRouteTarget[];
  /** Flowlines of the frozen area, analysed only after routing; never routing constraints. */
  flowlines: FlowlineGeometry[];
  input: RoutePlanningInput;
  /** Frozen exploration area bounding destinations and route geometry. */
  bounds?: GeoBounds;
}

/**
 * Route-first generation: builds candidates for several internal target-selection strategies
 * (peak-focused, balanced, discovery), interleaves them under one routing budget and
 * returns up to three distinct, relatively labelled proposals that may contain different
 * targets. It never touches gameplay state.
 */
export const generateExplorationRoutes = async (
  { requestId, playerId, scopeId, targets, flowlines, input, bounds }: GenerateExplorationRoutesInput,
  { routing, policy: basePolicy = DEFAULT_PLANNER_POLICY, now = Date.now, log = (entry) => console.log(JSON.stringify(entry)) }: PlannerDependencies
): Promise<PlannedProposal[]> => {
  const policy = policyForSport(basePolicy, input.sport);
  const startedAt = now();
  const perStrategy = buildStrategies(targets, input.constraint, policy).map((strategy) => {
    const pool = selectTargetPool(strategy.targets, strategy.objectives, input, policy);
    return {
      strategy,
      poolSize: pool.length,
      candidates: pool.length > 0 ? generateCandidates(input, strategy.objectives, pool, policy) : []
    };
  });

  // Round-robin across strategies so each gets routed; identical target sets are routed once.
  const queued: QueuedCandidate[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...perStrategy.map((entry) => entry.candidates.length));
  for (let index = 0; index < longest; index += 1) {
    for (const { strategy, candidates } of perStrategy) {
      const candidate = candidates[index];
      if (!candidate || seen.has(setKey(candidate))) continue;
      seen.add(setKey(candidate));
      queued.push({ candidate, objectives: strategy.objectives, strategy: strategy.name });
    }
  }

  const run = queued.length > 0
    ? await routeCandidates(queued, { requestId, input, bounds, eligibleTargets: targets, maxRequests: PLANNING_LIMITS.maxRoutingRequests, routing, policy })
    : { scored: [], failureCodes: [], routingRequests: 0, unroutable: new Set<string>() };
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const proposals = selectProposals(run.scored).map((selected) => ({
    proposal: toRouteProposal(selected, input, targetsById, flowlines, policy),
    stops: proposalStops(selected.route)
  }));
  log({
    event: "exploration_route_generate",
    requestId,
    playerId,
    explorationId: scopeId,
    eligibleTargetCount: targets.length,
    strategies: perStrategy.map(({ strategy, poolSize, candidates }) => ({ name: strategy.name, poolSize, candidates: candidates.length })),
    candidateCount: queued.length,
    routingRequests: run.routingRequests,
    routingFailures: run.failureCodes.length,
    failureCodes: [...new Set(run.failureCodes)].sort(),
    planningDurationMs: now() - startedAt,
    proposalCount: proposals.length
  });

  if (queued.length === 0) throw new PlanningError("no_reachable_targets", "No exploration targets are reachable with this start and ride length.");
  if (proposals.length === 0) throw noRouteError(run.failureCodes);
  return proposals;
};

export interface RerouteTargetsInput {
  requestId: string;
  playerId: string;
  scopeId: string;
  /** Proposal being customized: its label, recommendation and stop order are kept. */
  base: Pick<RouteProposal, "id" | "label" | "recommended">;
  baseStops: ProposalStop[];
  /** The exact edited target set, with objective ids assigned. */
  targets: QuestRouteTarget[];
  objectives: QuestObjective[];
  flowlines: FlowlineGeometry[];
  input: RoutePlanningInput;
  bounds?: GeoBounds;
  /** Route-only map points to pass through; they shape the route but are never targets. */
  waypoints?: LatLon[];
}

/** Id of a route-only waypoint; deterministic so a customized route keeps its stop order. */
export const waypointId = (point: LatLon): string => `waypoint:${point.lat.toFixed(6)},${point.lon.toFixed(6)}`;

const waypointTarget = (point: LatLon): QuestRouteTarget => ({
  kind: "point",
  id: waypointId(point),
  name: "Map point",
  objectiveIds: [],
  coordinate: point,
  radiusMeters: 0,
  alreadyAchieved: true,
  routeOnly: true
});

/** Stop order for an edited target set: keep the base order, insert new targets cheaply, then 2-opt. */
export const customizedStops = (
  input: RoutePlanningInput,
  baseStops: ProposalStop[],
  targets: QuestRouteTarget[],
  policy: PlannerPolicy = DEFAULT_PLANNER_POLICY
): CandidateStop[] => {
  const byId = new Map(targets.map((target) => [target.id, target]));
  let stops: CandidateStop[] = baseStops.flatMap((stop) => {
    const target = byId.get(stop.targetId);
    if (!target) return [];
    return [{ target }];
  });
  const kept = new Set(stops.map((stop) => stop.target.id));
  for (const target of targets) {
    if (!kept.has(target.id)) stops = cheapestInsertion(input, stops, target, policy.roadFactor).stops;
  }
  return improveOrder(input, stops, policy.roadFactor);
};

/**
 * Re-plans ONE customized route for an exact target set. The route is accepted even outside the
 * requested ride length (the proposal reports how it fits); unroutable targets are dropped and
 * reported. Only the edited targets count, so removed targets the road passes are not re-added.
 */
export const rerouteTargets = async (
  { requestId, playerId, scopeId, base, baseStops, targets, objectives, flowlines, input, bounds, waypoints = [] }: RerouteTargetsInput,
  { routing, policy: basePolicy = DEFAULT_PLANNER_POLICY, now = Date.now, log = (entry) => console.log(JSON.stringify(entry)) }: PlannerDependencies
): Promise<PlannedProposal> => {
  const policy = policyForSport(basePolicy, input.sport);
  const startedAt = now();
  const waypointTargets = waypoints.map(waypointTarget);
  const stops = customizedStops(input, baseStops, [...targets, ...waypointTargets], policy);
  const candidate = makeCandidate(input, objectives, stops, "custom", policy);
  const run = await routeCandidates([{ candidate, objectives }], {
    requestId, input, bounds, eligibleTargets: targets, maxRequests: PLANNING_LIMITS.maxRerouteRequests, routing, policy
  });
  const best = [...run.scored].sort((a, b) => routeTargetIds(b).length - routeTargetIds(a).length
    || b.score.total - a.score.total)[0];
  log({
    event: "exploration_route_reroute",
    requestId,
    playerId,
    explorationId: scopeId,
    baseProposalId: base.id,
    targetCount: targets.length,
    routingRequests: run.routingRequests,
    failureCodes: [...new Set(run.failureCodes)].sort(),
    planningDurationMs: now() - startedAt,
    routed: Boolean(best)
  });
  if (!best) throw noRouteError(run.failureCodes);
  const served = new Set(routeTargetIds(best));
  const droppedTargetIds = targets.map((target) => target.id).filter((id) => !served.has(id)).sort();
  const servedStops = new Set(best.candidate.stops.map((stop) => stop.target.id));
  const servedWaypoints = waypoints.filter((point) => servedStops.has(waypointId(point)));
  const droppedWaypoints = waypoints.filter((point) => !servedStops.has(waypointId(point)));
  const proposal = toRouteProposal({ label: base.label, route: best, recommended: base.recommended }, input,
    new Map(targets.map((target) => [target.id, target])), flowlines, policy);
  return {
    proposal: { ...proposal, customized: true, basedOn: base.id, ...(droppedTargetIds.length > 0 ? { droppedTargetIds } : {}),
      ...(servedWaypoints.length > 0 ? { waypoints: servedWaypoints } : {}),
      ...(droppedWaypoints.length > 0 ? { droppedWaypoints } : {}) },
    stops: proposalStops(best)
  };
};

export interface GenerateAreaRoutesInput {
  requestId: string;
  playerId: string;
  scopeId: string;
  flowlines: FlowlineGeometry[];
  input: RoutePlanningInput;
  bounds: GeoBounds;
  /** A destination every loop must pass through, with the objectives it advances. */
  required?: { target: QuestRouteTarget; objectives: QuestObjective[] };
}

/** Loop sizes of an area route: stops on an ellipse inscribed in the area, as a share of its half-extent. */
const AREA_LOOPS = [
  { label: "quick", stops: 2, reach: 0.4 },
  { label: "balanced", stops: 3, reach: 0.55 },
  { label: "adventure", stops: 4, reach: 0.7 }
] as const;

/** Largest share of an area loop that may retrace its own road. */
const MAX_AREA_BACKTRACK = 0.25;
/** Local spurs and zigzags are never returned: the router's geometry is shown as is, so they cannot be trimmed. */
const MAX_AREA_DETOUR_M = 150;

/** Share of the area diagonal within which a cycling Flowline point replaces a loop point. */
const FLOWLINE_SNAP_RATIO = 0.25;

/** Moves a point onto a nearby Flowline for cycling; running and hiking never follow Flowlines. */
const flowlineSnapper = (input: RoutePlanningInput, bounds: GeoBounds, flowlines: FlowlineGeometry[]) => {
  const snapM = FLOWLINE_SNAP_RATIO * distanceBetween(
    { lat: bounds.minLatitude, lon: bounds.minLongitude },
    { lat: bounds.maxLatitude, lon: bounds.maxLongitude }
  );
  const points = input.sport === undefined || input.sport === "cycling"
    ? flowlines.flatMap((flowline) => flowline.coordinates)
      .filter(([lon, lat]) => insideBounds([lon, lat], bounds, 0))
      .map(([lon, lat]) => ({ lat, lon }))
    : [];
  return (point: LatLon): LatLon => {
    let best = point;
    let nearest = snapM;
    for (const candidate of points) {
      const gap = distanceBetween(point, candidate);
      if (gap < nearest) {
        nearest = gap;
        best = candidate;
      }
    }
    return best;
  };
};

/**
 * Anchor points of a loop through the area, starting on the side nearest the start. Cycling
 * routes bend each point to a nearby Flowline so they follow existing Flowlines; running and
 * hiking never do.
 */
export const areaAnchors = (
  input: RoutePlanningInput,
  bounds: GeoBounds,
  flowlines: FlowlineGeometry[],
  loop: { stops: number; reach: number }
): LatLon[] => {
  const center = { lat: (bounds.minLatitude + bounds.maxLatitude) / 2, lon: (bounds.minLongitude + bounds.maxLongitude) / 2 };
  const halfLat = (bounds.maxLatitude - bounds.minLatitude) / 2;
  const halfLon = (bounds.maxLongitude - bounds.minLongitude) / 2;
  const first = Math.atan2((input.start.lat - center.lat) / (halfLat || 1), (input.start.lon - center.lon) / (halfLon || 1));
  const snap = flowlineSnapper(input, bounds, flowlines);
  const anchors = new Map<string, LatLon>();
  for (let index = 0; index < loop.stops; index += 1) {
    const angle = first + (2 * Math.PI * index) / loop.stops;
    const point = snap({
      lat: center.lat + Math.sin(angle) * halfLat * loop.reach,
      lon: center.lon + Math.cos(angle) * halfLon * loop.reach
    });
    anchors.set(waypointId(point), point);
  }
  return [...anchors.values()];
};

/** Loops through a destination: side anchors beside the start-destination line, as a share of its length. */
const DESTINATION_LOOPS = [
  { label: "quick", sides: [0.3] },
  { label: "balanced", sides: [-0.3, 0.3] },
  { label: "adventure", sides: [-0.55, 0.55] }
] as const;
const MIN_DESTINATION_SPAN_M = 1500;

/**
 * Stops of a loop that reaches the destination along one side and returns along the other, so
 * the way back does not retrace the way out. Anchors are clamped into the area.
 */
export const destinationStops = (
  input: RoutePlanningInput,
  bounds: GeoBounds,
  flowlines: FlowlineGeometry[],
  destination: QuestRouteTarget,
  sides: readonly number[]
): CandidateStop[] => {
  const { start } = input;
  const target = destination.coordinate;
  const scale = Math.cos((start.lat * Math.PI) / 180);
  const dx = (target.lon - start.lon) * scale;
  const dy = target.lat - start.lat;
  const spanM = Math.max(distanceBetween(start, target), MIN_DESTINATION_SPAN_M);
  const span = Math.hypot(dx, dy) || 1;
  const snap = flowlineSnapper(input, bounds, flowlines);
  const clamp = (point: LatLon): LatLon => ({
    lat: Math.min(bounds.maxLatitude, Math.max(bounds.minLatitude, point.lat)),
    lon: Math.min(bounds.maxLongitude, Math.max(bounds.minLongitude, point.lon))
  });
  const side = (offset: number): LatLon => {
    const metersToDeg = (spanM * Math.abs(offset)) / 111_320;
    const sign = Math.sign(offset);
    return snap(clamp({
      lat: (start.lat + target.lat) / 2 + (dx / span) * sign * metersToDeg,
      lon: (start.lon + target.lon) / 2 - ((dy / span) * sign * metersToDeg) / (scale || 1)
    }));
  };
  const outbound = sides.filter((offset) => offset < 0).map(side);
  const inbound = sides.filter((offset) => offset > 0).map(side);
  return [...outbound.map((point) => waypointTarget(point)), destination, ...inbound.map((point) => waypointTarget(point))]
    .map((stop) => ({ target: stop }));
};

/**
 * Route generation for an area without destinations: the bbox is the only hard fact. Routes are
 * loops of three sizes through route-only anchors, so they carry no objectives or progress.
 */
export const generateAreaRoutes = async (
  { requestId, playerId, scopeId, flowlines, input, bounds, required }: GenerateAreaRoutesInput,
  { routing, policy: basePolicy = DEFAULT_PLANNER_POLICY, now = Date.now, log = (entry) => console.log(JSON.stringify(entry)) }: PlannerDependencies
): Promise<PlannedProposal[]> => {
  const policy = policyForSport(basePolicy, input.sport);
  const startedAt = now();
  const seen = new Set<string>();
  const queued: QueuedCandidate[] = [];
  const objectives = required?.objectives ?? [];
  const shapes = required
    ? DESTINATION_LOOPS.map((loop) => destinationStops(input, bounds, flowlines, required.target, loop.sides))
    : AREA_LOOPS.map((loop) => areaAnchors(input, bounds, flowlines, loop).map((point) => ({ target: waypointTarget(point) })));
  for (const stops of shapes) {
    if (stops.length === 0) continue;
    const candidate = makeCandidate(input, objectives, stops, "custom", policy);
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    queued.push({ candidate, objectives });
  }
  const run = await routeCandidates(queued, {
    requestId, input, bounds, eligibleTargets: required ? [required.target] : [], maxRequests: PLANNING_LIMITS.maxRoutingRequests, routing, policy
  });
  // Loops should not ride the same road out and back; keep those only when nothing better exists.
  const direct = run.scored.filter((route) => detourLengthM(route.routing.geometry.coordinates) <= MAX_AREA_DETOUR_M);
  const loops = direct.filter((route) => backtrackRatio(route.routing.geometry.coordinates) <= MAX_AREA_BACKTRACK);
  const usable = loops.length > 0 ? loops : direct;
  const byLength = [...usable].sort((a, b) => a.routing.distanceM - b.routing.distanceM);
  const labels: ProposalLabel[][] = [[], ["balanced"], ["quick", "adventure"], ["quick", "balanced", "adventure"]];
  const best = [...usable].sort((a, b) => b.score.total - a.score.total)[0];
  const proposals = byLength.slice(0, 3).map((route, index, list) => {
    const proposal = toRouteProposal({ label: labels[list.length][index], route, recommended: route === best }, input,
      new Map(required ? [[required.target.id, required.target]] : []), flowlines, policy);
    const waypoints = route.candidate.stops.filter((stop) => stop.target.routeOnly).map((stop) => stop.target.coordinate);
    return { proposal: { ...proposal, waypoints }, stops: proposalStops(route) };
  });
  log({
    event: "exploration_area_route_generate",
    requestId,
    playerId,
    explorationId: scopeId,
    candidateCount: queued.length,
    routingRequests: run.routingRequests,
    failureCodes: [...new Set(run.failureCodes)].sort(),
    planningDurationMs: now() - startedAt,
    proposalCount: proposals.length
  });
  if (proposals.length === 0) throw noRouteError(run.failureCodes);
  return proposals;
};
