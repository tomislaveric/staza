import { UserInputError } from "../errors.js";
import { distanceBetween } from "../routePlanning/geo.js";
import { PLANNING_LIMITS } from "../routePlanning/policy.js";
import { isRecord, isUuid, parseLatLon, parseProposalId, parseRoutePlanningInput } from "../routePlanning/request.js";
import type { LatLon, RoutePlanningInput } from "../routePlanning/types.js";
import { parseBoundsParameter } from "../worldQuery.js";
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

export interface GenerateRequest {
  area: ExplorationAreaContext;
  input: RoutePlanningInput;
  /** A collectible every route must visit ("Route to"). */
  destinationId?: string;
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
 * `{ area, start, sport?, routeType?, constraint? }`: the ride only — never targets. The area's
 * size defines the ride, so route type defaults to a round trip and the length is derived from it.
 */
export const parseGenerateRequest = (body: unknown): GenerateRequest => {
  if (!isRecord(body)) throw new UserInputError("An exploration request is required.");
  const area = parseArea(body.area);
  const { destinationId } = body;
  if (destinationId !== undefined && (typeof destinationId !== "string" || destinationId.trim() === "")) {
    throw new UserInputError("The destination must be a collectible id.");
  }
  return {
    area,
    input: parseRoutePlanningInput({ routeType: "round_trip", constraint: areaConstraint(area), ...body }),
    ...(destinationId ? { destinationId } : {})
  };
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

/** `{ proposalId, targetIds }`: the exact edited target set of one proposal. */
export const parseRerouteRequest = (body: unknown): RerouteRequest => {
  const proposalId = parseProposalId(body);
  const ids = isRecord(body) ? body.targetIds : undefined;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new UserInputError("Route targets must be a list of target ids.");
  }
  const targetIds = [...new Set(ids as string[])];
  if (targetIds.length > PLANNING_LIMITS.maxRouteTargets) {
    throw new UserInputError(`A route can include at most ${PLANNING_LIMITS.maxRouteTargets} targets.`);
  }
  const rawWaypoints = isRecord(body) ? body.waypoints : undefined;
  if (rawWaypoints !== undefined && !Array.isArray(rawWaypoints)) throw new UserInputError("Route waypoints must be a list of coordinates.");
  const waypoints = new Map<string, LatLon>();
  for (const value of rawWaypoints ?? []) {
    const point = parseLatLon(value, "Waypoint");
    waypoints.set(`${point.lat.toFixed(6)},${point.lon.toFixed(6)}`, point);
  }
  if (waypoints.size > PLANNING_LIMITS.maxRouteWaypoints) {
    throw new UserInputError(`A route can include at most ${PLANNING_LIMITS.maxRouteWaypoints} map points.`);
  }
  if (targetIds.length === 0 && waypoints.size === 0) throw new UserInputError("A route needs at least one destination or map point.");
  return { proposalId, targetIds, waypoints: [...waypoints.values()] };
};
