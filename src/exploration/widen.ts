import { budgetMeters } from "../routePlanning/candidates.js";
import { DEFAULT_PLANNER_POLICY, type PlannerPolicy } from "../routePlanning/policy.js";
import { policyForSport } from "../routePlanning/sport.js";
import type { RoutePlanningInput } from "../routePlanning/types.js";
import type { GeoBounds } from "../worldQuery.js";
import { MAX_AREA_SPAN_DEGREES } from "./request.js";

const METERS_PER_DEGREE = 111_195;

/**
 * Bounds to search for targets when the frozen viewport cannot supply the requested ride: every
 * target a route of that length could still reach from the start (and destination), capped at the
 * largest area an exploration may span.
 */
export const wideningBounds = (input: RoutePlanningInput, basePolicy: PlannerPolicy = DEFAULT_PLANNER_POLICY): GeoBounds => {
  const policy = policyForSport(basePolicy, input.sport);
  const reachM = budgetMeters(input.constraint, policy) / (input.routeType === "round_trip" ? 2 : 1) / policy.roadFactor;
  const points = input.routeType === "round_trip" ? [input.start] : [input.start, input.end];
  const latitude = points.map((point) => point.lat);
  const longitude = points.map((point) => point.lon);
  const midLat = (Math.min(...latitude) + Math.max(...latitude)) / 2;
  const midLon = (Math.min(...longitude) + Math.max(...longitude)) / 2;
  const latReach = reachM / METERS_PER_DEGREE;
  const lonReach = latReach / Math.max(0.05, Math.cos((midLat * Math.PI) / 180));
  const clampHalf = (value: number) => Math.min(value, MAX_AREA_SPAN_DEGREES / 2);
  const halfLat = clampHalf((Math.max(...latitude) - Math.min(...latitude)) / 2 + latReach);
  const halfLon = clampHalf((Math.max(...longitude) - Math.min(...longitude)) / 2 + lonReach);
  return {
    minLatitude: Math.max(-90, midLat - halfLat),
    maxLatitude: Math.min(90, midLat + halfLat),
    minLongitude: Math.max(-180, midLon - halfLon),
    maxLongitude: Math.min(180, midLon + halfLon)
  };
};
