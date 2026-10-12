import type { CandidateStop, LatLon, RoutingPlan, RoutingWaypoint } from "./types.js";

export const stopPosition = (stop: CandidateStop): LatLon => stop.target.coordinate;

const roundCoordinate = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * Translates an ordered candidate into a neutral routing request: every destination becomes a
 * `via` stop. The returned map correlates routing location indexes (0 = start) with Staza target
 * ids so snapping failures can be attributed.
 */
export const buildRoutingPlan = (start: LatLon, end: LatLon, stops: CandidateStop[]): RoutingPlan => {
  const waypoints: RoutingWaypoint[] = [];
  const waypointTargetIds = new Map<number, string>();
  for (const stop of stops) {
    const point = stopPosition(stop);
    waypoints.push({ type: "via", lat: roundCoordinate(point.lat), lon: roundCoordinate(point.lon) });
    waypointTargetIds.set(waypoints.length, stop.target.id);
  }
  return {
    request: {
      profile: "bicycle",
      start: { lat: roundCoordinate(start.lat), lon: roundCoordinate(start.lon) },
      end: { lat: roundCoordinate(end.lat), lon: roundCoordinate(end.lon) },
      waypoints
    },
    waypointTargetIds
  };
};
