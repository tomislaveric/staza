import { UserInputError } from "../errors.js";
import { PLANNING_LIMITS } from "../routePlanning/policy.js";
import { isRecord, isUuid, parseLatLon, parseProposalId, parseRoutePlanningInput } from "../routePlanning/request.js";
import type { RoutePlanningInput } from "../routePlanning/types.js";
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
}

/** `{ area, start, end?, routeType, constraint }`: the ride only — never targets. */
export const parseGenerateRequest = (body: unknown): GenerateRequest => {
  if (!isRecord(body)) throw new UserInputError("An exploration request is required.");
  return { area: parseArea(body.area), input: parseRoutePlanningInput(body) };
};

export const parseExplorationId = (value: unknown): string => {
  if (!isUuid(value)) throw new UserInputError("A valid exploration is required.");
  return value;
};

export interface RerouteRequest {
  proposalId: string;
  targetIds: string[];
}

/** `{ proposalId, targetIds }`: the exact edited target set of one proposal. */
export const parseRerouteRequest = (body: unknown): RerouteRequest => {
  const proposalId = parseProposalId(body);
  const ids = isRecord(body) ? body.targetIds : undefined;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new UserInputError("Route targets must be a list of target ids.");
  }
  const targetIds = [...new Set(ids as string[])];
  if (targetIds.length === 0) throw new UserInputError("A route needs at least one target.");
  if (targetIds.length > PLANNING_LIMITS.maxRouteTargets) {
    throw new UserInputError(`A route can include at most ${PLANNING_LIMITS.maxRouteTargets} targets.`);
  }
  return { proposalId, targetIds };
};
