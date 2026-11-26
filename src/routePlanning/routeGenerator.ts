import { budgetMeters, estimateTour, makeCandidate } from "./candidates.js";
import { bearing, distanceBetween } from "./geo.js";
import {
  areaAnchors,
  destinationStops,
  flowlineAlongHeading,
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
import { flowlineFit, GENERATION_POLICY, poiValue, routeQuality, scoreGeneratedRoute, type GenerationScore } from "./generationPolicy.js";
import { DEFAULT_PLANNER_POLICY, PLANNING_LIMITS, type PlannerPolicy } from "./policy.js";
import { proposalStops, routeTargetIds, toRouteProposal } from "./proposals.js";
import { backtrackRatio, detourLengthM, routeKnots } from "./roundTrip.js";
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
/** Cost of a collectible's estimated detour, relative to the detour budget, in POI value. */
const DETOUR_COST = 0.5;
/** Routed extra length per planned collectible may exceed the estimated budget by this factor. */
const ROUTED_DETOUR_SLACK = 1.5;

export interface GenerateRouteInput {
  requestId: string;
  playerId: string;
  /** Correlation id for logs (the exploration session id). */
  scopeId: string;
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
  /**
   * The aimed target: the route passes within `AIM_RADIUS_M` of it (round trips ride there along one
   * side and back along the other, A→B routes end there). `bounds` is then the corridor around it.
   */
  aim?: LatLon;
}

/** An aimed route must pass this close to its target. */
export const AIM_RADIUS_M = 1_000;
/** Narrower side offsets of an aimed loop; rivers and hills often suit one of them better. */
const AIM_NARROW_SIDES = [-0.15, 0.15] as const;

const reachesAim = (route: ScoredRoute, aim: LatLon): boolean =>
  route.routing.geometry.coordinates.some(([lon, lat]) => distanceBetween({ lat, lon }, aim) <= AIM_RADIUS_M);

/** The skeleton towards an aimed target: a loop there and back on different sides, or nothing for A→B. */
const aimStops = (input: RoutePlanningInput, bounds: GeoBounds, flowlines: FlowlineGeometry[], aim: LatLon, sides: readonly number[], mirrored = false): CandidateStop[] =>
  input.routeType === "round_trip" ? destinationStops(input, bounds, flowlines, waypointTarget(aim), sides, mirrored) : [];

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

const insertBlock = (
  input: RoutePlanningInput,
  skeleton: Skeleton,
  blocks: CandidateStop[][],
  roadFactor: number,
  accept: (position: number) => boolean = () => true
) => {
  let best: { stops: CandidateStop[]; estimate: number } | undefined;
  for (const position of openPositions(skeleton.stops, skeleton.rides)) {
    if (!accept(position)) continue;
    for (const block of blocks) {
      const stops = [...skeleton.stops.slice(0, position), ...block, ...skeleton.stops.slice(position)];
      const estimate = estimateTour(input.start, input.end, stops, roadFactor);
      if (!best || estimate < best.estimate) best = { stops, estimate };
    }
  }
  return best;
};

/** Legs shorter than this have no meaningful direction; any Flowline may be inserted there. */
const MIN_DIRECTED_LEG_M = 500;

/** Positions where a Flowline runs along the leg it is inserted into. */
const alignedPosition = (input: RoutePlanningInput, stops: CandidateStop[], flowline: FlowlineGeometry) => (position: number): boolean => {
  const from = position === 0 ? input.start : stops[position - 1].target.coordinate;
  const to = position === stops.length ? input.end : stops[position].target.coordinate;
  return distanceBetween(from, to) < MIN_DIRECTED_LEG_M || flowlineAlongHeading(flowline, bearing(from, to));
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
 * Rides every Flowline of a skeleton in the direction that suits its neighbours: entering a
 * Flowline at the wrong end makes the route ride it and come back across itself.
 */
const orientRides = (skeleton: Skeleton, estimate: (stops: CandidateStop[]) => number): Skeleton => {
  let stops = skeleton.stops;
  for (const flowlineId of new Set(skeleton.rides.values())) {
    const indexes = stops.flatMap((stop, index) => skeleton.rides.get(stop.target.id) === flowlineId ? [index] : []);
    const from = indexes[0];
    const to = indexes[indexes.length - 1] + 1;
    const flipped = [...stops.slice(0, from), ...stops.slice(from, to).reverse(), ...stops.slice(to)];
    if (estimate(flipped) < estimate(stops)) stops = flipped;
  }
  return { ...skeleton, stops };
};

/**
 * Route skeletons before collectibles: a pinned destination or Flowline, a chain of the area's
 * best-fitting Flowlines (cycling only), and an area loop sized to the ride length as fallback.
 */
const buildSkeletons = (
  { flowlines, input, bounds, required, requiredFlowline, aim }: GenerateRouteInput,
  policy: PlannerPolicy
): Skeleton[] => {
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
      .map((flowline) => ({ flowline, fit: flowlineFit(flowline) }))
      .filter(({ fit }) => fit >= GENERATION_POLICY.flowlines.minFit)
      .sort((a, b) => b.fit - a.fit || a.flowline.id.localeCompare(b.flowline.id))
      .slice(0, MAX_CHAIN_CANDIDATES)
      .map(({ flowline }) => flowline)
    : [];
  const maxLength = budget * (1 + SKELETON_LENGTH_TOLERANCE);
  /** Adds the ranked Flowlines that run along a leg of the skeleton, within the ride length. */
  const chain = (chained: Skeleton, count: number): Skeleton => {
    for (const flowline of ranked) {
      if (count >= GENERATION_POLICY.flowlines.max) break;
      if ([...chained.rides.values()].includes(flowline.id)) continue;
      const forward = rideStops(input.start, flowline);
      const best = insertBlock(input, chained, [forward, [...forward].reverse()], policy.roadFactor,
        alignedPosition(input, chained.stops, flowline));
      if (!best || best.estimate > maxLength) continue;
      chained.stops = best.stops;
      for (const [id, rideId] of ridesOf(flowline, forward)) chained.rides.set(id, rideId);
      count += 1;
    }
    return orientRides(chained, estimate);
  };
  if (aim) {
    const stops = aimStops(input, bounds, flowlines, aim, LOOP_SIDES);
    if (GENERATION_POLICY.flowlines.max > 0 && ranked.length > 0) {
      const chained = chain({ name: "flowline", stops: [...stops], rides: new Map() }, 0);
      if (chained.rides.size > 0) skeletons.push(chained);
    }
    skeletons.push({ name: "aim", stops, rides: new Map() });
    return skeletons;
  }
  const first = ranked.find((flowline) => estimate(flowlineLoop(flowline).stops) <= maxLength);
  if (first && GENERATION_POLICY.flowlines.max > 0) skeletons.push(chain(flowlineLoop(first), 1));

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
 * Greedy collectible insertion: each step adds the collectible with the best
 * value (diminishing per category, bonus for variety) minus its estimated detour, never more
 * than the POI budget and never beyond its per-collectible detour budget.
 */
export const insertPois = (
  input: RoutePlanningInput,
  skeleton: Skeleton,
  candidates: QuestRouteTarget[],
  policy: PlannerPolicy
): { stops: CandidateStop[]; pois: QuestRouteTarget[] } => {
  const { pois: budget } = GENERATION_POLICY;
  const maxLength = budgetMeters(input.constraint, policy) * (1 + policy.acceptableTolerance);
  let current: Skeleton = { ...skeleton, stops: [...skeleton.stops] };
  let estimate = estimateTour(input.start, input.end, current.stops, policy.roadFactor);
  const chosen: QuestRouteTarget[] = [];
  while (chosen.length < budget.max) {
    let best: { target: QuestRouteTarget; stops: CandidateStop[]; estimate: number; utility: number } | undefined;
    for (const target of candidates) {
      if (chosen.includes(target)) continue;
      const inserted = insertBlock(input, current, [[{ target }]], policy.roadFactor)!;
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
  score: GenerationScore;
  knots: [number, number][][];
}

/** Repair attempts for a chosen route with knots; each costs one routing request. */
const MAX_SMOOTHING_ROUNDS = 2;
/** Stops this close to a knot are taken as its cause. */
const KNOT_CAUSE_M = 400;
/** A repaired tour must still be estimated at this share of the ride length. */
const MIN_SMOOTHED_SHARE = 0.6;

/**
 * The chosen route's stops without what caused its knots: helper points and collectibles close to
 * a knot, and every ride point of a Flowline any of them belongs to. Undefined if nothing is near.
 */
const withoutKnots = (
  input: RoutePlanningInput,
  entry: Evaluated,
  skeletons: Skeleton[],
  policy: PlannerPolicy,
  requiredId?: string
): CandidateStop[] | undefined => {
  const stops = entry.route.candidate.stops;
  const rides = skeletons.find((skeleton) => skeleton.name === entry.skeleton)?.rides ?? new Map<string, string>();
  const near = (stop: CandidateStop) => entry.knots.some((knot) => knot.some(([lon, lat]) =>
    distanceBetween({ lat, lon }, stop.target.coordinate) <= KNOT_CAUSE_M));
  const causes = stops.filter((stop) => stop.target.id !== requiredId && near(stop));
  if (causes.length === 0) return undefined;
  const flowlineIds = new Set(causes.flatMap((stop) => rides.get(stop.target.id) ?? []));
  const dropped = new Set(causes.map((stop) => stop.target.id));
  const kept = stops.filter((stop) => !dropped.has(stop.target.id) && !flowlineIds.has(rides.get(stop.target.id) ?? ""));
  if (kept.length === 0) return undefined;
  const estimate = estimateTour(input.start, input.end, kept, policy.roadFactor);
  return estimate >= budgetMeters(input.constraint, policy) * MIN_SMOOTHED_SHARE ? kept : undefined;
};

/**
 * "Generate route": ONE route. A Flowline skeleton (or an area loop) comes first, a few
 * collectibles are added only within the detour budget, and the variants are routed and scored
 * by the generation policy's weighted mix. Collectibles never cost route
 * quality: a variant with collectibles must stay above the quality floor and close to its
 * skeleton's quality, otherwise the collectible-free skeleton wins.
 */
export const generateRoute = async (
  generation: GenerateRouteInput,
  { routing, policy: basePolicy = DEFAULT_PLANNER_POLICY, now = Date.now, log = (entry) => console.log(JSON.stringify(entry)) }: PlannerDependencies
): Promise<PlannedProposal> => {
  const { requestId, playerId, scopeId, targets, flowlines, input, bounds, required, requiredFlowline, aim } = generation;
  const policy = policyForSport(basePolicy, input.sport);
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
    const { stops, pois } = insertPois(input, skeleton, poiCandidates, policy);
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
  if (aim && input.routeType === "round_trip") {
    // The same loop on the other sides and a narrower one, then straight there and back.
    enqueue("aim", "mirrored", aimStops(input, bounds, flowlines, aim, LOOP_SIDES, true));
    enqueue("aim", "narrow", aimStops(input, bounds, flowlines, aim, AIM_NARROW_SIDES));
    enqueue("aim", "direct", [{ target: waypointTarget(aim) }], false);
  }

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
    const loops = aim
      ? [aimStops(input, bounds, flowlines, aim, AIM_NARROW_SIDES, true)]
      : areaLoops(input, bounds, flowlines, [...FALLBACK_LOOP_REACHES, ...AREA_LOOP_REACHES]);
    for (const stops of loops) enqueue(aim ? "aim" : "area", "skeleton", stops);
    const fallback = await routeQueued(queued.slice(fallbackStart), remaining);
    run.scored.push(...fallback.scored);
    run.failureCodes.push(...fallback.failureCodes);
    run.routingRequests += fallback.routingRequests;
  }
  // Passing helper points without turning can force the road out of the area (coasts, rivers).
  // As a last resort, route the same candidates with the helpers as stops.
  const left = PLANNING_LIMITS.maxRoutingRequests - run.routingRequests;
  if (run.scored.length === 0 && left > 0 && run.failureCodes.includes("outside_area") && !run.failureCodes.includes("rate_limited")) {
    const stopping = await routeQueued(queued.map((entry) => ({ ...entry, stopAtHelpers: true })), left);
    run.scored.push(...stopping.scored);
    run.failureCodes.push(...stopping.failureCodes);
    run.routingRequests += stopping.routingRequests;
  }
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const evaluations = new Map<ScoredRoute, Evaluated>();
  const evaluate = (route: ScoredRoute): Evaluated => {
    const known = evaluations.get(route);
    if (known) return known;
    const [skeleton, variant] = (route.strategy ?? "area:skeleton").split(":");
    const contained = routeTargetIds(route).map((id) => targetsById.get(id)!).filter(Boolean);
    const entry: Evaluated = {
      route,
      skeleton,
      variant,
      pois: route.candidate.stops.filter((stop) => !stop.target.routeOnly && stop.target.id !== required?.target.id).length,
      quality: routeQuality(route, input.routeType),
      score: scoreGeneratedRoute(route, { routeType: input.routeType, flowlines, targets: contained }),
      knots: routeKnots(route.routing.geometry.coordinates)
    };
    evaluations.set(route, entry);
    return entry;
  };
  const choose = () => {
    const evaluated = run.scored
      .filter((route) => !required || routeTargetIds(route).includes(required.target.id))
      .filter((route) => !requiredFlowline || traversedFlowlines(route.routing, [requiredFlowline]).length > 0)
      .filter((route) => !aim || reachesAim(route, aim))
      .map(evaluate);
    // Loops should not ride the same road out and back or take local spurs; keep those only when
    // nothing better exists. Knots only cost route quality, so a tiny loop never wins for lacking one.
    const clean = evaluated.filter(({ route }) => detourLengthM(route.routing.geometry.coordinates) <= MAX_AREA_DETOUR_M
      && backtrackRatio(route.routing.geometry.coordinates) <= MAX_AREA_BACKTRACK);
    const usable = clean.length > 0 ? clean : evaluated;
    const skeletonOf = new Map(usable.filter((entry) => entry.variant === "skeleton").map((entry) => [entry.skeleton, entry]));
    const keepsQuality = (entry: Evaluated) => {
      if (entry.quality < GENERATION_POLICY.qualityFloor) return false;
      const base = skeletonOf.get(entry.skeleton);
      if (entry.pois === 0 || !base) return true;
      return entry.quality >= base.quality - GENERATION_POLICY.maxQualityDrop
        && entry.route.routing.distanceM - base.route.routing.distanceM <= entry.pois * GENERATION_POLICY.pois.maxDetourMeters * ROUTED_DETOUR_SLACK;
    };
    const accepted = usable.filter(keepsQuality);
    const byPreference = (a: Evaluated, b: Evaluated) => b.score.total - a.score.total
      || a.route.routing.distanceM - b.route.routing.distanceM || a.route.candidate.key.localeCompare(b.route.candidate.key);
    const best = accepted.length > 0
      ? [...accepted].sort(byPreference)[0]
      : [...usable].sort((a, b) => b.quality - a.quality || byPreference(a, b))[0];
    return { best, accepted };
  };
  let { best, accepted } = choose();
  // A knot is a small loop the router rides to pass a helper point from its far side or to ride a
  // short Flowline and come back. Drop the helper points (with their whole Flowline ride) and
  // collectibles at the knot and route once more, while budget remains.
  for (let round = 0; round < MAX_SMOOTHING_ROUNDS && best && best.knots.length > 0; round += 1) {
    const left = PLANNING_LIMITS.maxRoutingRequests - run.routingRequests;
    if (left <= 0 || run.failureCodes.includes("rate_limited")) break;
    const smoothed = withoutKnots(input, best, skeletons, policy, required?.target.id ?? (aim ? waypointTarget(aim).id : undefined));
    if (!smoothed) break;
    const before = queued.length;
    enqueue(best.skeleton, "smoothed", smoothed, false);
    if (queued.length === before) break;
    const retry = await routeQueued(queued.slice(before), 1);
    run.scored.push(...retry.scored);
    run.failureCodes.push(...retry.failureCodes);
    run.routingRequests += retry.routingRequests;
    ({ best, accepted } = choose());
  }

  log({
    event: "exploration_route_generate",
    requestId,
    playerId,
    explorationId: scopeId,
    skeletons: skeletons.map((skeleton) => skeleton.name),
    aimed: Boolean(aim),
    candidateCount: queued.length,
    routingRequests: run.routingRequests,
    failureCodes: [...new Set(run.failureCodes)].sort(),
    acceptedCount: accepted.length,
    chosen: best ? { skeleton: best.skeleton, variant: best.variant, pois: best.pois, knots: best.knots.length, score: best.score } : undefined,
    planningDurationMs: now() - startedAt
  });
  if (!best) throw noRouteError(run.failureCodes);

  const proposal = toRouteProposal({ label: "balanced", route: best.route, recommended: true }, input, targetsById, flowlines, policy);
  const waypoints = best.route.candidate.stops.filter((stop) => stop.target.routeOnly).map((stop) => stop.target.coordinate);
  return { proposal: { ...proposal, waypoints }, stops: proposalStops(best.route) };
};
