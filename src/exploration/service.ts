import { randomUUID } from "node:crypto";
import type { NewPlannedRoute, QuestObjective, WorldCollectible, WorldFartlek } from "../domain.js";
import { UserInputError } from "../errors.js";
import { generateRoute } from "../routePlanning/routeGenerator.js";
import { PlanningError, rerouteTargets, waypointTarget, type PlannedProposal, type RouteProvider } from "../routePlanning/planner.js";
import { PLANNING_LIMITS } from "../routePlanning/policy.js";
import type { ProposalStore } from "../routePlanning/proposalStore.js";
import { routeTargetIds } from "../routePlanning/proposals.js";
import { distanceBetween } from "../routePlanning/geo.js";
import { insideBounds, traversedFlowlines } from "../routePlanning/validation.js";
import { assertNearTargets, parseProposalId } from "../routePlanning/request.js";
import { constraintActual, constraintRequested } from "../routePlanning/scoring.js";
import { profileForSport } from "../routePlanning/sport.js";
import { buildExplorationTargets, buildFlowlineGeometries, MAX_AVAILABLE_TARGETS } from "../routePlanning/targets.js";
import { PLANNER_VERSION, type QuestRouteTarget, type RoutePlanningInput, type RouteProposal, type RoutingResult } from "../routePlanning/types.js";
import type { GeoBounds } from "../worldQuery.js";
import { planManualRoute, startToNearestStopM, type ManualStop } from "../routePlanning/manual.js";
import { describeExploration, explorationObjectives, flowlineObjective, withObjectiveIds } from "./objectives.js";
import { parseExplorationId, parseFlowlineEnhancementRequest, parseGenerateRequest, parsePlanRequest, parseRerouteRequest } from "./request.js";
import type { ExplorationSessionStore } from "./sessionStore.js";

/** Exploration persisted when the player saves a route; its id is the saved proposal id (idempotency key). */
export interface NewExploration {
  proposalId: string;
  title: string;
  description: string;
  objectives: QuestObjective[];
}

export interface ExplorationDependencies {
  /**
   * Plannable World objects of the frozen area for the player, nearest to the area center first:
   * its collectibles and the Flowlines a route may use (the area's opportunities and the player's
   * completed ones). Planning is stateless: it never depends on, or writes, reveal state.
   */
  loadArea(playerId: string, bounds: GeoBounds): Promise<{ collectibles: WorldCollectible[]; flowlines: WorldFartlek[]; truncated: boolean }>;
  /** Separate baseline inputs so automatic generation need not fetch Flowlines first. */
  loadCollectibles?(playerId: string, bounds: GeoBounds): Promise<{ collectibles: WorldCollectible[]; truncated: boolean }>;
  loadFlowlines?(playerId: string, bounds: GeoBounds): Promise<WorldFartlek[]>;
  /** Undefined when no routing service is configured. */
  routing?: RouteProvider;
  sessions: ExplorationSessionStore;
  proposals: ProposalStore;
  explorations: {
    /** Saves an active Exploration; idempotent per proposal id. */
    createExploration(playerId: string, exploration: NewExploration, route: NewPlannedRoute): Promise<string>;
  };
  log?: (entry: Record<string, unknown>) => void;
}

export type ExplorationErrorCode =
  | "planning_unavailable"
  | "exploration_expired"
  | "proposal_expired"
  | "no_targets"
  | "no_reachable_targets"
  | "no_route";

const statusByCode: Record<ExplorationErrorCode, number> = {
  planning_unavailable: 503,
  exploration_expired: 409,
  proposal_expired: 409,
  no_targets: 422,
  no_reachable_targets: 422,
  no_route: 422
};

const messageByCode: Record<ExplorationErrorCode, string> = {
  planning_unavailable: "Route planning is temporarily unavailable. Try again later.",
  exploration_expired: "This exploration has expired. Generate routes again.",
  proposal_expired: "This route has expired. Generate routes again.",
  no_targets: "No exploration targets found in this area. Move the map and try again.",
  no_reachable_targets: "No places can be reached from this start. Try another start or destination.",
  no_route: "No route was found. Try another start or destination."
};

/** User-safe exploration failure with a stable code and HTTP status. */
export class ExplorationError extends Error {
  readonly status: number;

  constructor(readonly code: ExplorationErrorCode) {
    super(messageByCode[code]);
    this.status = statusByCode[code];
  }
}

/** Proposal as returned to clients; internal scoring details stay on the server. */
export type PublicRouteProposal = Omit<RouteProposal, "score">;

const toPublic = ({ score: _score, ...proposal }: RouteProposal): PublicRouteProposal => proposal;

/** Reported when the frozen area cannot supply a route near the requested length. */
export interface InsufficientAreaWarning {
  code: "insufficient_area";
  requestedType: "distance" | "duration";
  /** Meters or seconds, per `requestedType`. */
  requested: number;
  /** Longest route found, in the same unit as `requested`. */
  longest: number;
  message: string;
}

export type ExplorationWarning = InsufficientAreaWarning;

const insufficientAreaWarning = (input: RoutePlanningInput, proposals: RouteProposal[]): InsufficientAreaWarning => {
  const requested = constraintRequested(input.constraint);
  const longest = Math.round(Math.max(...proposals.map((proposal) => constraintActual(input.constraint, proposal))));
  const format = (value: number) => input.constraint.type === "distance"
    ? `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)} km`
    : `${Math.floor(value / 3600)}:${String(Math.round((value % 3600) / 60)).padStart(2, "0")} h`;
  return {
    code: "insufficient_area",
    requestedType: input.constraint.type,
    requested,
    longest,
    message: `This area can't support a ${format(requested)} route. The longest route found is ${format(longest)}. Try a longer start-to-destination, another area or a shorter ${input.constraint.type === "distance" ? "distance" : "time"}.`
  };
};

export interface GeneratedExploration {
  explorationId: string;
  proposals: PublicRouteProposal[];
  /** Eligible destinations (collectibles) and the area's plannable Flowlines: rendered for the selected route and while adding destinations. */
  catalog: { collectibles: WorldCollectible[]; flowlines: WorldFartlek[] };
  /** Small set of nearby optional cycling enhancements, separate from the baseline route. */
  flowlineEnhancements: { flowline: WorldFartlek; rationale: string }[];
  /** Unvisited curated POIs close to the baseline route, closest first; the player may add them as stops. */
  nearbyCollectibles: NearbyCollectible[];
  truncated: boolean;
  warnings: ExplorationWarning[];
}

export interface PlannedExploration {
  explorationId: string;
  proposal: PublicRouteProposal;
  catalog: { collectibles: WorldCollectible[]; flowlines: WorldFartlek[] };
  nearbyCollectibles: NearbyCollectible[];
  truncated: boolean;
}

/** The frozen area's collectibles (destinations must lie inside it) and its plannable Flowlines. */
const areaWorld = (
  viewport: { collectibles: WorldCollectible[]; flowlines: WorldFartlek[]; truncated: boolean },
  inArea: (point: { latitude: number; longitude: number }) => boolean
) => ({ collectibles: viewport.collectibles.filter(inArea), flowlines: viewport.flowlines, truncated: viewport.truncated });

const planningFailure = (error: unknown): unknown => error instanceof PlanningError
  ? new ExplorationError(error.code === "routing_unavailable" ? "planning_unavailable" : error.code)
  : error;

const ENHANCEMENT_MAX_DISTANCE_M = 2_500;
const ENHANCEMENT_SAMPLES = 400;
const NEARBY_COLLECTIBLE_MAX_DISTANCE_M = 1_500;
const NEARBY_COLLECTIBLE_LIMIT = 5;

type LonLat = readonly [number, number] | number[];
type NearbyCollectible = { collectible: WorldCollectible; distanceM: number };

/** Up to 5 unvisited POIs close to a route, nearest first, other than the excluded ones. */
const nearbyCollectibles = (collectibles: WorldCollectible[], geometry: LonLat[], excludedIds: Iterable<string | undefined>): NearbyCollectible[] => {
  const excluded = new Set(excludedIds);
  const routePoints = sampledPoints(geometry, ENHANCEMENT_SAMPLES);
  return collectibles
    .filter((collectible) => !collectible.found && !excluded.has(collectible.id))
    .map((collectible) => ({
      collectible,
      distanceM: Math.round(minimumDistanceM(routePoints, [{ lat: collectible.latitude, lon: collectible.longitude }], NEARBY_COLLECTIBLE_MAX_DISTANCE_M))
    }))
    .filter(({ distanceM }) => distanceM <= NEARBY_COLLECTIBLE_MAX_DISTANCE_M)
    .sort((a, b) => a.distanceM - b.distanceM || a.collectible.id.localeCompare(b.collectible.id))
    .slice(0, NEARBY_COLLECTIBLE_LIMIT);
};

/** At most `limit` evenly spaced points of a line (plus its last point), as lat/lon. */
const sampledPoints = (coordinates: LonLat[], limit: number): { lat: number; lon: number }[] => {
  const step = Math.max(1, Math.ceil(coordinates.length / limit));
  const sampled = coordinates.filter((_, index) => index % step === 0 || index === coordinates.length - 1);
  return sampled.map(([lon, lat]) => ({ lat: lat!, lon: lon! }));
};

/**
 * Closest distance between two sampled lines' points. Loops instead of spreading into
 * `Math.min`, which overflows the call stack for long routes and Flowlines. Lines whose bounding box is
 * farther than `maxM` from every route point are skipped cheaply.
 */
const minimumDistanceM = (route: { lat: number; lon: number }[], line: { lat: number; lon: number }[], maxM: number): number => {
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const { lat, lon } of line) {
    south = Math.min(south, lat); north = Math.max(north, lat);
    west = Math.min(west, lon); east = Math.max(east, lon);
  }
  const padLat = maxM / 111_000;
  const nearBox = route.some(({ lat, lon }) => {
    const padLon = padLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
    return lat >= south - padLat && lat <= north + padLat && lon >= west - padLon && lon <= east + padLon;
  });
  if (!nearBox) return Infinity;
  let closest = Infinity;
  for (const vertex of line) {
    for (const point of route) {
      const distance = distanceBetween(point, vertex);
      if (distance < closest) closest = distance;
    }
  }
  return closest;
};

/** Shares identical routing requests (and their failures) within one generation. */
const sharedRoutes = (routing: RouteProvider): RouteProvider => {
  const results = new Map<string, Promise<RoutingResult>>();
  return {
    route: (request, options) => {
      const key = JSON.stringify(request);
      let result = results.get(key);
      if (!result) {
        result = routing.route(request, options);
        results.set(key, result);
      }
      return result;
    }
  };
};

/**
 * Route-first "Explore this Area": the player describes the ride, the planner chooses target
 * combinations and returns a few route proposals, the player may customize one route's targets,
 * and only a saved route is persisted (as an active Exploration). Planning never changes gameplay state.
 */
export class ExplorationService {
  constructor(private readonly dependencies: ExplorationDependencies) {}

  private requireRouting(): RouteProvider {
    if (!this.dependencies.routing) throw new ExplorationError("planning_unavailable");
    return this.dependencies.routing;
  }

  private store(
    explorationId: string,
    planned: PlannedProposal,
    available: Map<string, QuestRouteTarget>,
    input: RoutePlanningInput,
    flowlines: { id: string; name: string }[] = []
  ) {
    return {
      sport: input.sport,
      ...(flowlines.length > 0 ? { flowlines } : {}),
      explorationId,
      proposal: planned.proposal,
      stops: planned.stops,
      targets: routeTargetIds(planned.proposal).map((id) => available.get(id)!).filter(Boolean),
      plannerVersion: PLANNER_VERSION
    };
  }

  /**
   * Freezes the area, resolves its eligible targets and generates ONE route. The response keeps a
   * one-entry `proposals` list.
   */
  async generate(playerId: string, body: unknown, requestId: string = randomUUID()): Promise<GeneratedExploration> {
    // Skeleton variants often repeat a route; each distinct request goes to the router once.
    const routing = sharedRoutes(this.requireRouting());
    const { area, aim, input, destinationId, destinationFlowlineId } = parseGenerateRequest(body);
    if (input.routeType === "point_to_point" && !insideBounds([input.end.lon, input.end.lat], area.bounds, 0)) {
      throw new UserInputError("The destination must be inside the explored area.");
    }
    const inArea = ({ latitude, longitude }: { latitude: number; longitude: number }) => insideBounds([longitude, latitude], area.bounds, 0);
    let loadedArea: Awaited<ReturnType<ExplorationDependencies["loadArea"]>> | undefined;
    const loadArea = async () => loadedArea ??= await this.dependencies.loadArea(playerId, area.bounds);
    const collectibleArea = this.dependencies.loadCollectibles
      ? await this.dependencies.loadCollectibles(playerId, area.bounds)
      : await loadArea();
    const initialFlowlines = destinationFlowlineId
      ? this.dependencies.loadFlowlines
        ? await this.dependencies.loadFlowlines(playerId, area.bounds)
        : (await loadArea()).flowlines
      : [];
    const world = areaWorld({
      collectibles: collectibleArea.collectibles,
      flowlines: initialFlowlines,
      truncated: collectibleArea.truncated
    }, inArea);
    const requiredFlowline = destinationFlowlineId
      ? buildFlowlineGeometries(world.flowlines).find((flowline) => flowline.id === destinationFlowlineId)
      : undefined;
    if (destinationFlowlineId && !requiredFlowline) {
      throw new UserInputError("The Flowline must be inside the explored area.");
    }
    const resolve = () => {
      const built = buildExplorationTargets(world.collectibles);
      const geometries = buildFlowlineGeometries(world.flowlines);
      const flowlineGeometries = [
        ...(requiredFlowline ? [requiredFlowline] : []),
        ...geometries.filter((flowline) => flowline.id !== requiredFlowline?.id)
      ].slice(0, MAX_AVAILABLE_TARGETS);
      return { ...built, flowlineGeometries };
    };
    const resolved = resolve();
    // Collectibles are optional extras; a route without them saves without objectives.
    const destination = destinationId ? resolved.targets.find((target) => target.id === destinationId) : undefined;
    if (destinationId && !destination) throw new UserInputError("The destination must be inside the explored area.");
    if (destination) assertNearTargets(input, [destination]);
    const sessionData = (current: typeof resolved) => {
      const ids = new Set(current.targets.map((target) => target.id));
      const flowlineIds = new Set(current.flowlineGeometries.map((flowline) => flowline.id));
      return {
        availableTargets: current.targets,
        collectibles: world.collectibles.filter((collectible) => ids.has(collectible.id)),
        flowlines: world.flowlines.filter((flowline) => flowlineIds.has(flowline.id)),
        flowlineGeometries: current.flowlineGeometries,
        truncated: current.truncated || world.truncated
      };
    };
    const destinationPoint = destination?.coordinate ?? aim ?? (input.routeType === "point_to_point" ? input.end : undefined);
    const session = this.dependencies.sessions.create({
      playerId, area, input, ...(destinationPoint ? { destination: destinationPoint } : {}),
      ...(destination ? { destinationId: destination.id } : {}),
      flowlineEnhancementIds: [], ...sessionData(resolved)
    });

    const plan = async (current: typeof resolved): Promise<{ planned?: Array<PlannedProposal & { input: typeof input }>; failure?: unknown }> => {
      try {
        const dependencies = { routing, ...(this.dependencies.log ? { log: this.dependencies.log } : {}) };
        const required = destination
          ? (() => {
            const objectives = explorationObjectives([destination]);
            return { target: withObjectiveIds([destination], objectives)[0], objectives };
          })()
          : undefined;
        const generated = await generateRoute(
          {
            requestId, playerId, scopeId: session.id, targets: destination ? [destination] : [],
            flowlines: requiredFlowline ? current.flowlineGeometries : [], input, bounds: area.bounds,
            ...(aim ? { aim } : {}),
            ...(required ? { required } : {}),
            ...(requiredFlowline ? { requiredFlowline } : {})
          },
          dependencies
        );
        return { planned: [{ ...generated, input }] };
      } catch (failure) {
        return { failure };
      }
    };
    const { planned, failure } = await plan(resolved);
    if (!planned) throw planningFailure(failure);
    // A newer exploration started while routing; this one's proposals are already stale.
    if (!this.dependencies.sessions.get(playerId, session.id)) throw new ExplorationError("exploration_expired");
    const available = new Map(session.availableTargets.map((target) => [target.id, target]));
    const warnings: ExplorationWarning[] = planned.every((entry) => entry.proposal.constraintFit === "short")
      ? [insufficientAreaWarning(input, planned.map((entry) => entry.proposal))]
      : [];
    const route = planned[0].proposal;
    const candidateFlowlines = destinationFlowlineId
      ? initialFlowlines
      : input.sport === "cycling"
        ? this.dependencies.loadFlowlines
          ? await this.dependencies.loadFlowlines(playerId, area.bounds)
          : (await loadArea()).flowlines
        : [];
    if (!this.dependencies.sessions.get(playerId, session.id)) throw new ExplorationError("exploration_expired");
    session.flowlines = candidateFlowlines;
    session.flowlineGeometries = buildFlowlineGeometries(candidateFlowlines);
    // The route already rides these Flowlines, so they are part of it rather than optional.
    for (const entry of planned) {
      entry.proposal.traversedFlowlines = traversedFlowlines({ geometry: entry.proposal.geometry }, [
        ...session.flowlineGeometries,
        ...(requiredFlowline && !session.flowlineGeometries.some((flowline) => flowline.id === requiredFlowline.id) ? [requiredFlowline] : [])
      ]);
    }
    const ridden = new Set(route.traversedFlowlines.map((flowline) => flowline.id));
    const routePoints = sampledPoints(route.geometry.coordinates, ENHANCEMENT_SAMPLES);
    const candidates = input.sport === "cycling" && !requiredFlowline
      ? session.flowlines.filter((flowline) => !flowline.completed && flowline.status === "published"
        && !ridden.has(flowline.id) && flowline.geometry.coordinates.length >= 2).map((flowline) => ({
          flowline,
          distanceM: minimumDistanceM(routePoints, sampledPoints(flowline.geometry.coordinates, ENHANCEMENT_SAMPLES), ENHANCEMENT_MAX_DISTANCE_M)
        })).filter(({ distanceM }) => distanceM <= ENHANCEMENT_MAX_DISTANCE_M)
        .sort((a, b) => a.distanceM - b.distanceM || a.flowline.id.localeCompare(b.flowline.id))
        .slice(0, 3)
      : [];
    session.flowlineEnhancementIds = candidates.map(({ flowline }) => flowline.id);
    session.riddenFlowlineIds = [...ridden];
    const flowlineEnhancements = candidates.map(({ flowline, distanceM }) => ({
      flowline,
      rationale: distanceM <= 750
        ? flowline.character?.primary
          ? `A ${flowline.character.primary} ride close to your route.`
          : "A nearby Flowline adds a distinct stretch to your ride."
        : flowline.character?.primary
          ? `A ${flowline.character.primary} detour that stays close to your route.`
          : "A nearby detour for a more varied ride."
    }));
    const nearby = nearbyCollectibles(session.collectibles, route.geometry.coordinates,
      [session.destinationId, ...route.includedTargetIds]);
    this.dependencies.proposals.replaceForPlayer(
      playerId,
      planned.map((entry) => this.store(session.id, entry, available, entry.input,
        requiredFlowline ? [{ id: requiredFlowline.id, name: requiredFlowline.name }] : []))
    );
    return {
      explorationId: session.id,
      proposals: planned.map((entry) => toPublic(entry.proposal)),
      catalog: { collectibles: session.collectibles, flowlines: session.flowlines },
      flowlineEnhancements,
      nearbyCollectibles: nearby,
      truncated: session.truncated,
      warnings
    };
  }

  /** Routes selected optional Flowlines through the saved baseline destination, without objectives. */
  async enhance(playerId: string, explorationIdValue: unknown, body: unknown, requestId: string = randomUUID()) {
    const routing = this.requireRouting();
    const explorationId = parseExplorationId(explorationIdValue);
    const { proposalId, flowlineIds } = parseFlowlineEnhancementRequest(body);
    const session = this.dependencies.sessions.get(playerId, explorationId);
    if (!session) throw new ExplorationError("exploration_expired");
    const base = this.dependencies.proposals.get(playerId, proposalId);
    if (!base || base.explorationId !== session.id) throw new ExplorationError("proposal_expired");
    if (flowlineIds.some((id) => !(session.flowlineEnhancementIds ?? []).includes(id))) {
      throw new UserInputError("Only Flowlines offered for this route can be added.");
    }
    if (flowlineIds.length === 0) {
      return {
        proposal: toPublic(base.proposal),
        metrics: { distanceDeltaM: 0, durationDeltaS: 0 },
        flowlineIds: [],
        nearbyCollectibles: nearbyCollectibles(session.collectibles, base.proposal.geometry.coordinates,
          [session.destinationId, ...base.proposal.includedTargetIds])
      };
    }
    const byId = new Map(session.flowlineGeometries.map((flowline) => [flowline.id, flowline]));
    // Flowlines the baseline rides are part of the route, so an enhanced route keeps riding them.
    const selected = [...new Set([...(session.riddenFlowlineIds ?? []), ...flowlineIds])]
      .map((id) => byId.get(id)).filter((flowline): flowline is NonNullable<typeof flowline> => Boolean(flowline));
    const destination = session.destinationId
      ? session.availableTargets.find((target) => target.id === session.destinationId)
      : session.destination ? waypointTarget(session.destination) : undefined;
    const destinationObjectives = destination && !destination.routeOnly ? explorationObjectives([destination]) : [];
    const destinationStop = destination
      ? withObjectiveIds([destination], destinationObjectives)[0]
      : undefined;
    const stops: ManualStop[] = [
      ...(destinationStop ? [{ kind: "target" as const, target: destinationStop }] : []),
      ...selected.map((flowline) => ({ kind: "flowline" as const, flowline }))
    ];
    if (stops.length === 0) throw new UserInputError("A route enhancement needs a destination or Flowline.");
    let planned: PlannedProposal & { stopOrder: string[] };
    try {
      planned = await planManualRoute({
        requestId, playerId, scopeId: session.id, stops, keepOrder: false,
        objectives: destinationObjectives, flowlines: session.flowlineGeometries, input: session.input
      }, { routing, ...(this.dependencies.log ? { log: this.dependencies.log } : {}) });
    } catch (error) {
      throw planningFailure(error);
    }
    const available = new Map(session.availableTargets.map((target) => [target.id, target]));
    const proposal = { ...planned.proposal, basedOn: base.proposal.id };
    this.dependencies.proposals.addForPlayer(playerId, this.store(
      session.id, { proposal, stops: planned.stops }, available, session.input
    ));
    return {
      proposal: toPublic(proposal),
      metrics: {
        distanceDeltaM: proposal.distanceM - base.proposal.distanceM,
        durationDeltaS: proposal.durationS - base.proposal.durationS,
        ...(proposal.elevationGainM !== undefined && base.proposal.elevationGainM !== undefined
          ? { elevationGainDeltaM: proposal.elevationGainM - base.proposal.elevationGainM }
          : {})
      },
      flowlineIds: (proposal.flowlineIds ?? []).filter((id) => flowlineIds.includes(id)),
      nearbyCollectibles: nearbyCollectibles(session.collectibles, proposal.geometry.coordinates,
        [session.destinationId, ...proposal.includedTargetIds])
    };
  }

  /**
   * Manual planner ("Plan a route"): routes exactly the player's Flowlines, collectibles and map
   * points from the frozen area, never choosing targets itself. Staza orders the stops unless the
   * player reordered them. Every call starts a fresh exploration session.
   */
  async plan(playerId: string, body: unknown, requestId: string = randomUUID()): Promise<PlannedExploration> {
    const routing = this.requireRouting();
    const request = parsePlanRequest(body);
    const { area, input } = request;
    const inArea = ({ latitude, longitude }: { latitude: number; longitude: number }) => insideBounds([longitude, latitude], area.bounds, 0);
    if (input.routeType === "point_to_point" && !insideBounds([input.end.lon, input.end.lat], area.bounds, 0)) {
      throw new UserInputError("The destination must be inside the explored area.");
    }
    const world = areaWorld(await this.dependencies.loadArea(playerId, area.bounds), inArea);
    const { targets: available } = buildExplorationTargets(world.collectibles);
    const targetsById = new Map(available.map((target) => [target.id, target]));
    const geometries = buildFlowlineGeometries(world.flowlines);
    const geometriesById = new Map(geometries.map((flowline) => [flowline.id, flowline]));
    const chosen = request.collectibleIds.map((id) => {
      const target = targetsById.get(id);
      if (!target) throw new UserInputError("Only collectibles from the explored area can be added.");
      return target;
    });
    const objectives = explorationObjectives(chosen);
    const withObjectives = new Map(withObjectiveIds(chosen, objectives).map((target) => [target.id, target]));
    if (request.waypoints.some((point) => !insideBounds([point.lon, point.lat], area.bounds, 0))) {
      throw new UserInputError("Map points must be inside the explored area.");
    }
    const stops: ManualStop[] = request.stops.map((stop) => {
      if (stop.kind === "flowline") {
        const flowline = geometriesById.get(stop.id);
        if (!flowline) throw new UserInputError("Flowlines must be inside the explored area.");
        return { kind: "flowline", flowline };
      }
      if (stop.kind === "collectible") return { kind: "target", target: withObjectives.get(stop.id)! };
      return { kind: "target", target: waypointTarget(stop.point) };
    });
    if (startToNearestStopM(input, stops) > PLANNING_LIMITS.maxStartToTargetMeters) {
      throw new UserInputError("The start must be near the route's stops.");
    }
    let planned;
    try {
      planned = await planManualRoute({
        requestId, playerId, scopeId: requestId, stops, keepOrder: request.keepOrder, objectives,
        flowlines: geometries, input
      }, { routing, ...(this.dependencies.log ? { log: this.dependencies.log } : {}) });
    } catch (error) {
      throw planningFailure(error);
    }
    // Created only once routed, so a stop that cannot be routed keeps the player's current route usable.
    const session = this.dependencies.sessions.create({
      playerId,
      area,
      input,
      availableTargets: available,
      collectibles: world.collectibles,
      flowlines: world.flowlines,
      flowlineGeometries: geometries,
      truncated: world.truncated
    });
    const ridden = new Set(planned.proposal.flowlineIds ?? []);
    const flowlines = stops.flatMap((stop) => (stop.kind === "flowline" && ridden.has(stop.flowline.id)
      ? [{ id: stop.flowline.id, name: stop.flowline.name }]
      : []));
    const proposal = { ...planned.proposal, stopOrder: planned.stopOrder };
    this.dependencies.proposals.replaceForPlayer(playerId, [this.store(session.id, { proposal, stops: planned.stops }, targetsById, input, flowlines)]);
    return {
      explorationId: session.id,
      proposal: toPublic(proposal),
      catalog: { collectibles: world.collectibles, flowlines: world.flowlines },
      nearbyCollectibles: nearbyCollectibles(world.collectibles, proposal.geometry.coordinates,
        [...request.collectibleIds, ...proposal.includedTargetIds]),
      truncated: world.truncated
    };
  }

  /**
   * Re-plans one proposal for an edited target set by following its road and detouring only to the
   * added stops. Other proposals are not touched, and the base proposal stays savable.
   */
  async reroute(playerId: string, explorationIdValue: unknown, body: unknown, requestId: string = randomUUID()): Promise<{ proposal: PublicRouteProposal; nearbyCollectibles: NearbyCollectible[] }> {
    const routing = this.requireRouting();
    const explorationId = parseExplorationId(explorationIdValue);
    const { proposalId, targetIds, waypoints } = parseRerouteRequest(body);
    const session = this.dependencies.sessions.get(playerId, explorationId);
    if (!session) throw new ExplorationError("exploration_expired");
    const base = this.dependencies.proposals.get(playerId, proposalId);
    if (!base || base.explorationId !== session.id) throw new ExplorationError("proposal_expired");
    const available = new Map(session.availableTargets.map((target) => [target.id, target]));
    if (targetIds.some((id) => !available.has(id))) {
      throw new UserInputError("Only targets from the explored area can be added.");
    }
    if (waypoints.some((point) => !insideBounds([point.lon, point.lat], session.area.bounds, 0))) {
      throw new UserInputError("Map points must be inside the explored area.");
    }
    const chosen = targetIds.map((id) => available.get(id)!);
    const objectives = explorationObjectives(chosen);
    let planned: PlannedProposal;
    try {
      planned = await rerouteTargets({
        requestId,
        playerId,
        scopeId: session.id,
        base: base.proposal,
        targets: withObjectiveIds(chosen, objectives),
        objectives,
        flowlines: session.flowlineGeometries,
        input: session.input,
        waypoints
      }, { routing, ...(this.dependencies.log ? { log: this.dependencies.log } : {}) });
    } catch (error) {
      throw planningFailure(error);
    }
    // A customized route keeps a Flowline objective only while it still rides that Flowline.
    const ridden = new Set(planned.proposal.traversedFlowlines.map((flowline) => flowline.id));
    const keptFlowlines = (base.flowlines ?? []).filter((flowline) => ridden.has(flowline.id));
    this.dependencies.proposals.addForPlayer(playerId, this.store(session.id, planned, available, session.input, keptFlowlines));
    return {
      proposal: toPublic(planned.proposal),
      nearbyCollectibles: nearbyCollectibles(session.collectibles, planned.proposal.geometry.coordinates,
        [session.destinationId, ...targetIds, ...planned.proposal.includedTargetIds])
    };
  }

  /**
   * "Save Exploration": persists an active Exploration and its route. The client
   * sends only the proposal id; targets, geometry and objectives come from server memory, so they
   * cannot be tampered with. Saving the same proposal again returns the same Exploration.
   */
  async save(playerId: string, body: unknown): Promise<string> {
    const proposalId = parseProposalId(body);
    const stored = this.dependencies.proposals.get(playerId, proposalId);
    if (!stored) throw new ExplorationError("proposal_expired");
    const { proposal, plannerVersion, targets, sport, flowlines = [] } = stored;
    const { title, description } = describeExploration(targets, flowlines);
    return this.dependencies.explorations.createExploration(playerId, {
      proposalId: proposal.id,
      title,
      description,
      objectives: [...explorationObjectives(targets), ...flowlines.map(flowlineObjective)]
    }, {
      proposalId: proposal.id,
      profile: profileForSport(sport),
      routeType: proposal.routeType,
      start: proposal.start,
      end: proposal.end,
      distanceM: proposal.distanceM,
      durationS: proposal.durationS,
      ...(proposal.elevationGainM !== undefined ? { elevationGainM: proposal.elevationGainM } : {}),
      ...(proposal.elevationLossM !== undefined ? { elevationLossM: proposal.elevationLossM } : {}),
      geometry: proposal.geometry,
      includedTargetIds: proposal.includedTargetIds,
      plannerVersion
    });
  }
}
