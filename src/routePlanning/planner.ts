import type { QuestObjective } from "../domain.js";
import { cheapestInsertion, improveOrder, makeCandidate, withoutTarget } from "./candidates.js";
import { closeRoundTrip } from "./roundTrip.js";
import { buildRoutingPlan } from "./routingPlan.js";
import { policyForSport, profileForSport } from "./sport.js";
import { DEFAULT_PLANNER_POLICY, PLANNING_LIMITS, type PlannerPolicy } from "./policy.js";
import { proposalStops, routeTargetIds, toRouteProposal } from "./proposals.js";
import { RoutingError } from "./routingClient.js";
import { objectiveProgress, scoreRoute } from "./scoring.js";
import type {
  CandidateStop,
  FlowlineGeometry,
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
import { axisAngleDegrees, bearing, distanceBetween, lineAxis } from "./geo.js";
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

export interface QueuedCandidate {
  candidate: RouteCandidate;
  /** Objectives the candidate was built for; scores its progress and rebuilds retries. */
  objectives: QuestObjective[];
  strategy?: string;
  /** Routes helper points as stops (`via`, U-turns allowed); a last resort when passing them leaves the area. */
  stopAtHelpers?: boolean;
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
export const routeCandidates = async (
  queued: QueuedCandidate[],
  { requestId, input, bounds, eligibleTargets, maxRequests, routing, policy, requireTargets = true }: {
    requestId: string;
    input: RoutePlanningInput;
    /** Frozen exploration area; routes may not leave it except for an outside start's connector. */
    bounds?: GeoBounds;
    eligibleTargets: QuestRouteTarget[];
    maxRequests: number;
    routing: RouteProvider;
    policy: PlannerPolicy;
    /** Discard routes that serve none of the eligible targets (default). */
    requireTargets?: boolean;
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
    if (requireTargets && eligibleTargets.length > 0 && validation.includedTargetIds.length + nearbyTargetIds.length === 0) {
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
      const plan = buildRoutingPlan(input.start, input.end, entry.candidate.stops, profileForSport(input.sport), { stopAtHelpers: entry.stopAtHelpers });
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

export const noRouteError = (failureCodes: string[]): PlanningError => {
  const transientOnly = failureCodes.length > 0 && failureCodes.every((code) => transientCodes.has(code));
  return transientOnly
    ? new PlanningError("routing_unavailable", "Route planning is temporarily unavailable.")
    : new PlanningError("no_route", "No suitable route was found for this exploration.");
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

export const waypointTarget = (point: LatLon): QuestRouteTarget => ({
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

/** Largest share of an area loop that may retrace its own road. */
export const MAX_AREA_BACKTRACK = 0.25;
/** Local spurs and zigzags are never returned: the router's geometry is shown as is, so they cannot be trimmed. */
export const MAX_AREA_DETOUR_M = 150;

/** Share of the area diagonal within which a cycling Flowline point replaces a loop point. */
const FLOWLINE_SNAP_RATIO = 0.25;
/**
 * A Flowline is only used along the route's own direction: its end-to-end axis may differ from
 * the local route direction by at most this many degrees. Crossing Flowlines are ignored, so the
 * route never turns off to ride a few hundred metres across its way and back.
 */
export const MAX_FLOWLINE_ANGLE_DEGREES = 35;
/** Flowlines that curl more than this (end-to-end distance / length) have no usable direction. */
export const MIN_FLOWLINE_STRAIGHTNESS = 0.5;

/** True when a Flowline runs along `heading` (radians, either direction). */
export const flowlineAlongHeading = (flowline: FlowlineGeometry, heading: number): boolean => {
  const axis = lineAxis(flowline.coordinates);
  return axis.straightness >= MIN_FLOWLINE_STRAIGHTNESS && axisAngleDegrees(axis.bearing, heading) <= MAX_FLOWLINE_ANGLE_DEGREES;
};

/**
 * Points along a Flowline in travel direction (`heading`): both ends and the middle vertex.
 */
const rideAlong = (flowline: FlowlineGeometry, heading: number): LatLon[] => {
  const points = flowline.coordinates.map(([lon, lat]) => ({ lat, lon }));
  const ends = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
  const forward = Math.cos(bearing(ends[0], ends[2]) - heading) >= 0;
  const ordered = forward ? ends : [...ends].reverse();
  return ordered.filter((point, index) => ordered.findIndex((other) => waypointId(other) === waypointId(point)) === index);
};

/**
 * Bends a loop point to a nearby Flowline for cycling; running and hiking never follow Flowlines.
 * Only Flowlines that run along the route's direction there (`heading`) are used, and such a
 * Flowline is ridden end to end in that direction instead of being touched at one vertex.
 * Crossing Flowlines are ignored.
 */
const flowlineSnapper = (input: RoutePlanningInput, bounds: GeoBounds, flowlines: FlowlineGeometry[]) => {
  const snapM = FLOWLINE_SNAP_RATIO * distanceBetween(
    { lat: bounds.minLatitude, lon: bounds.minLongitude },
    { lat: bounds.maxLatitude, lon: bounds.maxLongitude }
  );
  const usable = input.sport === undefined || input.sport === "cycling"
    ? flowlines.filter((flowline) => flowline.coordinates.every((point) => insideBounds(point, bounds, 0)))
    : [];
  const points = usable.flatMap((flowline) => flowline.coordinates.map(([lon, lat]) => ({ point: { lat, lon }, flowline })));
  return (point: LatLon, heading: number): LatLon[] => {
    let best: FlowlineGeometry | undefined;
    let nearest = snapM;
    const aligned = new Map<string, boolean>();
    for (const candidate of points) {
      const gap = distanceBetween(point, candidate.point);
      if (gap >= nearest) continue;
      let along = aligned.get(candidate.flowline.id);
      if (along === undefined) {
        along = flowlineAlongHeading(candidate.flowline, heading);
        aligned.set(candidate.flowline.id, along);
      }
      if (!along) continue;
      nearest = gap;
      best = candidate.flowline;
    }
    return best ? rideAlong(best, heading) : [point];
  };
};

/**
 * Anchor points of a loop through the area, starting on the side nearest the start. Cycling
 * routes ride a nearby Flowline that runs along the loop there instead of a loop point, so they
 * follow existing Flowlines; running and hiking never do.
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
  const onLoop = (angle: number): LatLon => ({
    lat: center.lat + Math.sin(angle) * halfLat * loop.reach,
    lon: center.lon + Math.cos(angle) * halfLon * loop.reach
  });
  const anchors = new Map<string, LatLon>();
  for (let index = 0; index < loop.stops; index += 1) {
    const angle = first + (2 * Math.PI * index) / loop.stops;
    for (const point of snap(onLoop(angle), bearing(onLoop(angle - 0.05), onLoop(angle + 0.05)))) {
      if (!anchors.has(waypointId(point))) anchors.set(waypointId(point), point);
    }
  }
  return [...anchors.values()];
};

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
  sides: readonly number[],
  /** Ride there on the positive side and back on the negative one. */
  mirrored = false
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
  const side = (heading: number) => (offset: number): LatLon[] => {
    const metersToDeg = (spanM * Math.abs(offset)) / 111_320;
    const sign = Math.sign(offset);
    return snap(clamp({
      lat: (start.lat + target.lat) / 2 + (dx / span) * sign * metersToDeg,
      lon: (start.lon + target.lon) / 2 - ((dy / span) * sign * metersToDeg) / (scale || 1)
    }), heading);
  };
  const outbound = sides.filter((offset) => (mirrored ? offset > 0 : offset < 0)).flatMap(side(bearing(start, target)));
  const inbound = sides.filter((offset) => (mirrored ? offset < 0 : offset > 0)).flatMap(side(bearing(target, start)));
  return [...outbound.map((point) => waypointTarget(point)), destination, ...inbound.map((point) => waypointTarget(point))]
    .map((stop) => ({ target: stop }));
};

/**
 * Points that make the router ride a Flowline from end to end, entering at the end nearer the
 * start: both ends and the middle vertex.
 */
export const flowlineRidePoints = (start: LatLon, flowline: FlowlineGeometry): LatLon[] => {
  const points = flowline.coordinates.map(([lon, lat]) => ({ lat, lon }));
  const first = points[0];
  const last = points[points.length - 1];
  const middle = points[Math.floor(points.length / 2)];
  const forward = distanceBetween(start, first) <= distanceBetween(start, last);
  const ordered = forward ? [first, middle, last] : [last, middle, first];
  return ordered.filter((point, index) => ordered.findIndex((other) => waypointId(other) === waypointId(point)) === index);
};

/**
 * Loop stops through a Flowline: the destination loop towards its far end, with the Flowline
 * ridden in place of the destination, so the way back leaves the Flowline instead of retracing it.
 */
export const flowlineStops = (
  input: RoutePlanningInput,
  bounds: GeoBounds,
  flowlines: FlowlineGeometry[],
  flowline: FlowlineGeometry,
  sides: readonly number[]
): CandidateStop[] => {
  const ride = flowlineRidePoints(input.start, flowline);
  const exit = waypointTarget(ride[ride.length - 1]);
  const loop = destinationStops(input, bounds, flowlines, exit, sides);
  const index = loop.findIndex((stop) => stop.target.id === exit.id);
  const rideIds = new Set(ride.map(waypointId));
  return [
    ...loop.slice(0, index).filter((stop) => !rideIds.has(stop.target.id)),
    ...ride.map((point) => ({ target: waypointTarget(point) })),
    ...loop.slice(index + 1).filter((stop) => !rideIds.has(stop.target.id))
  ];
};
