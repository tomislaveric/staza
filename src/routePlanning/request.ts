import { UserInputError } from "../errors.js";
import { distanceBetween } from "./geo.js";
import { PLANNING_LIMITS } from "./policy.js";
import type { LatLon, QuestRouteTarget, RideConstraint, RoutePlanningInput } from "./types.js";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseLatLon = (value: unknown, label: string): LatLon => {
  if (!isRecord(value)) throw new UserInputError(`${label} is required.`);
  const { lat, lon } = value;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)
    || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new UserInputError(`${label} must be a valid coordinate.`);
  }
  return { lat, lon };
};

const parseConstraint = (value: unknown): RideConstraint => {
  if (!isRecord(value) || typeof value.value !== "number" || !Number.isFinite(value.value)) {
    throw new UserInputError("A ride distance or duration is required.");
  }
  if (value.type === "distance") {
    if (value.value < PLANNING_LIMITS.minDistanceMeters || value.value > PLANNING_LIMITS.maxDistanceMeters) {
      throw new UserInputError(`Ride distance must be between ${PLANNING_LIMITS.minDistanceMeters / 1000} and ${PLANNING_LIMITS.maxDistanceMeters / 1000} km.`);
    }
    return { type: "distance", meters: Math.round(value.value) };
  }
  if (value.type === "duration") {
    if (value.value < PLANNING_LIMITS.minDurationSeconds || value.value > PLANNING_LIMITS.maxDurationSeconds) {
      throw new UserInputError("Ride duration must be between 10 minutes and 12 hours.");
    }
    return { type: "duration", seconds: Math.round(value.value) };
  }
  throw new UserInputError("Ride constraint type must be distance or duration.");
};

/** Validates route type, start, destination and ride constraint. Distances are meters, durations seconds. */
export const parseRoutePlanningInput = (body: Record<string, unknown>): RoutePlanningInput => {
  const { routeType } = body;
  if (routeType !== "round_trip" && routeType !== "point_to_point") {
    throw new UserInputError("Route type must be round_trip or point_to_point.");
  }
  const start = parseLatLon(body.start, "Start");
  const end = routeType === "round_trip" ? start : parseLatLon(body.end, "Destination");
  if (routeType === "point_to_point" && distanceBetween(start, end) < 200) {
    throw new UserInputError("Destination must differ from the start. Choose a round trip to return to the start.");
  }
  return { start, end, routeType, constraint: parseConstraint(body.constraint) };
};

/** Prevents planning arbitrary far-away routes: start and end must be near the exploration's targets. */
export const assertNearTargets = (input: RoutePlanningInput, targets: QuestRouteTarget[]): void => {
  const anchors = targets.flatMap((target) => target.kind === "point"
    ? [target.coordinate]
    : [target.coordinates[0], target.coordinates[target.coordinates.length - 1]].map(([lon, lat]) => ({ lat, lon })));
  const near = (point: LatLon) => anchors.some((anchor) => distanceBetween(point, anchor) <= PLANNING_LIMITS.maxStartToTargetMeters);
  if (!near(input.start) || !near(input.end)) {
    throw new UserInputError("Start and destination must be near this exploration's targets.");
  }
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

export const parseProposalId = (body: unknown): string => {
  const proposalId = isRecord(body) ? body.proposalId : undefined;
  if (!isUuid(proposalId)) throw new UserInputError("A valid route proposal is required.");
  return proposalId;
};
