import { FLOWLINE_SHAPING } from "./policy.js";
import { lineLengthMeters, pointAlong, toLatLon, type LonLat } from "./geo.js";
import type { CandidateStop, LatLon, QuestRouteTarget, RoutingPlan, RoutingWaypoint, SegmentDirection } from "./types.js";

type SegmentTarget = Extract<QuestRouteTarget, { kind: "segment" }>;

export const orientedCoordinates = (target: SegmentTarget, direction: SegmentDirection = "forward"): LonLat[] =>
  direction === "forward" ? target.coordinates : [...target.coordinates].reverse();

export const segmentEntry = (target: SegmentTarget, direction: SegmentDirection = "forward"): LatLon =>
  toLatLon(orientedCoordinates(target, direction)[0]);

export const segmentExit = (target: SegmentTarget, direction: SegmentDirection = "forward"): LatLon => {
  const coordinates = orientedCoordinates(target, direction);
  return toLatLon(coordinates[coordinates.length - 1]);
};

export const shapingPointCount = (lengthMeters: number): number =>
  lengthMeters < FLOWLINE_SHAPING.shortLengthMeters ? 1 : lengthMeters < FLOWLINE_SHAPING.mediumLengthMeters ? 2 : 3;

/**
 * Ordered points forcing the route along a Flowline: an entry point slightly inside the start,
 * evenly spaced interior points and an exit point slightly inside the end. All are `through`
 * points so they shape the route without creating legs or stops.
 */
export const flowlineShapingPoints = (target: SegmentTarget, direction: SegmentDirection = "forward"): LatLon[] => {
  const coordinates = orientedCoordinates(target, direction);
  const length = lineLengthMeters(coordinates);
  if (length === 0) return [toLatLon(coordinates[0])];
  const inset = Math.min(FLOWLINE_SHAPING.endInsetMeters, length * FLOWLINE_SHAPING.maxEndInsetRatio);
  const interior = shapingPointCount(length);
  const distances = [
    inset,
    ...Array.from({ length: interior }, (_value, index) => (length * (index + 1)) / (interior + 1)),
    length - inset
  ];
  return distances.map((distance) => toLatLon(pointAlong(coordinates, distance)));
};

export const stopEntry = (stop: CandidateStop): LatLon =>
  stop.target.kind === "point" ? stop.target.coordinate : segmentEntry(stop.target, stop.direction);

export const stopExit = (stop: CandidateStop): LatLon =>
  stop.target.kind === "point" ? stop.target.coordinate : segmentExit(stop.target, stop.direction);

const roundCoordinate = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * Translates an ordered candidate into a neutral routing request. Point targets become `via`
 * stops; Flowlines become `through` shaping points. The returned map correlates routing location
 * indexes (0 = start) with Staza target ids so snapping failures can be attributed.
 */
export const buildRoutingPlan = (start: LatLon, end: LatLon, stops: CandidateStop[]): RoutingPlan => {
  const waypoints: RoutingWaypoint[] = [];
  const waypointTargetIds = new Map<number, string>();
  for (const stop of stops) {
    const points = stop.target.kind === "point"
      ? [{ ...stop.target.coordinate, type: "via" as const }]
      : flowlineShapingPoints(stop.target, stop.direction).map((point) => ({ ...point, type: "through" as const }));
    for (const point of points) {
      waypoints.push({ type: point.type, lat: roundCoordinate(point.lat), lon: roundCoordinate(point.lon) });
      waypointTargetIds.set(waypoints.length, stop.target.id);
    }
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
