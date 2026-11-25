import { budgetMeters, estimateTour, makeCandidate } from "./candidates.js";
import { distanceBetween } from "./geo.js";
import {
  areaAnchors,
  destinationStops,
  flowlineRidePoints,
  flowlineStops,
  MAX_AREA_BACKTRACK,
  MAX_AREA_DETOUR_M,
  noRouteError,
  routeCandidates,
  waypointId,
  waypointTarget,
  type PlannedProposal,
  type PlannerDependencies,
  type QueuedCandidate
} from "./planner.js";
import { flowlineFit, poiValue, routeIntentPolicy, routeQuality, scoreForIntent, type IntentScore, type RouteIntent } from "./intent.js";
import { DEFAULT_PLANNER_POLICY, PLANNING_LIMITS, type PlannerPolicy } from "./policy.js";
import { proposalStops, routeTargetIds, toRouteProposal } from "./proposals.js";
import { backtrackRatio, detourLengthM } from "./roundTrip.js";
import { policyForSport } from "./sport.js";
import type { CandidateStop, FlowlineGeometry, LatLon, QuestRouteTarget, RoutePlanningInput, ScoredRoute } from "./types.js";
import { insideBounds, traversedFlowlines } from "./validation.js";
import type { QuestObjective } from "../domain.js";
import type { GeoBounds } from "../worldQuery.js";

/** Side anchors of a loop through a Flowline or destination, as a share of the start-target distance. */
const LOOP_SIDES = [-0.3, 0.3] as const;
/** Area-loop reaches tried to match the ride length: a share of the area's half-extent. */
const AREA_LOOP_REACHES = [0.35, 0.5, 0.65, 0.8] as const;
/** Tighter area loops, tried only when no first-pass route was usable. */
const FALLBACK_LOOP_REACHES = [0.2] as const;
const AREA_LOOP_STOPS = 3;
/** A start at least this far outside the area rides there and back on different sides. */
const MIN_CORRIDOR_M = 2000;
/** Side offset of the way there and back, as a share of the start-area distance. */
const CORRIDOR_SIDE = 0.3;
/** A Flowline skeleton may exceed the ride length by this share before it is not used. */
const SKELETON_LENGTH_TOLERANCE = 0.3;
/** Flowlines considered for chaining, best fit first. */
const MAX_CHAIN_CANDIDATES = 6;
/** Cost of a collectible's estimated detour, relative to the intent's detour budget, in POI value. */
const DETOUR_COST = 0.5;
/** Routed extra length per planned collectible may exceed the estimated budget by this factor. */
const ROUTED_DETOUR_SLACK = 1.5;

export interface GenerateIntentRouteInput {
  requestId: string;
  playerId: string;
  /** Correlation id for logs (the exploration session id). */
  scopeId: string;
  intent: RouteIntent;
  /** Every eligible collectible of the frozen area. */
  targets: QuestRouteTarget[];
  /** Plannable Flowlines of the frozen area (opportunities and completed ones). */
  flowlines: FlowlineGeometry[];
  input: RoutePlanningInput;
  bounds: GeoBounds;
  /** A collectible the route must visit ("Route to"), with the objectives it advances. */
  required?: { target: QuestRouteTarget; objectives: QuestObjective[] };
  /** A Flowline the route must ride in full ("Plan route via this Flowline"). */
  requiredFlowline?: FlowlineGeometry;
}

interface Skeleton {
  name: string;
  stops: CandidateStop[];
  /** Stop id → Flowline id for ride points; collectibles are never inserted inside a Flowline ride. */
  rides: Map<string, string>;
}

const rideStops = (start: CandidateStop["target"]["coordinate"], flowline: FlowlineGeometry) =>
  flowlineRidePoints(start, flowline).map((point) => ({ target: waypointTarget(point) }));

const ridesOf = (flowline: FlowlineGeometry, stops: CandidateStop[]): Array<[string, string]> =>
  stops.map((stop) => [stop.target.id, flowline.id]);

/** Positions between stops where something may be inserted without splitting a Flowline ride. */
const openPositions = (stops: CandidateStop[], rides: Map<string, string>): number[] =>
  Array.from({ length: stops.length + 1 }, (_value, position) => position).filter((position) => {
    if (position === 0 || position === stops.length) return true;
    const before = rides.get(stops[position - 1].target.id);
    return !before || before !== rides.get(stops[position].target.id);
  });

const insertBlock = (input: RoutePlanningInput, skeleton: Skeleton, blocks: CandidateStop[][], roadFactor: number) => {
  let best: { stops: CandidateStop[]; estimate: number } | undefined;
  for (const position of openPositions(skeleton.stops, skeleton.rides)) {
    for (const block of blocks) {
      const stops = [...skeleton.stops.slice(0, position), ...block, ...skeleton.stops.slice(position)];
      const estimate = estimateTour(input.start, input.end, stops, roadFactor);
      if (!best || estimate < best.estimate) best = { stops, estimate };
    }
  }
  return best!;
};

const flowlineInside = (flowline: FlowlineGeometry, bounds: GeoBounds) => flowline.coordinates.every((point) => insideBounds(point, bounds));

const areaLoops = (input: RoutePlanningInput, bounds: GeoBounds, flowlines: FlowlineGeometry[], reaches: readonly number[]): CandidateStop[][] =>
  reaches.map((reach) => areaAnchors(input, bounds, flowlines, { stops: AREA_LOOP_STOPS, reach }).map((point) => ({ target: waypointTarget(point) })));

/**
 * A round trip from a start outside the area would ride the same connector there and back. This
 * adds one route-only point beside that connector on each side (way there on one, way back on
 * the other), in the orientation that suits the loop's order best.
 */
const withCorridor = (input: RoutePlanningInput, bounds: GeoBounds, stops: CandidateStop[], roadFactor: number): CandidateStop[] => {
  const { start } = input;
  if (input.routeType !== "round_trip" || stops.length === 0) return stops;
  const entry: LatLon = {
    lat: Math.min(bounds.maxLatitude, Math.max(bounds.minLatitude, start.lat)),
    lon: Math.min(bounds.maxLongitude, Math.max(bounds.minLongitude, start.lon))
  };
  const distanceM = distanceBetween(start, entry);
  if (distanceM < MIN_CORRIDOR_M) return stops;
  const scale = Math.cos((start.lat * Math.PI) / 180) || 1;
  const dx = (entry.lon - start.lon) * scale;
  const dy = entry.lat - start.lat;
  const length = Math.hypot(dx, dy) || 1;
  const offset = (distanceM * CORRIDOR_SIDE) / 111_320;
  const side = (sign: number) => waypointTarget({
    lat: (start.lat + entry.lat) / 2 + (dx / length) * sign * offset,
    lon: (start.lon + entry.lon) / 2 - ((dy / length) * sign * offset) / scale
  });
  const options = [[side(-1), side(1)], [side(1), side(-1)]].map(([there, back]) => {
    const looped = [{ target: there }, ...stops, { target: back }];
    return { looped, estimate: estimateTour(input.start, input.end, looped, roadFactor) };
  });
  return options.sort((a, b) => a.estimate - b.estimate)[0].looped;
};

/**
 * Route skeletons before collectibles: a pinned destination or Flowline, a chain of the area's
 * best-fitting Flowlines (cycling only), and an area loop sized to the ride length as fallback.
 */
const buildSkeletons = (
  { intent, flowlines, input, bounds, required, requiredFlowline }: GenerateIntentRouteInput,
  policy: PlannerPolicy
): Skeleton[] => {
  const intentPolicy = routeIntentPolicy(intent);
  const budget = budgetMeters(input.constraint, policy);
  const estimate = (stops: CandidateStop[]) => estimateTour(input.start, input.end, stops, policy.roadFactor);
  if (required) {
    return [{ name: "destination", stops: destinationStops(input, bounds, flowlines, required.target, LOOP_SIDES), rides: new Map() }];
  }
  const cycling = input.sport === undefined || input.sport === "cycling";
  const flowlineLoop = (flowline: FlowlineGeometry): Skeleton => {
    const stops = flowlineStops(input, bounds, flowlines, flowline, LOOP_SIDES);
    const ride = new Set(flowlineRidePoints(input.start, flowline).map(waypointId));
    return { name: "flowline", stops, rides: new Map(stops.filter((stop) => ride.has(stop.target.id)).map((stop) => [stop.target.id, flowline.id])) };
  };
  if (requiredFlowline) return [flowlineLoop(requiredFlowline)];

  const skeletons: Skeleton[] = [];
  const ranked = cycling
    ? flowlines
      .filter((flowline) => flowlineInside(flowline, bounds))
      .map((flowline) => ({ flowline, fit: flowlineFit(flowline, intent) }))
      .filter(({ fit }) => fit >= intentPolicy.flowlines.minFit)
      .sort((a, b) => b.fit - a.fit || a.flowline.id.localeCompare(b.flowline.id))
      .slice(0, MAX_CHAIN_CANDIDATES)
      .map(({ flowline }) => flowline)
    : [];
  const maxLength = budget * (1 + SKELETON_LENGTH_TOLERANCE);
  const first = ranked.find((flowline) => estimate(flowlineLoop(flowline).stops) <= maxLength);
  if (first && intentPolicy.flowlines.max > 0) {
    const chained = flowlineLoop(first);
    let count = 1;
    for (const flowline of ranked) {
      if (count >= intentPolicy.flowlines.max) break;
      if (flowline.id === first.id || [...chained.rides.values()].includes(flowline.id)) continue;
      const forward = rideStops(input.start, flowline);
      const best = insertBlock(input, chained, [forward, [...forward].reverse()], policy.roadFactor);
      if (best.estimate > maxLength) continue;
      chained.stops = best.stops;
      for (const [id, rideId] of ridesOf(flowline, forward)) chained.rides.set(id, rideId);
      count += 1;
    }
    skeletons.push(chained);
  }

  if (input.routeType === "round_trip") {
    const loops = areaLoops(input, bounds, flowlines, AREA_LOOP_REACHES);
    const closest = [...loops].sort((a, b) => Math.abs(estimate(a) - budget) - Math.abs(estimate(b) - budget))[0];
    skeletons.push({ name: "area", stops: closest, rides: new Map() });
  } else {
    skeletons.push({ name: "direct", stops: [], rides: new Map() });
  }
  return skeletons;
};

/**
 * Greedy collectible insertion for the intent: each step adds the collectible with the best
 * value (diminishing per category, bonus for variety) minus its estimated detour, never more
 * than the intent's POI budget and never beyond its per-collectible detour budget.
 */
export const insertPois = (
  input: RoutePlanningInput,
  skeleton: Skeleton,
  candidates: QuestRouteTarget[],
  intent: RouteIntent,
  policy: PlannerPolicy
): { stops: CandidateStop[]; pois: QuestRouteTarget[] } => {
  const { pois: budget } = routeIntentPolicy(intent);
  const maxLength = budgetMeters(input.constraint, policy) * (1 + policy.acceptableTolerance);
  let current: Skeleton = { ...skeleton, stops: [...skeleton.stops] };
  let estimate = estimateTour(input.start, input.end, current.stops, policy.roadFactor);
  const chosen: QuestRouteTarget[] = [];
  while (chosen.length < budget.max) {
    let best: { target: QuestRouteTarget; stops: CandidateStop[]; estimate: number; utility: number } | undefined;
    for (const target of candidates) {
      if (chosen.includes(target)) continue;
      const inserted = insertBlock(input, current, [[{ target }]], policy.roadFactor);
      const extra = inserted.estimate - estimate;
      if (extra > budget.maxDetourMeters || (inserted.estimate > maxLength && extra > 0)) continue;
      const utility = poiValue([...chosen, target]) - poiValue(chosen) - (Math.max(0, extra) / budget.maxDetourMeters) * DETOUR_COST;
      if (utility > 0 && (!best || utility > best.utility || (utility === best.utility && target.id < best.target.id))) {
        best = { target, stops: inserted.stops, estimate: inserted.estimate, utility };
      }
    }
    if (!best) break;
    chosen.push(best.target);
    current = { ...current, stops: best.stops };
    estimate = best.estimate;
  }
  return { stops: current.stops, pois: chosen };
};

interface Evaluated {
  route: ScoredRoute;
  skeleton: string;
  variant: string;
  pois: number;
  quality: number;
  intent: IntentScore;
}

/**
 * "Generate route" v2: ONE route for the player's intent. A Flowline skeleton (or an area loop)
 * comes first, a few collectibles are added only within the intent's detour budget, and the
 * variants are routed and scored by the intent's weighted mix. Collectibles never cost route
 * quality: a variant with collectibles must stay above the quality floor and close to its
 * skeleton's quality, otherwise the collectible-free skeleton wins.
 */
export const generateIntentRoute = async (
  generation: GenerateIntentRouteInput,
  { routing, policy: basePolicy = DEFAULT_PLANNER_POLICY, now = Date.now, log = (entry) => console.log(JSON.stringify(entry)) }: PlannerDependencies
): Promise<PlannedProposal> => {
  const { requestId, playerId, scopeId, intent, targets, flowlines, input, bounds, required, requiredFlowline } = generation;
  const policy = policyForSport(basePolicy, input.sport);
  const intentPolicy = routeIntentPolicy(intent);
  const startedAt = now();
  const objectives = required?.objectives ?? [];
  const skeletons = buildSkeletons(generation, policy);
  // A pinned destination or Flowline is the player's chosen goal: add no collectibles around it.
  const pinned = Boolean(required || requiredFlowline);
  const poiCandidates = pinned ? [] : targets.filter((target) => !target.routeOnly
    && insideBounds([target.coordinate.lon, target.coordinate.lat], bounds, 0));

  const queued: QueuedCandidate[] = [];
  const seen = new Set<string>();
  const enqueue = (skeleton: string, variant: string, stops: CandidateStop[], corridor = true) => {
    const routed = corridor ? withCorridor(input, bounds, stops, policy.roadFactor) : stops;
    const candidate = makeCandidate(input, objectives, routed, "custom", policy);
    if (seen.has(candidate.key)) return;
    seen.add(candidate.key);
    queued.push({ candidate, objectives, strategy: `${skeleton}:${variant}` });
  };
  for (const skeleton of skeletons) {
    const { stops, pois } = insertPois(input, skeleton, poiCandidates, intent, policy);
    if (pois.length > 0) enqueue(skeleton.name, "pois", stops);
    if (pois.length > 1) {
      // Without the collectible that costs the most, in case the full set bends the route.
      const costliest = pois.reduce((worst, poi) => {
        const without = stops.filter((stop) => stop.target.id !== poi.id);
        const saving = estimateTour(input.start, input.end, stops, policy.roadFactor) - estimateTour(input.start, input.end, without, policy.roadFactor);
        return saving > worst.saving ? { poi, saving } : worst;
      }, { poi: pois[0], saving: -Infinity }).poi;
      enqueue(skeleton.name, "reduced", stops.filter((stop) => stop.target.id !== costliest.id));
    }
    enqueue(skeleton.name, "skeleton", skeleton.stops);
  }
  // If the side roads do not route, the direct way there and back is still a route.
  const area = skeletons.find((skeleton) => skeleton.name === "area");
  if (area) enqueue("area", "direct", area.stops, false);

  const routeQueued = (entries: QueuedCandidate[], maxRequests: number) => routeCandidates(entries, {
    requestId, input, bounds, eligibleTargets: targets, maxRequests, routing, policy, requireTargets: false
  });
  const run = await routeQueued(queued, PLANNING_LIMITS.maxRoutingRequests);
  // Roads often bend out of a small area, and loop points may fall into water or forest. When no
  // route was usable, try the remaining, tighter area loops with the unused routing budget, so a
  // route is found wherever there are roads.
  const remaining = PLANNING_LIMITS.maxRoutingRequests - run.routingRequests;
  const retryable = run.failureCodes.length > 0 && !run.failureCodes.includes("rate_limited");
  if (run.scored.length === 0 && !pinned && input.routeType === "round_trip" && remaining > 0 && retryable) {
    const fallbackStart = queued.length;
    const loops = areaLoops(input, bounds, flowlines, [...FALLBACK_LOOP_REACHES, ...AREA_LOOP_REACHES]);
    for (const stops of loops) enqueue("area", "skeleton", stops);
    const fallback = await routeQueued(queued.slice(fallbackStart), remaining);
    run.scored.push(...fallback.scored);
    run.failureCodes.push(...fallback.failureCodes);
    run.routingRequests += fallback.routingRequests;
  }
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const evaluated: Evaluated[] = run.scored
    .filter((route) => !required || routeTargetIds(route).includes(required.target.id))
    .filter((route) => !requiredFlowline || traversedFlowlines(route.routing, [requiredFlowline]).length > 0)
    .map((route) => {
      const [skeleton, variant] = (route.strategy ?? "area:skeleton").split(":");
      const contained = routeTargetIds(route).map((id) => targetsById.get(id)!).filter(Boolean);
      return {
        route,
        skeleton,
        variant,
        pois: route.candidate.stops.filter((stop) => !stop.target.routeOnly && stop.target.id !== required?.target.id).length,
        quality: routeQuality(route, input.routeType),
        intent: scoreForIntent(route, { intent, routeType: input.routeType, flowlines, targets: contained })
      };
    });
  // Loops should not ride the same road out and back or take local spurs; keep those only when nothing better exists.
  const clean = evaluated.filter(({ route }) => detourLengthM(route.routing.geometry.coordinates) <= MAX_AREA_DETOUR_M
    && backtrackRatio(route.routing.geometry.coordinates) <= MAX_AREA_BACKTRACK);
  const usable = clean.length > 0 ? clean : evaluated;
  const skeletonOf = new Map(usable.filter((entry) => entry.variant === "skeleton").map((entry) => [entry.skeleton, entry]));
  const keepsQuality = (entry: Evaluated) => {
    if (entry.quality < intentPolicy.qualityFloor) return false;
    const base = skeletonOf.get(entry.skeleton);
    if (entry.pois === 0 || !base) return true;
    return entry.quality >= base.quality - intentPolicy.maxQualityDrop
      && entry.route.routing.distanceM - base.route.routing.distanceM <= entry.pois * intentPolicy.pois.maxDetourMeters * ROUTED_DETOUR_SLACK;
  };
  const accepted = usable.filter(keepsQuality);
  const byPreference = (a: Evaluated, b: Evaluated) => b.intent.total - a.intent.total
    || a.route.routing.distanceM - b.route.routing.distanceM || a.route.candidate.key.localeCompare(b.route.candidate.key);
  const best = accepted.length > 0
    ? [...accepted].sort(byPreference)[0]
    : [...usable].sort((a, b) => b.quality - a.quality || byPreference(a, b))[0];

  log({
    event: "exploration_intent_route_generate",
    requestId,
    playerId,
    explorationId: scopeId,
    intent,
    skeletons: skeletons.map((skeleton) => skeleton.name),
    candidateCount: queued.length,
    routingRequests: run.routingRequests,
    failureCodes: [...new Set(run.failureCodes)].sort(),
    acceptedCount: accepted.length,
    chosen: best ? { skeleton: best.skeleton, variant: best.variant, pois: best.pois, score: best.intent } : undefined,
    planningDurationMs: now() - startedAt
  });
  if (!best) throw noRouteError(run.failureCodes);

  const proposal = toRouteProposal({ label: "balanced", route: best.route, recommended: true }, input, targetsById, flowlines, policy);
  const waypoints = best.route.candidate.stops.filter((stop) => stop.target.routeOnly).map((stop) => stop.target.coordinate);
  return { proposal: { ...proposal, waypoints }, stops: proposalStops(best.route) };
};
