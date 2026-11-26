import { UserInputError } from "../errors.js";
import { distanceBetween } from "../routePlanning/geo.js";
import { generationLengthMeters } from "../routePlanning/generationPolicy.js";
import { AIM_RADIUS_M } from "../routePlanning/routeGenerator.js";
import { PLANNING_LIMITS } from "../routePlanning/policy.js";
import { isRecord, isUuid, parseLatLon, parseProposalId, parseRoutePlanningInput } from "../routePlanning/request.js";
import type { LatLon, RoutePlanningInput } from "../routePlanning/types.js";
import { parseBoundsParameter, type GeoBounds } from "../worldQuery.js";
import type { ExplorationAreaContext } from "./types.js";

/** Frozen areas larger than this (in degrees per side) are rejected; zoom in to explore. */
export const MAX_AREA_SPAN_DEGREES = 2;

export const parseArea = (value: unknown): ExplorationAreaContext => {
  if (!isRecord(value)) throw new UserInputError("An exploration area is required.");
  const bounds = parseBoundsParameter(value.bbox);
  if (!bounds) throw new UserInputError("An exploration area is required.");
  if (bounds.maxLatitude - bounds.minLatitude > MAX_AREA_SPAN_DEGREES
    || bounds.maxLongitude - bounds.minLongitude > MAX_AREA_SPAN_DEGREES
    || bounds.minLongitude > bounds.maxLongitude) {
    throw new UserInputError("This area is too large to explore. Zoom in and try again.");
  }
  const center = parseLatLon(value.center, "Area center");
  const { zoom } = value;
  if (typeof zoom !== "number" || !Number.isFinite(zoom) || zoom < 0 || zoom > 24) {
    throw new UserInputError("Area zoom must be a number between 0 and 24.");
  }
  return { bounds, center, zoom };
};

/** A target closer to the start than this is a loop around here, not a ride there. */
export const NEAR_TARGET_M = 2_000;
/** Half-size of the area a loop around a near target is planned in. */
const NEAR_LOOP_RADIUS_M = 3_000;
/** Farthest aimed target: the corridor there and back stays a reasonable area to load. */
export const MAX_TARGET_DISTANCE_M = 80_000;
/** Corridor margin around start and target, as a share of their distance (side points ride at 0.3). */
const CORRIDOR_MARGIN = 0.45;
/** The way there and back rides beside the direct line: this much longer per direction. */
const TARGET_WAY_FACTOR = 1.17;

const squareAround = (center: LatLon, radiusM: number): GeoBounds => {
  const dLat = radiusM / 111_320;
  const dLon = dLat / (Math.cos((center.lat * Math.PI) / 180) || 1);
  return { minLatitude: center.lat - dLat, maxLatitude: center.lat + dLat, minLongitude: center.lon - dLon, maxLongitude: center.lon + dLon };
};

/**
 * Where an aimed route is planned: around a near target, or the corridor between start and a far
 * target (with room for the way there and back on different sides and the circle around the target).
 */
export const targetArea = (start: LatLon, target: LatLon): ExplorationAreaContext => {
  const distanceM = distanceBetween(start, target);
  if (distanceM < NEAR_TARGET_M) return { bounds: squareAround(target, NEAR_LOOP_RADIUS_M), center: target, zoom: 13 };
  const margin = Math.max(AIM_RADIUS_M, distanceM * CORRIDOR_MARGIN);
  const [a, b] = [squareAround(start, margin), squareAround(target, margin)];
  return {
    bounds: {
      minLatitude: Math.min(a.minLatitude, b.minLatitude),
      maxLatitude: Math.max(a.maxLatitude, b.maxLatitude),
      minLongitude: Math.min(a.minLongitude, b.minLongitude),
      maxLongitude: Math.max(a.maxLongitude, b.maxLongitude)
    },
    center: target,
    zoom: 12
  };
};

/**
 * Ride length towards a far target: the way there (and back on another side for round trips)
 * plus a share of a small loop's length as room for Flowlines and collectibles.
 */
export const targetLengthMeters = (start: LatLon, target: LatLon, routeType: RoutePlanningInput["routeType"]): number => {
  const room = generationLengthMeters(areaConstraint({ bounds: squareAround(target, AIM_RADIUS_M), center: target, zoom: 14 }).value);
  const way = distanceBetween(start, target) * TARGET_WAY_FACTOR * (routeType === "round_trip" ? 2 : 1);
  return Math.round(Math.min(PLANNING_LIMITS.maxDistanceMeters, Math.max(PLANNING_LIMITS.minDistanceMeters, way + room)));
};

export interface GenerateRequest {
  area: ExplorationAreaContext;
  /** A far aimed target the route must reach; `area` is then the corridor to it. */
  aim?: LatLon;
  input: RoutePlanningInput;
  /** A collectible every route must visit ("Route to"). */
  destinationId?: string;
  /** A plannable Flowline of the area every route must ride ("Plan route via this Flowline"). */
  destinationFlowlineId?: string;
}

/** Round-trip length that lets the planner span the frozen area: about twice its diagonal. */
export const areaConstraint = ({ bounds }: ExplorationAreaContext): { type: "distance"; value: number } => {
  const diagonalM = distanceBetween(
    { lat: bounds.minLatitude, lon: bounds.minLongitude },
    { lat: bounds.maxLatitude, lon: bounds.maxLongitude }
  );
  const value = Math.round(Math.min(PLANNING_LIMITS.maxDistanceMeters, Math.max(PLANNING_LIMITS.minDistanceMeters, diagonalM * 2)));
  return { type: "distance", value };
};

/**
 * `{ target | area, start, sport?, routeType?, end? }`: the ride only — never targets. With an
 * aimed `target` the route rides there (an A→B route ends there) and the length follows from the
 * way there; otherwise the area's size defines the ride. Older clients' `intent`/`intents` are
 * ignored: generation always plans one route.
 */
export const parseGenerateRequest = (body: unknown): GenerateRequest => {
  if (!isRecord(body)) throw new UserInputError("An exploration request is required.");
  const target = body.target === undefined ? undefined : parseLatLon(body.target, "Target");
  const start = target ? parseLatLon(body.start, "Start") : undefined;
  if (target && start && distanceBetween(start, target) > MAX_TARGET_DISTANCE_M) {
    throw new UserInputError("The target is too far from the start.");
  }
  const area = target && start ? targetArea(start, target) : parseArea(body.area);
  const aim = target && start ? target : undefined;
  const { destinationId, destinationFlowlineId } = body;
  if (destinationId !== undefined && (typeof destinationId !== "string" || destinationId.trim() === "")) {
    throw new UserInputError("The destination must be a collectible id.");
  }
  if (destinationFlowlineId !== undefined && (typeof destinationFlowlineId !== "string" || destinationFlowlineId.trim() === "")) {
    throw new UserInputError("The Flowline must be a Flowline id.");
  }
  if (destinationId && destinationFlowlineId) {
    throw new UserInputError("Choose either a destination or a Flowline, not both.");
  }
  // An A→B route ends at its target.
  const ride = { routeType: "round_trip", ...body, ...(target && body.routeType === "point_to_point" ? { end: target } : {}) };
  const value = aim && start
    ? targetLengthMeters(start, aim, ride.routeType === "point_to_point" ? "point_to_point" : "round_trip")
    : generationLengthMeters(areaConstraint(area).value);
  const constraint = { type: "distance", value };
  const input = parseRoutePlanningInput(target ? { ...ride, constraint } : { constraint, ...ride });
  return {
    area,
    ...(aim ? { aim } : {}),
    input,
    ...(destinationId ? { destinationId } : {}),
    ...(destinationFlowlineId ? { destinationFlowlineId } : {})
  };
};

export interface FlowlineEnhancementRequest {
  proposalId: string;
  flowlineIds: string[];
}

/** `{ proposalId, flowlineIds }`: the selected optional Flowline set, including an empty reset. */
export const parseFlowlineEnhancementRequest = (body: unknown): FlowlineEnhancementRequest => {
  if (!isRecord(body)) throw new UserInputError("A route enhancement request is required.");
  const proposalId = parseProposalId(body);
  if (!Array.isArray(body.flowlineIds) || body.flowlineIds.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new UserInputError("Flowline enhancements must be a list of ids.");
  }
  const flowlineIds = [...new Set(body.flowlineIds as string[])];
  if (flowlineIds.length > 3) throw new UserInputError("Choose up to three Flowline enhancements.");
  return { proposalId, flowlineIds };
};

export const parseExplorationId = (value: unknown): string => {
  if (!isUuid(value)) throw new UserInputError("A valid exploration is required.");
  return value;
};

export interface RerouteRequest {
  proposalId: string;
  targetIds: string[];
  /** Route-only map points; they shape the route and never count as targets. */
  waypoints: LatLon[];
}

const TOO_MANY_STOPS = "This route has too many stops.";

/** `{ proposalId, targetIds }`: the exact edited target set of one proposal. */
export const parseRerouteRequest = (body: unknown): RerouteRequest => {
  const proposalId = parseProposalId(body);
  const ids = isRecord(body) ? body.targetIds : undefined;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new UserInputError("Route targets must be a list of target ids.");
  }
  const targetIds = [...new Set(ids as string[])];
  const rawWaypoints = isRecord(body) ? body.waypoints : undefined;
  if (rawWaypoints !== undefined && !Array.isArray(rawWaypoints)) throw new UserInputError("Route waypoints must be a list of coordinates.");
  const waypoints = new Map<string, LatLon>();
  for (const value of rawWaypoints ?? []) {
    const point = parseLatLon(value, "Waypoint");
    waypoints.set(`${point.lat.toFixed(6)},${point.lon.toFixed(6)}`, point);
  }
  if (targetIds.length + waypoints.size > PLANNING_LIMITS.maxRequestStops) throw new UserInputError(TOO_MANY_STOPS);
  if (targetIds.length === 0 && waypoints.size === 0) throw new UserInputError("A route needs at least one destination or map point.");
  return { proposalId, targetIds, waypoints: [...waypoints.values()] };
};

export type PlanStopRequest =
  | { kind: "flowline"; id: string }
  | { kind: "collectible"; id: string }
  | { kind: "waypoint"; point: LatLon };

export interface PlanRequest {
  area: ExplorationAreaContext;
  input: RoutePlanningInput;
  stops: PlanStopRequest[];
  collectibleIds: string[];
  waypoints: LatLon[];
  /** The player reordered the stops; otherwise Staza orders them. */
  keepOrder: boolean;
}

/**
 * `{ area, start, end?, routeType?, sport?, keepOrder?, stops: [{ kind, id | lat/lon }] }`: the
 * manual planner's exact stops. The ride length follows from the stops, so the area defines the
 * nominal constraint only.
 */
export const parsePlanRequest = (body: unknown): PlanRequest => {
  if (!isRecord(body)) throw new UserInputError("A route plan request is required.");
  const area = parseArea(body.area);
  if (!Array.isArray(body.stops) || body.stops.length === 0) throw new UserInputError("A route needs at least one stop.");
  const stops: PlanStopRequest[] = [];
  const seen = new Set<string>();
  for (const value of body.stops) {
    if (!isRecord(value)) throw new UserInputError("Route stops must be Flowlines, collectibles or map points.");
    let stop: PlanStopRequest;
    if (value.kind === "flowline" || value.kind === "collectible") {
      if (typeof value.id !== "string" || value.id.trim() === "") throw new UserInputError("Route stops need an id.");
      stop = { kind: value.kind, id: value.id };
    } else if (value.kind === "waypoint") {
      stop = { kind: "waypoint", point: parseLatLon(value, "Waypoint") };
    } else {
      throw new UserInputError("Route stops must be Flowlines, collectibles or map points.");
    }
    const key = stop.kind === "waypoint" ? `waypoint:${stop.point.lat.toFixed(6)},${stop.point.lon.toFixed(6)}` : `${stop.kind}:${stop.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stops.push(stop);
  }
  const collectibleIds = stops.flatMap((stop) => (stop.kind === "collectible" ? [stop.id] : []));
  const waypoints = stops.flatMap((stop) => (stop.kind === "waypoint" ? [stop.point] : []));
  if (stops.length > PLANNING_LIMITS.maxRequestStops) throw new UserInputError(TOO_MANY_STOPS);
  return {
    area,
    input: parseRoutePlanningInput({ routeType: "round_trip", ...body, constraint: areaConstraint(area) }),
    stops,
    collectibleIds,
    waypoints,
    keepOrder: body.keepOrder === true
  };
};
